/**
 * Allez Fencing Hub — Hybrid Scraper v5 (fixed)
 *
 * Bugs fixed:
 *   1. scrapePool: Pool cell column offset was wrong — diagonal (self-cell) not accounted for,
 *      causing scores to be read from the wrong opponent column.
 *   2. scrapePool: scoreFor/scoreAgainst were swapped on losses — now always ourScore/oppScore.
 *   3. scrapeTableau: score ordering was not guaranteed (FTL sometimes shows loser-first) —
 *      now uses Math.max/min to reliably assign winner/loser score regardless of display order.
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

(function() {
  const fs = require('fs');
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/nix/var/nix/profiles/default/bin/chromium',
  ].filter(Boolean);
  const found = candidates.find(p => { try { return fs.existsSync(p); } catch { return false; } });
  console.log(`[Scraper] Chromium: ${found || 'NOT FOUND — pool/tableau scraping disabled'}`);
})();

async function fetchHTML(url) {
  const jar = {};
  let currentUrl = url;

  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await axios.get(currentUrl, {
      headers: {
        ...HEADERS_HTML,
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.5',
        'Upgrade-Insecure-Requests': '1',
        'Cookie':          Object.entries(jar).map(([k,v]) => `${k}=${v}`).join('; '),
      },
      timeout:      20000,
      maxRedirects: 0,
      validateStatus: s => s < 400,
    });

    const setCookie = res.headers['set-cookie'];
    if (setCookie) {
      setCookie.forEach(c => {
        const [pair] = c.split(';');
        const [k, v] = pair.split('=');
        if (k) jar[k.trim()] = (v || '').trim();
      });
    }

    if (res.status < 300 || res.status >= 400) return res.data;

    const location = res.headers['location'];
    if (!location) return res.data;
    currentUrl = location.startsWith('http') ? location : new URL(location, currentUrl).href;
  }

  throw new Error(`Too many redirects for ${url}`);
}

async function fetchJSON(url) {
  const res = await axios.get(url, { headers: HEADERS_JSON, timeout: 15000 });
  return res.data;
}

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

async function getFTLUrlFromUKR(ukrTourneyId) {
  try {
    const html = await fetchHTML(`${UKR}/tourneys/tourneydetail/${ukrTourneyId}`);
    const $    = cheerio.load(html);

    let ftlUrl = null;
    $('a').each((_, a) => {
      const href = $(a).attr('href') || '';
      if (href.includes('fencingtimelive.com')) {
        ftlUrl = href;
        return false;
      }
    });

    if (!ftlUrl) return null;

    const m = ftlUrl.match(/tournaments\/[^/]+\/([A-F0-9]{32})/i);
    return m ? { ftlUrl, ftlTournamentGUID: m[1].toUpperCase() } : null;
  } catch {
    return null;
  }
}

async function getFTLEventGUIDs(ftlTournamentGUID) {
  try {
    const res = await axios.get(
      `${FTL}/tournaments/eventSchedule/${ftlTournamentGUID}`,
      { headers: HEADERS_HTML, timeout: 15000 }
    );
    const html = res.data;

    const dataHrefMatches = [...html.matchAll(/data-href="\/events\/(?:view|results)\/([A-F0-9]{32})"/gi)];
    const hrefMatches     = [...html.matchAll(/href="\/events\/(?:view|results)\/([A-F0-9]{32})"/gi)];

    const seen  = new Set();
    const guids = [];
    [...dataHrefMatches, ...hrefMatches].forEach(m => {
      const g = m[1].toUpperCase();
      if (!seen.has(g)) { seen.add(g); guids.push(g); }
    });

    return guids;
  } catch (err) {
    console.warn(`    Could not get event GUIDs for tournament ${ftlTournamentGUID}: ${err.message}`);
    return [];
  }
}

async function searchFTLEventForFencer(eventGUID, surname, firstName) {
  try {
    const data = await fetchJSON(`${FTL}/events/results/data/${eventGUID}`);
    if (!Array.isArray(data)) return null;

    const surnameL = surname.toLowerCase();
    const firstL   = firstName.toLowerCase();

    const candidates = data.filter(f => {
      const s = (f.search || '').toLowerCase();
      return s.includes(surnameL);
    });

    if (!candidates.length) return null;

    let match = null;

    if (candidates.length === 1) {
      match = candidates[0];
    } else if (firstL) {
      const firstWords = firstL.split(' ').filter(w => w.length > 1);

      const scored = candidates.map(f => {
        const s = (f.search || '').toLowerCase();
        const score = firstWords.filter(w => s.includes(w)).length;
        return { f, score };
      }).sort((a, b) => b.score - a.score);

      if (scored[0].score > 0) {
        const topScore = scored[0].score;
        const topMatches = scored.filter(s => s.score === topScore);
        if (topMatches.length === 1) {
          match = topMatches[0].f;
        } else {
          const exact = topMatches.find(s => {
            const searchStr = (s.f.search || '').toLowerCase();
            return firstWords.every(w => searchStr.includes(w));
          });
          match = exact ? exact.f : topMatches[0].f;
        }
      } else {
        console.warn(`    Ambiguous: ${candidates.length} fencers named ${surname} in event ${eventGUID}, none match firstName "${firstName}" — skipping`);
        return null;
      }
    } else {
      console.warn(`    Ambiguous: ${candidates.length} fencers named ${surname} in event ${eventGUID} — skipping`);
      return null;
    }

    if (!match) return null;

    let poolGUIDs = [], tableauGUIDs = [], eventName = null;
    try {
      const html = await fetchHTML(`${FTL}/events/results/${eventGUID}`);
      const $ = require('cheerio').load(html);

      eventName = $('h1, h2, .event-title').first().text().trim() || null;

      $('a[href*="/pools/scores/"]').each((_, a) => {
        const m = $(a).attr('href').match(/\/pools\/scores\/[A-F0-9]{32}\/([A-F0-9]{32})/i);
        if (m) { const g = m[1].toUpperCase(); if (!poolGUIDs.includes(g)) poolGUIDs.push(g); }
      });
      $('a[href*="/tableaus/scores/"]').each((_, a) => {
        const m = $(a).attr('href').match(/\/tableaus\/scores\/[A-F0-9]{32}\/([A-F0-9]{32})/i);
        if (m) { const g = m[1].toUpperCase(); if (!tableauGUIDs.includes(g)) tableauGUIDs.push(g); }
      });
    } catch {}

    return {
      eventGUID,
      fencerGUID:   match.id,
      place:        parseInt(match.place) || null,
      fieldSize:    data.filter(f => !f.excluded).length,
      eventName,
      poolGUIDs,
      tableauGUIDs,
    };
  } catch (err) {
    console.warn(`    searchFTLEventForFencer error: ${err.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// BUG FIX 1 & 2: scrapePool
//
// Original bugs:
//   - Column offset didn't account for the diagonal (self) cell,
//     causing scores to shift and read from the wrong opponent.
//   - scoreFor/scoreAgainst were swapped on losses:
//       scoreFor: isWin ? ourScore : oppScore  ← wrong on loss
//     Now always: scoreFor = ourScore, scoreAgainst = oppScore
// ─────────────────────────────────────────────────────────────
async function scrapePool(eventGUID, poolGUID, surname) {
  try {
    const poolPageUrl = `${FTL}/pools/scores/${eventGUID}/${poolGUID}`;
    const pageRes = await axios.get(poolPageUrl, { headers: HEADERS_HTML, timeout: 15000 });
    const pageHtml = pageRes.data;

    const idsMatch = pageHtml.match(/var ids = \[([\s\S]*?)\];/);
    const subGuids = idsMatch ? [...idsMatch[1].matchAll(/([A-F0-9]{32})/gi)].map(m => m[1]) : [];

    if (subGuids.length === 0) {
      console.warn(`      No pool sub-GUIDs found for pool ${poolGUID}`);
      return [];
    }

    const surnameUpper = surname.toUpperCase();
    const bouts = [];

    for (const subGuid of subGuids) {
      const boutUrl = `${FTL}/pools/scores/${eventGUID}/${poolGUID}/${subGuid}?dbut=true`;
      const boutRes = await axios.get(boutUrl, { headers: HEADERS_HTML, timeout: 10000 });
      const boutHtml = boutRes.data;

      if (!boutHtml.toUpperCase().includes(surnameUpper)) continue;

      const $ = cheerio.load(boutHtml);
      const dataRows = [];

      $('table tr').each((_, row) => {
        const cells = $(row).find('td');
        if (cells.length >= 8) dataRows.push(cells);
      });

      if (dataRows.length < 2) continue;

      const fencers = dataRows.map(cells => ({
        name: $(cells[0]).text().trim().split('\n')[0].trim(),
        cells,
      }));

      const ourIdx = fencers.findIndex(f => f.name.toUpperCase().includes(surnameUpper));
      if (ourIdx === -1) continue;

      const ourCells = fencers[ourIdx].cells;

      fencers.forEach((opp, oppIdx) => {
        if (oppIdx === ourIdx) return;

        // FIX 1: Account for the diagonal self-cell in the score grid.
        // FTL pool tables have a shaded cell on the diagonal (fencer vs themselves).
        // The score columns start at index 2. For row N, column N+2 is the diagonal.
        // When reading our row for opponent at oppIdx:
        //   - if oppIdx < ourIdx: column is oppIdx (no diagonal in the way yet)
        //   - if oppIdx > ourIdx: column is oppIdx+1 (skip our own diagonal cell)
        // Same logic applies when reading the opponent's row for our position.
        const ourCol = oppIdx < ourIdx ? oppIdx : oppIdx + 1;
        const oppCol = ourIdx < oppIdx ? ourIdx : ourIdx + 1;

        const txt    = $(ourCells[2 + ourCol]).text().trim();
        const oppTxt = $(opp.cells[2 + oppCol]).text().trim();
        if (!txt) return;

        const isWin    = txt.startsWith('V');
        // FIX 2: Always read ourScore from our cell, oppScore from their cell.
        // Previous code swapped these on losses with the ternary:
        //   scoreFor: isWin ? ourScore : oppScore  ← gave opponent's score as ours on loss
        // Now: scoreFor = what WE scored, scoreAgainst = what THEY scored. Always.
        const ourScore = parseInt(txt.replace(/[VD]/g, '')) || 0;
        const oppScore = parseInt(oppTxt.replace(/[VD]/g, '')) || 0;

        const parts   = opp.name.split(' ');
        const fmtName = parts.length > 1
          ? parts.slice(1).join(' ') + ' ' + parts[0][0] + parts[0].slice(1).toLowerCase()
          : opp.name;

        bouts.push({
          opponent:     fmtName,
          scoreFor:     ourScore,    // always what WE scored
          scoreAgainst: oppScore,    // always what THEY scored
          result:       isWin ? 'Won' : 'Lost',
          type:         'Poule',
        });
      });

      break;
    }

    return bouts;
  } catch (err) {
    console.warn(`      Pool scrape failed: ${err.message}`);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
// BUG FIX 3: scrapeTableau
//
// Original bug:
//   FTL sometimes renders tableau scores as "LoserScore - WinnerScore"
//   depending on the round view. The old code blindly used s1/s2 from the
//   regex, so wins/losses with reversed display order got wrong score values.
//
// Fix:
//   Use Math.max/Math.min to reliably determine winner vs loser score,
//   then assign based on whether our fencer won or lost.
// ─────────────────────────────────────────────────────────────
async function scrapeTableau(eventGUID, tableauGUID, surname) {
  try {
    const surnameUpper = surname.toUpperCase();
    const bouts = [];

    const treesUrl = `${FTL}/tableaus/scores/${eventGUID}/${tableauGUID}/trees`;
    const treesRes = await axios.get(treesUrl, { headers: HEADERS_HTML, timeout: 10000 });
    const trees = treesRes.data;
    if (!Array.isArray(trees) || trees.length === 0) return [];

    const roundNames = [
      'Table of 128','Table of 64','Table of 32','Table of 16',
      'Quarter-Final','Semi-Final','Final'
    ];

    function extractName(raw) {
      const s = raw.replace(/^\(\d+\)\s*/, '').trim();
      const m = s.match(/^((?:[A-Z][A-Z\s\-'\/]+\s+)*[A-Z]+(?:\s+[A-Z]+)*)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/);
      if (!m) return null;
      const sur = m[1].trim();
      const first = m[2].trim();
      return `${first} ${sur[0]}${sur.slice(1).toLowerCase()}`;
    }

    for (const tree of trees) {
      for (let tableNum = 0; tableNum < (tree.numTables || 0); tableNum++) {
        const tableUrl = `${FTL}/tableaus/scores/${eventGUID}/${tableauGUID}/trees/${tree.guid}/tables/${tableNum}/4`;
        const tableRes = await axios.get(tableUrl, { headers: HEADERS_HTML, timeout: 10000 });
        const html = tableRes.data;

        if (!html.toUpperCase().includes(surnameUpper)) continue;

        const $ = cheerio.load(html);
        const roundName = roundNames[tableNum] || `Round ${tableNum + 1}`;

        const rows = $('tr').toArray().map(r => ({
          text: $(r).text().trim(),
        }));

        rows.forEach((row, i) => {
          const { text } = row;
          const cleanText = text.replace(/Strip\s*\d+/gi, '').replace(/\s+/g, ' ');
          const scoreMatch = cleanText.match(/(\d+)\s*[-–]\s*(\d+)/);
          if (!scoreMatch) return;
          if (text.includes('BYE')) return;

          const rawA = parseInt(scoreMatch[1]);
          const rawB = parseInt(scoreMatch[2]);

          // Sanity cap — DE scores are always 0-15
          if (rawA > 20 || rawB > 20) return;

          // FIX 3: FTL does not guarantee winner-first display order.
          // Use Math.max/min to always get the higher (winner's) and lower (loser's) score.
          const winnerScore = Math.max(rawA, rawB);
          const loserScore  = Math.min(rawA, rawB);

          const hasOurFencer = text.toUpperCase().includes(surnameUpper);

          const nameRaw = cleanText.replace(/^\(\d+\)\s*/, '').replace(/\s*\d+\s*[-–]\s*\d+[\s\S]*$/, '').trim();
          const winnerName = extractName(nameRaw);

          if (hasOurFencer) {
            // Our fencer's name appears on the score row → they won this bout
            for (const offset of [-2, -1, 1, 2]) {
              const oRow = rows[i + offset];
              if (!oRow) continue;
              const ot = oRow.text;
              if (!ot || ot.includes('BYE') || /\d+\s*[-–]\s*\d+/.test(ot)) continue;
              if (ot.toUpperCase().includes(surnameUpper)) continue;
              const oppName = extractName(ot.replace(/^\(\d+\)\s*/, '').trim());
              if (!oppName || oppName.length < 3) continue;
              bouts.push({
                opponent:     oppName,
                scoreFor:     winnerScore,  // we won → we got the higher score
                scoreAgainst: loserScore,
                result:       'Won',
                type:         `DE ${roundName}`,
              });
              break;
            }
          } else {
            // Someone else's name is on the score row → they won; check if our fencer is the loser nearby
            for (const offset of [-2, -1, 1, 2]) {
              const oRow = rows[i + offset];
              if (!oRow) continue;
              const ot = oRow.text;
              if (!ot.toUpperCase().includes(surnameUpper)) continue;
              if (/\d+\s*[-–]\s*\d+/.test(ot)) continue;
              if (!winnerName || winnerName.length < 3) continue;
              bouts.push({
                opponent:     winnerName,
                scoreFor:     loserScore,   // we lost → we got the lower score
                scoreAgainst: winnerScore,
                result:       'Lost',
                type:         `DE ${roundName}`,
              });
              break;
            }
          }
        });
      }
    }

    return bouts;
  } catch (err) {
    console.warn(`      Tableau scrape failed: ${err.message}`);
    return [];
  }
}

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

      if (error) {
        console.warn(`    Bout save error (${bout.opponent}): ${error.message}`);
      } else {
        boutsAdded++;
      }
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

async function scrapeFencer(fencer) {
  const { ukr_id, name, weapon_id = '34' } = fencer;
  const nameParts = name.trim().split(/\s+/);
  const surname   = nameParts[0];
  const firstName = nameParts.slice(1).join(' ');

  console.log(`\nScraping ${name} via UKRatings → FTL (full)`);

  const ukrComps = await getUKRTournaments(ukr_id, weapon_id);
  const results = {
    competitions: [],
    tournamentsChecked: ukrComps.length,
    eventsChecked: 0,
    syncMode: 'full',
    errors: [],
  };

  if (!ukrComps.length) return results;

  const seen = new Set();
  const unique = ukrComps.filter(c => {
    if (seen.has(c.ukrTourneyId)) return false;
    seen.add(c.ukrTourneyId);
    return true;
  });

  const BATCH = 5;
  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH);

    const batchResults = await Promise.all(batch.map(async (comp) => {
      try {
        console.log(`  → ${comp.name}`);

        const ftlInfo = await getFTLUrlFromUKR(comp.ukrTourneyId);
        console.log(`    FTL info for ${comp.ukrTourneyId}: ${ftlInfo ? ftlInfo.ftlTournamentGUID : 'NOT FOUND'}`);
        if (!ftlInfo) {
          console.log(`    No FTL link found — skipping`);
          return { ...comp, poolBouts: [], deBouts: [] };
        }

        const eventGUIDs = await getFTLEventGUIDs(ftlInfo.ftlTournamentGUID);
        results.eventsChecked += eventGUIDs.length;
        console.log(`    FTL event GUIDs found: ${eventGUIDs.length}`);

        if (!eventGUIDs.length) {
          console.log(`    No events found on FTL schedule`);
          return { ...comp, poolBouts: [], deBouts: [], ftlTournamentGUID: ftlInfo.ftlTournamentGUID };
        }

        let matchedEvent = null;
        for (const eventGUID of eventGUIDs) {
          const match = await searchFTLEventForFencer(eventGUID, surname, firstName);
          if (match) {
            matchedEvent = { eventGUID, ...match };
            break;
          }
        }

        if (!matchedEvent) {
          console.log(`    Fencer not found in any of ${eventGUIDs.length} FTL events`);
          if (comp.rank || comp.fieldSize) {
            return { ...comp, poolBouts: [], deBouts: [], ftlTournamentGUID: ftlInfo.ftlTournamentGUID };
          }
          return null;
        }

        const { eventGUID, poolGUIDs = [], tableauGUIDs = [], place, fieldSize, eventName } = matchedEvent;
        console.log(`    Matched: ${poolGUIDs.length} pools, ${tableauGUIDs.length} tableaux`);

        const [poolBoutsArrays, deBoutsArrays] = await Promise.all([
          Promise.all((poolGUIDs || []).map(g => scrapePool(eventGUID, g, surname).catch(() => []))),
          Promise.all((tableauGUIDs || []).map(g => scrapeTableau(eventGUID, g, surname).catch(() => []))),
        ]);

        const poolBouts = poolBoutsArrays.flat();
        const deBouts   = deBoutsArrays.flat();

        console.log(`    ✓ ${poolBouts.length} pool + ${deBouts.length} DE bouts`);

        return {
          ...comp,
          ftlEventGUID:      eventGUID,
          ftlTournamentGUID: ftlInfo.ftlTournamentGUID,
          eventName:         eventName || comp.eventName,
          rank:              place    || comp.rank,
          fieldSize:         fieldSize || comp.fieldSize,
          poolBouts,
          deBouts,
        };
      } catch (err) {
        console.warn(`    Error processing ${comp.name}: ${err.message}`);
        results.errors.push(`${comp.name}: ${err.message}`);
        return { ...comp, poolBouts: [], deBouts: [] };
      }
    }));

    results.competitions.push(...batchResults.filter(Boolean));
  }

  return results;
}

async function scrapeFromFTLUrl(ftlUrl, { coachMode, allFencers, fencerId, fencerName } = {}) {
  const results = {};

  let eventGUID = null;
  let tournamentGUID = null;

  const eventMatch  = ftlUrl.match(/\/events\/(?:view|results)\/([A-F0-9]{32})/i);
  const schedMatch  = ftlUrl.match(/\/tournaments\/eventSchedule\/([A-F0-9]{32})/i);

  if (eventMatch) {
    eventGUID = eventMatch[1].toUpperCase();
  } else if (schedMatch) {
    tournamentGUID = schedMatch[1].toUpperCase();
    const guids = await getFTLEventGUIDs(tournamentGUID);
    if (guids.length > 0) eventGUID = guids[0];
  }

  if (!eventGUID) {
    console.warn('scrapeFromFTLUrl: could not extract event GUID from URL', ftlUrl);
    return results;
  }

  const eventDataUrl = `${FTL}/events/results/data/${eventGUID}`;
  const eventData = await fetchJSON(eventDataUrl);
  const allEventFencers = Object.values(eventData || {});

  let fencersToScrape = [];

  if (coachMode && allFencers) {
    fencersToScrape = allFencers.map(f => {
      const [surname] = f.name.split(' ');
      const match = allEventFencers.find(ef =>
        ef.search && ef.search.toUpperCase().includes(surname.toUpperCase())
      );
      return match ? { ...f, ftlFencer: match } : null;
    }).filter(Boolean);
  } else if (fencerName) {
    const [surname] = fencerName.split(' ');
    const match = allEventFencers.find(ef =>
      ef.search && ef.search.toUpperCase().includes(surname.toUpperCase())
    );
    if (match) {
      fencersToScrape = [{ id: fencerId, name: fencerName, ftlFencer: match }];
    }
  }

  if (!fencersToScrape.length) {
    console.warn('scrapeFromFTLUrl: no matching fencers found in event', eventGUID);
    return results;
  }

  const eventResultsHtml = await fetchHTML(`${FTL}/events/results/${eventGUID}`);
  const $ = require('cheerio').load(eventResultsHtml);

  const poolGUIDs = [];
  const tableauGUIDs = [];

  $('a[href*="/pools/scores/"]').each((_, a) => {
    const m = $(a).attr('href').match(/\/pools\/scores\/[A-F0-9]{32}\/([A-F0-9]{32})/i);
    if (m && !poolGUIDs.includes(m[1].toUpperCase())) poolGUIDs.push(m[1].toUpperCase());
  });
  $('a[href*="/tableaus/scores/"]').each((_, a) => {
    const m = $(a).attr('href').match(/\/tableaus\/scores\/[A-F0-9]{32}\/([A-F0-9]{32})/i);
    if (m && !tableauGUIDs.includes(m[1].toUpperCase())) tableauGUIDs.push(m[1].toUpperCase());
  });

  for (const f of fencersToScrape) {
    const [surname] = f.name.split(' ');
    const errors = [];

    const [poolBoutsArrays, deBoutsArrays] = await Promise.all([
      Promise.all(poolGUIDs.map(g => scrapePool(eventGUID, g, surname).catch(e => { errors.push(e.message); return []; }))),
      Promise.all(tableauGUIDs.map(g => scrapeTableau(eventGUID, g, surname).catch(e => { errors.push(e.message); return []; }))),
    ]);

    const poolBouts = poolBoutsArrays.flat();
    const deBouts   = deBoutsArrays.flat();

    const comp = {
      name:          `${f.ftlFencer?.name || f.name} — Manual`,
      ftlEventGUID:  eventGUID,
      ukrTourneyId:  `manual_${eventGUID}`,
      rank:          parseInt(f.ftlFencer?.place) || null,
      fieldSize:     allEventFencers.length || null,
      source:        'manual',
      poolBouts,
      deBouts,
    };

    results[f.id] = { competitions: [comp], errors };
    console.log(`  ${f.name}: ${poolBouts.length} pool + ${deBouts.length} DE bouts`);
  }

  return results;
}

module.exports = { scrapeFencer, saveScrapedData, scrapeFromFTLUrl, saveManualTournamentData };
