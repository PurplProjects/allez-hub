/**
 * Allez Fencing Hub — Hybrid Scraper v5
 *
 * UK tournaments (primary path):
 *   1. UKRatings athlete page → list of tournament IDs (server-rendered, fast)
 *   2. UKRatings tourney detail → FTL tournament URL (via "Tournament Website" link)
 *   3. FTL tournament schedule (Puppeteer) → event GUIDs
 *   4. FTL /events/results/data/{guid} → find fencer by name, get place/field
 *   5. FTL pool + tableau pages (Puppeteer) → bout scores
 *
 * Non-UK / manual tournaments (secondary path):
 *   Coach or fencer provides FTL event URL directly.
 *   See scrapeFromFTLUrl() — used by the "Add Tournament" feature.
 *   For coach: finds all Allez fencers in the event automatically.
 *   For fencer: loads only their own bouts.
 */

const axios    = require('axios');
const cheerio  = require('cheerio');
const supabase = require('../db/supabase');

const UKR = 'https://www.ukratings.co.uk';
const FTL = 'https://www.fencingtimelive.com';

const HEADERS_HTML = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept':     'text/html,application/xhtml+xml',
};
const HEADERS_JSON = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept':     'application/json',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchHTML(url) {
  const res = await axios.get(url, { headers: HEADERS_HTML, timeout: 20000 });
  return res.data;
}
async function fetchJSON(url) {
  const res = await axios.get(url, { headers: HEADERS_JSON, timeout: 15000 });
  return res.data;
}

// ── Get last sync date ────────────────────────────────────────
async function getLastSyncDate(fencerId) {
  const { data } = await supabase
    .from('scrape_log')
    .select('scraped_at')
    .eq('fencer_id', fencerId)
    .in('status', ['success', 'partial'])
    .order('scraped_at', { ascending: false })
    .limit(1)
    .single();
  return data?.scraped_at ? new Date(data.scraped_at) : null;
}

// ═══════════════════════════════════════════════════════════════
// PRIMARY PATH — UK tournaments via UKRatings
// ═══════════════════════════════════════════════════════════════

// Step 1: Get tournament list from UKRatings athlete page
async function getUKRTournaments(ukrId, weaponId = '34') {
  console.log(`  Fetching UKRatings profile for UKR ID ${ukrId}...`);
  const html = await fetchHTML(`${UKR}/tourneys/athleteex/${weaponId}/${ukrId}/None`);
  const $    = cheerio.load(html);

  const competitions = [];
  const seen = new Set();

  $('tr[onclick*="tourneydetail"]').each((_, tr) => {
    const onclick   = $(tr).attr('onclick') || '';
    const tourneyId = onclick.match(/tourneydetail\/(\d+)/)?.[1];
    if (!tourneyId || seen.has(tourneyId)) return;
    seen.add(tourneyId);

    const cells = $(tr).find('td').map((_, td) => $(td).text().trim()).get();
    if (cells.length < 2) return;

    // Cells: [tournament name, event name, points, rank "X of Y", rating, ...]
    const rankStr = cells.find(c => c.includes(' of '));
    const [rank, fieldSize] = rankStr
      ? rankStr.split(' of ').map(s => parseInt(s.trim()))
      : [null, null];

    competitions.push({
      ukrTourneyId: tourneyId,
      name:         cells[0],
      eventName:    cells[1] || null,
      rank:         rank || null,
      fieldSize:    fieldSize || null,
    });
  });

  console.log(`  Found ${competitions.length} competitions on UKRatings`);
  return competitions;
}

// Step 2: Get FTL tournament URL from UKRatings tourney detail page
async function getFTLUrlFromUKR(ukrTourneyId) {
  try {
    const html = await fetchHTML(`${UKR}/tourneys/tourneydetail/${ukrTourneyId}`);
    const $    = cheerio.load(html);

    // Find the "Tournament Website" link pointing to FTL
    let ftlUrl = null;
    $('a').each((_, a) => {
      const href = $(a).attr('href') || '';
      if (href.includes('fencingtimelive.com')) {
        ftlUrl = href;
        return false; // break
      }
    });

    if (!ftlUrl) return null;

    // Extract tournament GUID from URL
    // e.g. fencingtimelive.com/tournaments/eventSchedule/{GUID}
    const m = ftlUrl.match(/tournaments\/[^/]+\/([A-F0-9]{32})/i);
    return m ? { ftlUrl, ftlTournamentGUID: m[1].toUpperCase() } : null;
  } catch {
    return null;
  }
}

// Step 3: Get event GUIDs from FTL tournament schedule (Puppeteer — JS-rendered)
async function getFTLEventGUIDs(ftlTournamentGUID) {
  let browser;
  try {
    const puppeteer = require('puppeteer');
    browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
      headless: 'new',
    });
    const page = await browser.newPage();
    await page.setUserAgent(HEADERS_HTML['User-Agent']);
    await page.goto(
      `${FTL}/tournaments/eventSchedule/${ftlTournamentGUID}`,
      { waitUntil: 'networkidle0', timeout: 25000 }
    );
    await new Promise(r => setTimeout(r, 2000));

    const guids = await page.evaluate(() => {
      const links = [...document.querySelectorAll('a[href*="/events/"]')];
      const seen  = new Set();
      const found = [];
      links.forEach(a => {
        const m = a.href.match(/\/events\/(?:view|results)\/([A-F0-9]{32})/i);
        if (m && !seen.has(m[1])) {
          seen.add(m[1]);
          found.push(m[1].toUpperCase());
        }
      });
      return found;
    });

    return guids;
  } catch (err) {
    console.warn(`    Could not get event GUIDs for tournament ${ftlTournamentGUID}: ${err.message}`);
    return [];
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// Step 4: Search FTL event for a specific fencer
async function searchFTLEventForFencer(eventGUID, surname, firstName) {
  try {
    const data = await fetchJSON(`${FTL}/events/results/data/${eventGUID}`);
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

// Step 5a: Scrape pool scores (Puppeteer)
async function scrapePool(eventGUID, poolGUID, surname) {
  let browser;
  try {
    const puppeteer = require('puppeteer');
    browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
      headless: 'new',
    });
    const page = await browser.newPage();
    await page.setUserAgent(HEADERS_HTML['User-Agent']);
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

// Step 5b: Scrape DE tableau (Puppeteer)
async function scrapeTableau(eventGUID, tableauGUID, surname) {
  let browser;
  try {
    const puppeteer = require('puppeteer');
    browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
      headless: 'new',
    });
    const page = await browser.newPage();
    await page.setUserAgent(HEADERS_HTML['User-Agent']);
    await page.goto(`${FTL}/tableaus/scores/${eventGUID}/${tableauGUID}`, {
      waitUntil: 'networkidle0', timeout: 30000,
    });
    await new Promise(r => setTimeout(r, 3500));

    const bouts = await page.evaluate((surnameUpper) => {
      const results = [];
      document.querySelectorAll('tr').forEach(row => {
        const cells = [...row.querySelectorAll('td')];
        if (cells.length < 3) return;
        const texts    = cells.map(c => c.innerText.trim());
        const ourIdx   = texts.findIndex(t => t.toUpperCase().includes(surnameUpper));
        if (ourIdx === -1) return;
        const scoreP   = /^\d+$/;
        const s1Idx    = texts.findIndex((t, i) => i !== ourIdx && scoreP.test(t));
        if (s1Idx === -1) return;
        const oppIdx   = texts.findIndex((t, i) => i !== ourIdx && i !== s1Idx && t.length > 2 && !scoreP.test(t));
        if (oppIdx === -1) return;
        const s2Idx    = texts.findIndex((t, i) => i !== s1Idx && i !== ourIdx && i !== oppIdx && scoreP.test(t));
        if (s2Idx === -1) return;
        const s1       = parseInt(texts[s1Idx]);
        const s2       = parseInt(texts[s2Idx]);
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
        const k = `${b.opponent}|${b.scoreFor}|${b.scoreAgainst}`;
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

// Helper: get pool + tableau URLs from FTL event results page
async function getEventRoundURLs(eventGUID) {
  try {
    const html = await fetchHTML(`${FTL}/events/results/${eventGUID}`);
    const poolM = [...html.matchAll(/\/pools\/scores\/([A-F0-9]{32})\/([A-F0-9]{32})/gi)];
    const tabM  = [...html.matchAll(/\/tableaus\/scores\/([A-F0-9]{32})\/([A-F0-9]{32})/gi)];
    const pools    = [...new Map(poolM.map(m => [m[2], { eventGUID: m[1], poolGUID:    m[2] }])).values()];
    const tableaux = [...new Map(tabM.map( m => [m[2], { eventGUID: m[1], tableauGUID: m[2] }])).values()];
    const nameM    = html.match(/<title>([^<]+)<\/title>/i);
    const eventName = nameM ? nameM[1].replace(' - Fencing Time Live','').trim() : null;
    const dateM    = html.match(/(\w+ \d+, \d{4})/);
    const eventDate = dateM ? parseDate(dateM[1]) : null;
    return { pools, tableaux, eventName, eventDate };
  } catch {
    return { pools: [], tableaux: [], eventName: null, eventDate: null };
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN — scrape UK tournaments for a fencer
// ═══════════════════════════════════════════════════════════════
async function scrapeFencer(fencer) {
  const surname   = fencer.name.split(' ').pop();
  const firstName = fencer.name.split(' ')[0];

  const lastSyncDate = await getLastSyncDate(fencer.id);
  const syncMode     = lastSyncDate ? 'incremental' : 'full';

  console.log(`\nScraping ${fencer.name} via UKRatings → FTL (${syncMode})`);

  const results = {
    competitions: [], errors: [], syncMode,
    lastSyncDate: lastSyncDate?.toISOString().slice(0,10) || null,
    tournamentsChecked: 0, eventsChecked: 0,
  };

  if (!fencer.ukr_id) {
    results.errors.push('No UKRatings ID set for this fencer');
    return results;
  }

  // Step 1: Get tournament list from UKRatings
  let ukrComps;
  try {
    ukrComps = await getUKRTournaments(fencer.ukr_id, fencer.ukr_weapon_id || '34');
  } catch (err) {
    results.errors.push(`UKRatings fetch failed: ${err.message}`);
    return results;
  }

  // For incremental sync — only process tournaments not already in DB
  if (syncMode === 'incremental') {
    const { data: existing } = await supabase
      .from('competitions')
      .select('ukr_tourney_id')
      .eq('fencer_id', fencer.id);
    const existingIds = new Set((existing || []).map(c => c.ukr_tourney_id));
    ukrComps = ukrComps.filter(c => !existingIds.has(c.ukrTourneyId));
    console.log(`  Incremental: ${ukrComps.length} new tournaments to process`);
  }

  results.tournamentsChecked = ukrComps.length;

  // Step 2-5: For each tournament, get FTL link and scrape bouts
  for (const comp of ukrComps) {
    console.log(`  → ${comp.name}`);
    await sleep(500);

    try {
      // Get FTL tournament URL from UKRatings detail page
      const ftlInfo = await getFTLUrlFromUKR(comp.ukrTourneyId);
      if (!ftlInfo) {
        console.log(`    No FTL link found — skipping`);
        results.competitions.push({
          ukrTourneyId: comp.ukrTourneyId,
          name:         comp.name,
          eventName:    comp.eventName,
          rank:         comp.rank,
          fieldSize:    comp.fieldSize,
          poolBouts:    [],
          deBouts:      [],
          noFTL:        true,
        });
        continue;
      }

      await sleep(300);

      // Get event GUIDs from FTL schedule
      const eventGUIDs = await getFTLEventGUIDs(ftlInfo.ftlTournamentGUID);
      results.eventsChecked += eventGUIDs.length;

      if (eventGUIDs.length === 0) {
        console.log(`    No events found on FTL schedule`);
        continue;
      }

      // Find the specific event this fencer competed in
      let matchedEvent = null;
      for (const eventGUID of eventGUIDs) {
        await sleep(150);
        const match = await searchFTLEventForFencer(eventGUID, surname, firstName);
        if (match) {
          matchedEvent = match;
          break;
        }
      }

      if (!matchedEvent) {
        console.log(`    Fencer not found in any FTL event`);
        // Still save the competition record from UKRatings data
        results.competitions.push({
          ukrTourneyId: comp.ukrTourneyId,
          name:         comp.name,
          eventName:    comp.eventName,
          rank:         comp.rank,
          fieldSize:    comp.fieldSize,
          poolBouts:    [],
          deBouts:      [],
        });
        continue;
      }

      await sleep(300);

      // Get pool and tableau URLs
      const { pools, tableaux, eventName, eventDate } = await getEventRoundURLs(matchedEvent.eventGUID);

      // Scrape pool bouts
      const poolBouts = [];
      for (const pool of pools) {
        const bouts = await scrapePool(pool.eventGUID, pool.poolGUID, surname);
        poolBouts.push(...bouts);
        await sleep(200);
      }

      // Scrape DE bouts
      const deBouts = [];
      for (const tableau of tableaux) {
        const bouts = await scrapeTableau(tableau.eventGUID, tableau.tableauGUID, surname);
        deBouts.push(...bouts);
        await sleep(200);
      }

      results.competitions.push({
        ukrTourneyId:  comp.ukrTourneyId,
        ftlEventGUID:  matchedEvent.eventGUID,
        name:          eventName || comp.name,
        eventName:     comp.eventName,
        date:          eventDate,
        rank:          matchedEvent.place || comp.rank,
        fieldSize:     matchedEvent.fieldSize || comp.fieldSize,
        poolBouts,
        deBouts,
      });

      console.log(`    ✓ ${poolBouts.length} pool + ${deBouts.length} DE bouts`);

    } catch (err) {
      console.warn(`    Error: ${err.message}`);
      results.errors.push(`${comp.name}: ${err.message}`);
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════
// SECONDARY PATH — Manual FTL URL entry
// Used by "Add Tournament" feature for non-UK events
// ═══════════════════════════════════════════════════════════════

/**
 * Scrape a single tournament from an FTL URL.
 *
 * fencerMode: load bouts only for the specified fencer
 * coachMode:  find ALL Allez fencers in the event and load everyone's bouts
 *
 * @param {string} ftlUrl   - FTL URL (event results or tournament schedule)
 * @param {object} options
 *   @param {string}   options.fencerId    - fencer to load for (fencer mode)
 *   @param {string}   options.fencerName  - name to search for
 *   @param {string[]} options.allFencers  - array of {id, name} for coach mode
 *   @param {boolean}  options.coachMode   - if true, find all Allez fencers
 */
async function scrapeFromFTLUrl(ftlUrl, options = {}) {
  console.log(`\nManual FTL scrape: ${ftlUrl}`);

  // Extract event GUID from URL
  // Handles both:
  //   /events/results/{GUID}
  //   /events/view/{GUID}
  //   /tournaments/eventSchedule/{GUID}
  const eventMatch = ftlUrl.match(/\/events\/(?:results|view)\/([A-F0-9]{32})/i);
  const tournamentMatch = ftlUrl.match(/\/tournaments\/[^/]+\/([A-F0-9]{32})/i);

  let eventGUIDs = [];

  if (eventMatch) {
    // Direct event URL — just one event
    eventGUIDs = [eventMatch[1].toUpperCase()];
  } else if (tournamentMatch) {
    // Tournament schedule URL — get all events
    const tournamentGUID = tournamentMatch[1].toUpperCase();
    eventGUIDs = await getFTLEventGUIDs(tournamentGUID);
    console.log(`  Found ${eventGUIDs.length} events in tournament`);
  } else {
    throw new Error('Could not extract event or tournament GUID from URL');
  }

  const results = {};

  if (options.coachMode && options.allFencers?.length > 0) {
    // Coach mode: find all Allez fencers across all events
    console.log(`  Coach mode: searching for ${options.allFencers.length} fencers`);

    for (const f of options.allFencers) {
      const surname   = f.name.split(' ').pop();
      const firstName = f.name.split(' ')[0];
      results[f.id]   = { fencer: f, competitions: [], errors: [] };

      for (const eventGUID of eventGUIDs) {
        await sleep(200);
        const match = await searchFTLEventForFencer(eventGUID, surname, firstName);
        if (!match) continue;

        const { pools, tableaux, eventName, eventDate } = await getEventRoundURLs(eventGUID);

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

        results[f.id].competitions.push({
          ftlEventGUID: eventGUID,
          name:         eventName || 'Manual tournament',
          date:         eventDate,
          rank:         match.place,
          fieldSize:    match.fieldSize,
          poolBouts,
          deBouts,
        });

        console.log(`  ✓ ${f.name}: ${poolBouts.length} pool + ${deBouts.length} DE bouts`);
      }
    }
  } else {
    // Fencer mode: load bouts for one fencer
    const surname   = options.fencerName.split(' ').pop();
    const firstName = options.fencerName.split(' ')[0];
    results[options.fencerId] = { fencer: { id: options.fencerId, name: options.fencerName }, competitions: [], errors: [] };

    for (const eventGUID of eventGUIDs) {
      await sleep(200);
      const match = await searchFTLEventForFencer(eventGUID, surname, firstName);
      if (!match) continue;

      const { pools, tableaux, eventName, eventDate } = await getEventRoundURLs(eventGUID);

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

      results[options.fencerId].competitions.push({
        ftlEventGUID: eventGUID,
        name:         eventName || 'Manual tournament',
        date:         eventDate,
        rank:         match.place,
        fieldSize:    match.fieldSize,
        poolBouts,
        deBouts,
      });

      console.log(`  ✓ ${poolBouts.length} pool + ${deBouts.length} DE bouts`);
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════
// SAVE TO SUPABASE
// ═══════════════════════════════════════════════════════════════
async function saveScrapedData(fencerId, scrapedResults) {
  let boutsAdded = 0;

  for (const comp of scrapedResults.competitions) {
    const { data: savedComp, error: compErr } = await supabase
      .from('competitions')
      .upsert({
        fencer_id:      fencerId,
        ukr_tourney_id: comp.ukrTourneyId || comp.ftlEventGUID,
        name:           comp.name,
        event_name:     comp.eventName || null,
        date:           comp.date || null,
        rank:           comp.rank || null,
        field_size:     comp.fieldSize || null,
        source:         comp.ftlEventGUID ? 'ftl' : 'ukratings',
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
        source:         savedComp.source,
      }, { onConflict: 'fencer_id,competition_id,opponent,bout_type' });

      if (!error) boutsAdded++;
    }
  }

  await supabase.from('scrape_log').insert({
    fencer_id:           fencerId,
    status:              scrapedResults.errors?.length ? 'partial' : 'success',
    sync_type:           scrapedResults.syncMode || 'manual',
    from_date:           scrapedResults.lastSyncDate || null,
    bouts_added:         boutsAdded,
    tournaments_checked: scrapedResults.tournamentsChecked || 0,
    events_checked:      scrapedResults.eventsChecked || 0,
    error_msg:           (scrapedResults.errors || []).slice(0,5).join('; ') || null,
  });

  const fencerUpdate = { last_sync: new Date().toISOString() };
  if (!scrapedResults.syncMode || scrapedResults.syncMode === 'full') {
    fencerUpdate.last_full_sync = new Date().toISOString();
  }
  await supabase.from('fencers').update(fencerUpdate).eq('id', fencerId);

  console.log(`Saved ${boutsAdded} bouts for fencer ${fencerId}`);
  return boutsAdded;
}

// Save results from scrapeFromFTLUrl (multi-fencer)
async function saveManualTournamentData(scrapeResults) {
  let total = 0;
  for (const [fencerId, data] of Object.entries(scrapeResults)) {
    const saved = await saveScrapedData(fencerId, {
      competitions:        data.competitions,
      errors:              data.errors,
      syncMode:            'manual',
      tournamentsChecked:  1,
      eventsChecked:       data.competitions.length,
    });
    total += saved;
  }
  return total;
}

function parseDate(str) {
  try {
    const d = new Date(str);
    return isNaN(d) ? null : d.toISOString().slice(0, 10);
  } catch { return null; }
}

module.exports = { scrapeFencer, saveScrapedData, scrapeFromFTLUrl, saveManualTournamentData };
