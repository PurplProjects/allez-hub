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

// Log chromium path on startup for debugging
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

// Cookie jar for UKRatings — handles session cookies across redirects
const https    = require('https');
const http     = require('http');
const { CookieJar } = (() => { try { return require('tough-cookie'); } catch { return { CookieJar: null }; } })();

async function fetchHTML(url) {
  // Use axios with manual redirect handling to preserve cookies
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
      maxRedirects: 0,           // handle redirects manually
      validateStatus: s => s < 400,
    });

    // Collect any Set-Cookie headers
    const setCookie = res.headers['set-cookie'];
    if (setCookie) {
      setCookie.forEach(c => {
        const [pair] = c.split(';');
        const [k, v] = pair.split('=');
        if (k) jar[k.trim()] = (v || '').trim();
      });
    }

    // If not a redirect, return the body
    if (res.status < 300 || res.status >= 400) return res.data;

    // Follow redirect
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

// Step 3: Get event GUIDs from FTL tournament schedule (plain HTTP — GUIDs in raw HTML)
// The schedule page embeds event GUIDs as data-href="/events/view/{GUID}" attributes
// No Puppeteer needed — raw HTML contains all the data
async function getFTLEventGUIDs(ftlTournamentGUID) {
  try {
    const res = await axios.get(
      `${FTL}/tournaments/eventSchedule/${ftlTournamentGUID}`,
      { headers: HEADERS_HTML, timeout: 15000 }
    );
    const html = res.data;

    // GUIDs appear as: data-href="/events/view/{GUID}"
    const dataHrefMatches = [...html.matchAll(/data-href="\/events\/(?:view|results)\/([A-F0-9]{32})"/gi)];
    // Also catch any plain href links
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
// Find chromium executable — try multiple locations
function findChromium() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/nix/var/nix/profiles/default/bin/chromium',
  ].filter(Boolean);
  
  const fs = require('fs');
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return null;
}

// Shared browser instance — launch once, reuse across all scrapes
// This avoids spawning multiple Chromium processes and hitting memory limits
let _sharedBrowser = null;
let _sharedBrowserPath = null;

async function getSharedBrowser() {
  const chromiumPath = findChromium();
  if (!chromiumPath) return null;

  // Always launch fresh — shared browser was crashing
  // Use minimal flags for Railway's sandboxed environment
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({
    executablePath: chromiumPath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--no-first-run',
    ],
    headless: true,
    timeout: 30000,
  });
  return browser;
}

async function scrapePool(eventGUID, poolGUID, surname) {
  // Pure HTTP approach — no Playwright needed
  // 1. Fetch pool page to get var ids = [...] (pool sub-GUIDs in raw HTML)
  // 2. Fetch each ?dbut=true endpoint → parse pool table with cheerio
  try {
    const poolPageUrl = `${FTL}/pools/scores/${eventGUID}/${poolGUID}`;
    const pageRes = await axios.get(poolPageUrl, { headers: HEADERS_HTML, timeout: 15000 });
    const pageHtml = pageRes.data;

    // Extract pool sub-GUIDs from inline JS: var ids = ["GUID1","GUID2",...]
    const idsMatch = pageHtml.match(/var ids = \[([\s\S]*?)\];/);
    const subGuids = idsMatch ? [...idsMatch[1].matchAll(/([A-F0-9]{32})/gi)].map(m => m[1]) : [];

    if (subGuids.length === 0) {
      console.warn(`      No pool sub-GUIDs found for pool ${poolGUID}`);
      return [];
    }

    const surnameUpper = surname.toUpperCase();
    const bouts = [];

    // Try each sub-GUID until we find the one with our fencer
    for (const subGuid of subGuids) {
      const boutUrl = `${FTL}/pools/scores/${eventGUID}/${poolGUID}/${subGuid}?dbut=true`;
      const boutRes = await axios.get(boutUrl, { headers: HEADERS_HTML, timeout: 10000 });
      const boutHtml = boutRes.data;

      if (!boutHtml.toUpperCase().includes(surnameUpper)) continue;

      // Parse with cheerio
      const $ = cheerio.load(boutHtml);
      const dataRows = [];

      $('table tr').each((_, row) => {
        const cells = $(row).find('td');
        if (cells.length >= 8) dataRows.push(cells);
      });

      if (dataRows.length < 2) continue;

      // Build fencer list
      const fencers = dataRows.map(cells => ({
        name: $(cells[0]).text().trim().split('\n')[0].trim(),
        cells,
      }));

      const ourIdx = fencers.findIndex(f => f.name.toUpperCase().includes(surnameUpper));
      if (ourIdx === -1) continue;

      const ourCells = fencers[ourIdx].cells;

      fencers.forEach((opp, oppIdx) => {
        if (oppIdx === ourIdx) return;
        const txt = $(ourCells[2 + oppIdx]).text().trim();
        if (!txt) return;

        const isWin    = txt.startsWith('V');
        const ourScore = parseInt(txt.replace(/[VD]/g, '')) || 0;
        const oppTxt   = $(opp.cells[2 + ourIdx]).text().trim();
        const oppScore = parseInt(oppTxt.replace(/[VD]/g, '')) || 0;

        // Format: "SURNAME First" → "First Surname"
        const parts   = opp.name.split(' ');
        const fmtName = parts.length > 1
          ? parts.slice(1).join(' ') + ' ' + parts[0][0] + parts[0].slice(1).toLowerCase()
          : opp.name;

        bouts.push({
          opponent:     fmtName,
          scoreFor:     isWin ? ourScore : oppScore,
          scoreAgainst: isWin ? oppScore : ourScore,
          result:       isWin ? 'Won' : 'Lost',
          type:         'Poule',
        });
      });

      break; // Found our pool — no need to check others
    }

    return bouts;
  } catch (err) {
    console.warn(`      Pool scrape failed: ${err.message}`);
    return [];
  }
}


async function scrapeTableau(eventGUID, tableauGUID, surname) {
  // Pure HTTP approach — uses /trees and /trees/{guid}/tables/{n}/{count} endpoints
  try {
    const surnameUpper = surname.toUpperCase();
    const bouts = [];

    // Step 1: get trees (bracket divisions)
    const treesUrl = `${FTL}/tableaus/scores/${eventGUID}/${tableauGUID}/trees`;
    const treesRes = await axios.get(treesUrl, { headers: HEADERS_HTML, timeout: 10000 });
    const trees = treesRes.data;
    if (!Array.isArray(trees) || trees.length === 0) return [];

    const roundNames = [
      'Table of 128','Table of 64','Table of 32','Table of 16',
      'Quarter-Final','Semi-Final','Final'
    ];

    for (const tree of trees) {
      for (let tableNum = 0; tableNum < (tree.numTables || 0); tableNum++) {
        const tableUrl = `${FTL}/tableaus/scores/${eventGUID}/${tableauGUID}/trees/${tree.guid}/tables/${tableNum}/4`;
        const tableRes = await axios.get(tableUrl, { headers: HEADERS_HTML, timeout: 10000 });
        const html = tableRes.data;

        if (!html.toUpperCase().includes(surnameUpper)) continue;

        const $ = cheerio.load(html);
        const roundName = roundNames[tableNum] || `Round ${tableNum + 1}`;

        // Walk all TRs, find ones containing our fencer
        $('tr').each((_, row) => {
          const rowText = $(row).text().trim();
          if (!rowText.toUpperCase().includes(surnameUpper)) return;
          if (rowText.toUpperCase().includes('BYE')) return;

          // Check adjacent rows for score + opponent
          const $row = $(row);
          [$row.prev(), $row.next()].forEach($nearby => {
            const nearbyText = $nearby.text().trim();
            if (!nearbyText) return;

            const scoreMatch = nearbyText.match(/(\d+)\s*-\s*(\d+)/);
            if (!scoreMatch) return;
            if (nearbyText.toUpperCase().includes('BYE')) return;

            // Parse opponent name: remove seed "(N) " prefix, club, strip info, scores
            let oppRaw = nearbyText
              .replace(/^\(\d+\)\s*/, '')          // remove seed
              .replace(/\d+\s*-\s*\d+.*/s, '')      // remove score onwards
              .replace(/Strip\s*\d+/i, '')            // remove strip
              .trim().split('\n')[0].trim();

            // Remove club name (after the person's name, often uppercase)
            // Name format: "SURNAME FirstOPPCLUB" — split on uppercase run
            const nameMatch = oppRaw.match(/^([A-Z\s\-]+[a-z][A-Za-z\s\-]*)/);
            const oppName = nameMatch ? nameMatch[1].trim() : oppRaw;

            if (!oppName || oppName.length < 3) return;

            const s1 = parseInt(scoreMatch[1]);
            const s2 = parseInt(scoreMatch[2]);

            // If nearby row contains our fencer = nearby is our win (we scored higher)
            // If nearby row is opponent's result row, determine win/loss from scores
            const nearbyHasUs = nearbyText.toUpperCase().includes(surnameUpper);
            let scoreFor, scoreAgainst, result;

            if (nearbyHasUs) {
              // The nearby row is our result — score shown is our win score
              scoreFor = Math.max(s1, s2);
              scoreAgainst = Math.min(s1, s2);
              result = 'Won';
            } else {
              // Nearby row is opponent's — they beat us or we beat them
              // The higher score belongs to winner; check which row has our name
              // If our name row comes AFTER opponent, we lost (opponent scored first in bracket)
              scoreFor = s1;
              scoreAgainst = s2;
              result = s1 > s2 ? 'Won' : 'Lost';
            }

            // Format name: "SURNAME First" → "First Surname"  
            const parts = oppName.split(' ');
            const fmtName = parts.length > 1
              ? parts.slice(1).join(' ') + ' ' + parts[0][0] + parts[0].slice(1).toLowerCase()
              : oppName;

            bouts.push({
              opponent:     fmtName,
              scoreFor,
              scoreAgainst,
              result,
              type:         `DE ${roundName}`,
            });
          });
        });

        break; // Found our fencer in this tableNum, move to next tree
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
