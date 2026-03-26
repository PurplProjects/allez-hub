/**
 * FencingTimeLive Brute-Force Fencer Scraper — with incremental sync
 *
 * First sync (no lastSyncDate):
 *   Fetches all tournaments from last 3 years → full history scan
 *   Marks fencer.last_full_sync in DB
 *
 * Subsequent syncs (lastSyncDate exists):
 *   Only fetches tournaments that STARTED on or after (lastSyncDate - 7 days)
 *   The 7-day buffer catches tournaments that were still in progress at last sync
 *   Typically reduces scan from ~1000 tournaments to ~20-50 → 20x faster
 *
 * For each tournament:
 *   1. GET /tournaments/eventSchedule/{guid}  → extract event GUIDs
 *   2. GET /events/results/data/{guid}        → JSON fencer list, search by name
 *   3. If found → Puppeteer pool pages + tableau for bout scores
 */

const axios    = require('axios');
const supabase = require('../db/supabase');

const FTL = 'https://www.fencingtimelive.com';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept':     'application/json, text/html',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── HTTP helpers ──────────────────────────────────────────────
async function getJSON(url) {
  const res = await axios.get(url, { headers: HEADERS, timeout: 15000 });
  return res.data;
}
async function getHTML(url) {
  const res = await axios.get(url, {
    headers: { ...HEADERS, Accept: 'text/html' },
    timeout: 15000,
  });
  return res.data;
}

async function batchAll(items, fn, batchSize = 20, delayMs = 300) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(batch.map(fn));
    results.push(...batchResults.map(r => r.status === 'fulfilled' ? r.value : null));
    if (i + batchSize < items.length) await sleep(delayMs);
  }
  return results;
}

// ── Get last successful sync date for a fencer ────────────────
async function getLastSyncDate(fencerId) {
  const { data } = await supabase
    .from('scrape_log')
    .select('scraped_at, sync_type')
    .eq('fencer_id', fencerId)
    .in('status', ['success', 'partial'])
    .order('scraped_at', { ascending: false })
    .limit(1)
    .single();

  return data?.scraped_at ? new Date(data.scraped_at) : null;
}

// ── Step 1: Get tournaments — filtered by date if incremental ─
async function getTournaments(lastSyncDate) {
  const isIncremental = !!lastSyncDate;

  if (isIncremental) {
    // Only fetch tournaments active since (lastSync - 7 days buffer)
    // The 7-day buffer catches tournaments that were mid-flight at last sync
    const fromDate = new Date(lastSyncDate);
    fromDate.setDate(fromDate.getDate() - 7);
    const fromDateStr = fromDate.toISOString().slice(0, 10);
    const todayStr    = new Date().toISOString().slice(0, 10);

    console.log(`  Incremental sync from ${fromDateStr} (last sync was ${lastSyncDate.toISOString().slice(0, 10)})`);

    // FTL's search returns tournaments active around a given date
    // Fetch week-by-week from fromDate to today to get everything in range
    const allTournaments = [];
    const cursor = new Date(fromDate);
    while (cursor <= new Date()) {
      try {
        const dateStr = cursor.toISOString().slice(0, 10);
        const data = await getJSON(
          `${FTL}/tournaments/search/data?filter=All&date=0&today=${dateStr}`
        );
        if (Array.isArray(data)) allTournaments.push(...data);
      } catch { /* skip */ }
      cursor.setDate(cursor.getDate() + 14); // step 2 weeks at a time
      await sleep(200);
    }

    // Deduplicate
    const seen = new Set();
    const unique = allTournaments.filter(t => {
      if (!t.id || seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });

    // Filter to only tournaments that started on or after fromDate
    const filtered = unique.filter(t => {
      if (!t.start) return true; // keep if no date
      return new Date(t.start) >= fromDate;
    });

    console.log(`  Found ${filtered.length} tournaments since ${fromDateStr}`);
    return { tournaments: filtered, isIncremental, fromDate: fromDateStr };

  } else {
    // Full scan — fetch all tournaments from last 3 years
    console.log('  Full scan — fetching all FTL tournaments (3 years)...');

    // FTL search returns tournaments ACTIVE around a given date.
    // To get full 3-year history we step through every 2 months,
    // collecting all unique tournaments seen at each point in time.
    const allTournaments = [];
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 3);
    const cursor = new Date(startDate);

    while (cursor <= new Date()) {
      const dateStr = cursor.toISOString().slice(0, 10);
      try {
        const data = await getJSON(
          `${FTL}/tournaments/search/data?filter=All&date=0&today=${dateStr}`
        );
        if (Array.isArray(data)) {
          allTournaments.push(...data);
        }
      } catch { /* skip */ }
      cursor.setMonth(cursor.getMonth() + 2); // step 2 months
      await sleep(200);
    }

    const seen = new Set();
    const unique = allTournaments.filter(t => {
      if (!t.id || seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });

    console.log(`  Total unique tournaments: ${unique.length}`);
    return { tournaments: unique, isIncremental: false, fromDate: null };
  }
}

// ── Step 2: Get event GUIDs for a tournament ──────────────────
// Strategy: try the tournament GUID directly as an event GUID (works for
// single-event tournaments), then try the tournaments/data endpoint.
// We deliberately avoid Puppeteer here — launching a browser per tournament
// is too slow and memory-intensive at scale.
async function getEventGUIDs(tournamentGUID) {
  // Attempt 1: The tournament GUID is often the same as the event GUID.
  // Try it directly — if /events/results/data/ returns fencers, it's valid.
  try {
    const data = await getJSON(`${FTL}/events/results/data/${tournamentGUID}`);
    if (Array.isArray(data) && data.length > 0) {
      return [tournamentGUID];
    }
  } catch { /* not a valid event GUID */ }

  // Attempt 2: Try known JSON data endpoints for the tournament
  const candidates = [
    `${FTL}/tournaments/data/${tournamentGUID}`,
    `${FTL}/tournaments/events/data/${tournamentGUID}`,
    `${FTL}/tournaments/schedule/data/${tournamentGUID}`,
  ];
  for (const url of candidates) {
    try {
      const data = await getJSON(url);
      if (Array.isArray(data) && data.length > 0) {
        const guids = data
          .map(e => e.id || e.eventId || e.guid)
          .filter(g => g && /^[A-F0-9]{32}$/i.test(g));
        if (guids.length > 0) return guids.map(g => g.toUpperCase());
      }
    } catch { /* try next */ }
  }

  return [];
}

// ── Step 3: Search event for fencer by name ───────────────────
async function searchEventForFencer(eventGUID, surname, firstName) {
  try {
    const data = await getJSON(`${FTL}/events/results/data/${eventGUID}`);
    if (!Array.isArray(data)) return null;

    const match = data.find(f => {
      const s = (f.search || '').toLowerCase();
      return s.includes(surname.toLowerCase()) &&
             s.includes(firstName.toLowerCase());
    });

    if (!match) return null;

    return {
      eventGUID,
      fencerGUID: match.id,
      place:      parseInt(match.place) || null,
      fieldSize:  data.filter(f => !f.excluded).length,
    };
  } catch {
    return null;
  }
}

// ── Step 4: Get pool and tableau URLs for an event ────────────
async function getEventRoundURLs(eventGUID) {
  try {
    const html = await getHTML(`${FTL}/events/results/${eventGUID}`);

    const poolMatches    = [...html.matchAll(/\/pools\/scores\/([A-F0-9]{32})\/([A-F0-9]{32})/gi)];
    const tableauMatches = [...html.matchAll(/\/tableaus\/scores\/([A-F0-9]{32})\/([A-F0-9]{32})/gi)];

    const pools    = [...new Map(poolMatches.map(m    => [m[2], { eventGUID: m[1], poolGUID:    m[2] }])).values()];
    const tableaux = [...new Map(tableauMatches.map(m => [m[2], { eventGUID: m[1], tableauGUID: m[2] }])).values()];

    const nameMatch = html.match(/<title>([^<]+)<\/title>/i);
    const eventName = nameMatch
      ? nameMatch[1].replace(' - Fencing Time Live', '').trim()
      : `Event ${eventGUID.slice(0, 8)}`;
    const dateMatch = html.match(/(\w+ \d+, \d{4})/);
    const eventDate = dateMatch ? parseDate(dateMatch[1]) : null;

    return { pools, tableaux, eventName, eventDate };
  } catch {
    return { pools: [], tableaux: [], eventName: `Event ${eventGUID.slice(0, 8)}`, eventDate: null };
  }
}

// ── Step 5: Scrape pool via Puppeteer ─────────────────────────
async function scrapePool(eventGUID, poolGUID, surname) {
  let browser;
  try {
    const puppeteer = require('puppeteer');
    browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
      headless: 'new',
    });
    const page = await browser.newPage();
    await page.setUserAgent(HEADERS['User-Agent']);
    await page.goto(`${FTL}/pools/scores/${eventGUID}/${poolGUID}`, {
      waitUntil: 'networkidle0', timeout: 30000,
    });
    await new Promise(r => setTimeout(r, 3500));

    return await page.evaluate((surnameUpper) => {
      const results = [];
      document.querySelectorAll('table').forEach(table => {
        const rows = [...table.querySelectorAll('tr')];
        if (rows.length < 3) return;

        const names = [];
        rows.forEach((row, ri) => {
          if (ri === 0) return;
          const cells = [...row.querySelectorAll('td')];
          if (cells.length < 3) return;
          const name = cells[0].innerText.trim().split('\n')[0].trim().toUpperCase();
          if (name) names.push({ name, rowIdx: ri });
        });

        const ourIdx = names.findIndex(n => n.name.includes(surnameUpper));
        if (ourIdx === -1) return;

        const ourRow   = rows[names[ourIdx].rowIdx];
        const ourCells = [...ourRow.querySelectorAll('td')];

        names.forEach((opp, oppIdx) => {
          if (oppIdx === ourIdx) return;
          const scoreCell = ourCells[2 + oppIdx];
          if (!scoreCell) return;
          const txt = scoreCell.innerText.trim();
          if (!txt) return;

          const isWin    = txt.startsWith('V');
          const ourScore = parseInt(txt.replace(/[VD]/g, '')) || 0;

          const oppRow   = rows[names[oppIdx].rowIdx];
          const oppCells = [...(oppRow?.querySelectorAll('td') || [])];
          const oppTxt   = oppCells[2 + ourIdx]?.innerText?.trim() || '';
          const oppScore = parseInt(oppTxt.replace(/[VD]/g, '')) || 0;

          const parts   = opp.name.split(' ');
          const fmtName = parts.length > 1
            ? parts.slice(1).map(w => w[0] + w.slice(1).toLowerCase()).join(' ')
              + ' ' + parts[0][0] + parts[0].slice(1).toLowerCase()
            : opp.name;

          results.push({
            opponent:     fmtName,
            scoreFor:     isWin ? ourScore : oppScore,
            scoreAgainst: isWin ? oppScore : ourScore,
            result:       isWin ? 'Won' : 'Lost',
            type:         'Poule',
          });
        });
      });
      return results;
    }, surname.toUpperCase());

  } catch (err) {
    console.warn(`    Pool scrape failed: ${err.message}`);
    return [];
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// ── Step 6: Scrape DE tableau via Puppeteer ───────────────────
async function scrapeTableau(eventGUID, tableauGUID, surname) {
  let browser;
  try {
    const puppeteer = require('puppeteer');
    browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
      headless: 'new',
    });
    const page = await browser.newPage();
    await page.setUserAgent(HEADERS['User-Agent']);
    await page.goto(`${FTL}/tableaus/scores/${eventGUID}/${tableauGUID}`, {
      waitUntil: 'networkidle0', timeout: 30000,
    });
    await new Promise(r => setTimeout(r, 3500));

    const bouts = await page.evaluate((surnameUpper) => {
      const results = [];
      document.querySelectorAll('tr').forEach(row => {
        const cells = [...row.querySelectorAll('td')];
        if (cells.length < 3) return;
        const texts = cells.map(c => c.innerText.trim());
        const ourIdx = texts.findIndex(t => t.toUpperCase().includes(surnameUpper));
        if (ourIdx === -1) return;
        const scorePattern = /^\d+$/;
        const scoreIdx = texts.findIndex((t, i) => i !== ourIdx && scorePattern.test(t));
        if (scoreIdx === -1) return;
        const oppIdx = texts.findIndex((t, i) =>
          i !== ourIdx && i !== scoreIdx && t.length > 2 && !scorePattern.test(t)
        );
        if (oppIdx === -1) return;
        const otherScoreIdx = texts.findIndex((t, i) =>
          i !== scoreIdx && i !== ourIdx && i !== oppIdx && scorePattern.test(t)
        );
        if (otherScoreIdx === -1) return;
        const s1 = parseInt(texts[scoreIdx]);
        const s2 = parseInt(texts[otherScoreIdx]);
        const ourScore = ourIdx < oppIdx ? s1 : s2;
        const oppScore = ourIdx < oppIdx ? s2 : s1;
        if (ourScore === 0 && oppScore === 0) return;
        results.push({
          opponent:     texts[oppIdx],
          scoreFor:     ourScore,
          scoreAgainst: oppScore,
          result:       ourScore > oppScore ? 'Won' : 'Lost',
          type:         'DE',
        });
      });
      const seen = new Set();
      return results.filter(b => {
        const k = b.opponent + b.scoreFor + b.scoreAgainst;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }, surname.toUpperCase());

    return bouts;
  } catch (err) {
    console.warn(`    Tableau scrape failed: ${err.message}`);
    return [];
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// ── Main entry point ──────────────────────────────────────────
async function scrapeFencer(fencer) {
  const surname   = fencer.name.split(' ').pop();
  const firstName = fencer.name.split(' ')[0];

  // Check for existing sync — determines full vs incremental
  const lastSyncDate = await getLastSyncDate(fencer.id);
  const syncMode     = lastSyncDate ? 'incremental' : 'full';

  console.log(`\nScraping ${fencer.name} — mode: ${syncMode}`);

  const results = {
    competitions: [],
    errors: [],
    syncMode,
    lastSyncDate: lastSyncDate?.toISOString().slice(0, 10) || null,
    tournamentsChecked: 0,
    eventsChecked: 0,
  };

  // Step 1 — Get relevant tournaments
  const { tournaments, isIncremental, fromDate } = await getTournaments(lastSyncDate);
  results.tournamentsChecked = tournaments.length;

  console.log(`  Scanning ${tournaments.length} tournaments...`);

  // Step 2 — Build event list
  // Approach A: treat every tournament GUID directly as an event GUID.
  // This works because many FTL tournaments ARE single events.
  // Approach B: call getEventGUIDs for any that don't resolve directly —
  // this handles multi-event tournaments.
  //
  // We run Approach A first (fast, no extra requests) then Approach B for
  // any that returned no fencer data in step 3.

  // Log sample of tournament IDs so we can verify format
  console.log(`  Sample tournament IDs: ${tournaments.slice(0,3).map(t => t.id?.slice(0,8) + '...').join(', ')}`);

  // Build initial event list: try tournament ID directly + getEventGUIDs
  const tourneyEventPairs = await batchAll(
    tournaments,
    async (t) => {
      if (!t.id) return [];
      // Always include the tournament GUID itself as a candidate event GUID
      const directCandidate = {
        eventGUID:      t.id,
        tournamentName: t.name,
        tournamentDate: t.start?.slice(0, 10),
        isDirect:       true,
      };
      // Also try to get additional event GUIDs (for multi-event tournaments)
      const extraGUIDs = await getEventGUIDs(t.id);
      const extras = extraGUIDs
        .filter(g => g !== t.id) // don't duplicate
        .map(g => ({
          eventGUID:      g,
          tournamentName: t.name,
          tournamentDate: t.start?.slice(0, 10),
          isDirect:       false,
        }));
      return [directCandidate, ...extras];
    },
    25, 200
  );

  const allEvents = tourneyEventPairs.flat().filter(Boolean);
  results.eventsChecked = allEvents.length;
  console.log(`  Checking ${allEvents.length} event candidates for ${surname}...`);

  // Step 3 — Search each event for this fencer
  const searchResults = await batchAll(
    allEvents,
    async (ev) => {
      const match = await searchEventForFencer(ev.eventGUID, surname, firstName);
      if (!match) return null;
      return { ...ev, ...match };
    },
    30, 100
  );

  const matchedEvents = searchResults.filter(Boolean);
  console.log(`  Found ${matchedEvents.length} matching events`);

  // Step 4 — Scrape pool and DE bouts for each matched event
  for (const ev of matchedEvents) {
    console.log(`  → ${ev.tournamentName || ev.eventGUID.slice(0, 8)}`);
    try {
      const { pools, tableaux, eventName, eventDate } = await getEventRoundURLs(ev.eventGUID);
      await sleep(300);

      const poolBouts = [];
      for (const pool of pools) {
        const bouts = await scrapePool(pool.eventGUID, pool.poolGUID, surname);
        poolBouts.push(...bouts);
        await sleep(200);
      }

      const deBouts = [];
      for (const tableau of tableaux) {
        const bouts = await scrapeTableau(tableau.eventGUID, tableau.tableauGUID, surname);
        deBouts.push(...bouts);
        await sleep(200);
      }

      results.competitions.push({
        eventGUID:  ev.eventGUID,
        name:       eventName || ev.tournamentName,
        date:       eventDate || ev.tournamentDate,
        rank:       ev.place,
        fieldSize:  ev.fieldSize,
        poolBouts,
        deBouts,
      });

      console.log(`    ✓ ${poolBouts.length} pool + ${deBouts.length} DE bouts`);
    } catch (err) {
      results.errors.push(`${ev.tournamentName}: ${err.message}`);
    }

    await sleep(500);
  }

  return results;
}

// ── Save to Supabase + update sync timestamps ─────────────────
async function saveScrapedData(fencerId, scrapedResults) {
  let boutsAdded = 0;

  for (const comp of scrapedResults.competitions) {
    const { data: savedComp, error: compErr } = await supabase
      .from('competitions')
      .upsert({
        fencer_id:      fencerId,
        ukr_tourney_id: comp.eventGUID,
        name:           comp.name,
        date:           comp.date || null,
        rank:           comp.rank || null,
        field_size:     comp.fieldSize || null,
        source:         'ftl',
      }, { onConflict: 'fencer_id,ukr_tourney_id' })
      .select()
      .single();

    if (compErr || !savedComp) {
      console.warn(`  Could not save comp "${comp.name}":`, compErr?.message);
      continue;
    }

    const allBouts = [...(comp.poolBouts || []), ...(comp.deBouts || [])];
    for (const bout of allBouts) {
      if (!bout.opponent || bout.opponent === 'BYE') continue;
      const { error } = await supabase.from('bouts').upsert({
        fencer_id:      fencerId,
        competition_id: savedComp.id,
        date:           savedComp.date || null,
        opponent:       bout.opponent,
        score_for:      bout.scoreFor,
        score_against:  bout.scoreAgainst,
        result:         bout.result,
        bout_type:      bout.type,
        source:         'ftl',
      }, { onConflict: 'fencer_id,competition_id,opponent,bout_type' });

      if (!error) boutsAdded++;
    }
  }

  // Log the scrape with full metadata
  await supabase.from('scrape_log').insert({
    fencer_id:            fencerId,
    status:               scrapedResults.errors.length ? 'partial' : 'success',
    sync_type:            scrapedResults.syncMode,
    from_date:            scrapedResults.lastSyncDate || null,
    bouts_added:          boutsAdded,
    tournaments_checked:  scrapedResults.tournamentsChecked || 0,
    events_checked:       scrapedResults.eventsChecked || 0,
    error_msg:            scrapedResults.errors.slice(0, 5).join('; ') || null,
  });

  // Update fencer.last_sync (and last_full_sync if this was a full scan)
  const fencerUpdate = { last_sync: new Date().toISOString() };
  if (scrapedResults.syncMode === 'full') {
    fencerUpdate.last_full_sync = new Date().toISOString();
  }
  await supabase.from('fencers').update(fencerUpdate).eq('id', fencerId);

  console.log(`\nSaved ${boutsAdded} bouts — sync_type: ${scrapedResults.syncMode}`);
  return boutsAdded;
}

// ── Helpers ───────────────────────────────────────────────────
function parseDate(str) {
  try {
    const d = new Date(str);
    return isNaN(d) ? null : d.toISOString().slice(0, 10);
  } catch { return null; }
}

module.exports = { scrapeFencer, saveScrapedData };
