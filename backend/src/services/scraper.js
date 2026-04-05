/**
 * Allez Fencing Hub — Scraper v6 (UKRatings-first)
 *
 * Primary pipeline (UKRatings):
 *   1. /tourneys/athleteex/34/{ukr_id}
 *        → list of competitions: tourneyId, eventName, rank, fieldSize
 *   2. /tourneys/tourneydetail/{tourneyId}
 *        → match eventName to find eventfinalresults/{eventId}
 *   3. /tourneys/eventfinalresults/{eventId}
 *        → date from header (MM.DD.YYYY)
 *        → links to eventroundpoolmatches/{id} (may be multiple)
 *        → link to eventelim/{id}
 *   4. /tourneys/eventroundpoolmatches/{id}
 *        → rows: [pool_pos, fencerA, scoreA, scoreB, fencerB, pool_pos]
 *   5. /tourneys/eventelim/{id}
 *        → walk DOM items, backward/forward scan by bb-score-row-* CSS class
 *
 * Secondary pipeline (manual FTL URL via "Add Tournament" tab):
 *   scrapeFromFTLUrl() — for tournaments not yet on UKRatings
 */

const axios    = require('axios');
const cheerio  = require('cheerio');
const supabase = require('../db/supabase');

const UKR = 'https://www.ukratings.co.uk';
const FTL = 'https://www.fencingtimelive.com';

const HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept':          'text/html,application/xhtml+xml',
  'Accept-Language': 'en-GB,en;q=0.5',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── HTTP helpers ─────────────────────────────────────────────────────────────

async function fetchHTML(url) {
  const jar = {};
  let cur = url;
  for (let i = 0; i < 8; i++) {
    const res = await axios.get(cur, {
      headers: { ...HEADERS, Cookie: Object.entries(jar).map(([k,v]) => `${k}=${v}`).join('; ') },
      timeout: 20000, maxRedirects: 0, validateStatus: s => s < 400,
    });
    (res.headers['set-cookie'] || []).forEach(c => {
      const [pair] = c.split(';');
      const [k, v] = pair.split('=');
      if (k) jar[k.trim()] = (v || '').trim();
    });
    if (res.status < 300) return res.data;
    const loc = res.headers['location'];
    if (!loc) return res.data;
    cur = loc.startsWith('http') ? loc : new URL(loc, cur).href;
  }
}

async function fetchJSON(url) {
  return axios.get(url, { headers: { ...HEADERS, Accept: 'application/json' }, timeout: 10000 })
    .then(r => r.data).catch(() => null);
}

// ── Name formatting ──────────────────────────────────────────────────────────

// "SURNAME, First" → "First Surname"
function formatName(raw) {
  const clean = raw.replace(/^\d+\s+/, '').trim();
  const parts = clean.split(', ');
  if (parts.length === 2) {
    const sur   = parts[0].trim();
    const first = parts[1].trim();
    return `${first} ${sur[0]}${sur.slice(1).toLowerCase()}`;
  }
  return clean;
}

// ── Step 1: Competition list from athlete page ────────────────────────────────

async function getCompetitionList(ukrId) {
  const html = await fetchHTML(`${UKR}/tourneys/athleteex/34/${ukrId}/None`);
  const $ = cheerio.load(html);
  const competitions = [];
  const seen = new Set();

  $('tr[onclick*="tourneydetail"]').each((_, tr) => {
    const onclick = $(tr).attr('onclick') || '';
    const tidMatch = onclick.match(/tourneydetail\/(\d+)/);
    if (!tidMatch) return;
    const ukrTourneyId = tidMatch[1];

    const cells = $(tr).find('td').map((_, td) => $(td).text().trim()).get();
    if (cells.length < 2) return;

    const tourneyName = cells[0];
    const eventName   = cells[1];

    const rankStr   = cells.find(c => /\d+ of \d+/.test(c));
    const rankMatch = rankStr?.match(/(\d+) of (\d+)/);
    const rank      = rankMatch ? parseInt(rankMatch[1]) : null;
    const fieldSize = rankMatch ? parseInt(rankMatch[2]) : null;

    if (!rank && !fieldSize) return; // upcoming/no data

    const key = `${ukrTourneyId}|${eventName}`;
    if (seen.has(key)) return;
    seen.add(key);

    competitions.push({ ukrTourneyId, tourneyName, eventName, rank, fieldSize });
  });

  return competitions;
}

// ── Step 2: Find eventfinalresults ID ────────────────────────────────────────

async function getEventFinalResultsId(ukrTourneyId, eventName) {
  const html = await fetchHTML(`${UKR}/tourneys/tourneydetail/${ukrTourneyId}`);
  const $ = cheerio.load(html);

  const normalise = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = normalise(eventName);
  let eventFinalResultsId = null;

  $('tr[onclick*="eventfinalresults"]').each((_, tr) => {
    const text   = $(tr).text().replace(/\s+/g, ' ').trim();
    const onclick = $(tr).attr('onclick') || '';
    const idMatch = onclick.match(/eventfinalresults\/(\d+)/);
    if (!idMatch) return;
    if (normalise(text).includes(target)) {
      eventFinalResultsId = idMatch[1];
      return false;
    }
  });

  return eventFinalResultsId;
}

// ── Step 3: Pool/elim IDs and date from eventfinalresults ────────────────────

async function getEventDetails(eventFinalResultsId) {
  const html = await fetchHTML(`${UKR}/tourneys/eventfinalresults/${eventFinalResultsId}`);
  const $ = cheerio.load(html);

  // Date: "MM.DD.YYYY" → "YYYY-MM-DD"
  let date = null;
  const dateMatch = html.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (dateMatch) date = `${dateMatch[3]}-${dateMatch[1]}-${dateMatch[2]}`;

  const poolIds = [];
  $('a[href*="eventroundpoolmatches"]').each((_, a) => {
    const m = $(a).attr('href').match(/eventroundpoolmatches\/(\d+)/);
    if (m && !poolIds.includes(m[1])) poolIds.push(m[1]);
  });

  let elimId = null;
  $('a[href*="eventelim"]').each((_, a) => {
    const m = $(a).attr('href').match(/eventelim\/(\d+)/);
    if (m) { elimId = m[1]; return false; }
  });

  return { date, poolIds, elimId };
}

// ── Step 4: Pool bouts ───────────────────────────────────────────────────────

async function scrapePoolBouts(poolId, surname) {
  const html = await fetchHTML(`${UKR}/tourneys/eventroundpoolmatches/${poolId}`);
  const $ = cheerio.load(html);
  const bouts = [];
  const surnameUpper = surname.toUpperCase();

  $('table tr').each((_, tr) => {
    const cells = $(tr).find('td').map((_, td) => $(td).text().trim()).get();
    if (cells.length < 5) return;
    if (!cells.some(c => c.toUpperCase().includes(surnameUpper))) return;

    // [pool_pos, fencerA, scoreA, scoreB, fencerB, pool_pos]
    const weAreA = cells[1].toUpperCase().includes(surnameUpper);
    const opp    = weAreA ? cells[4] : cells[1];
    const sf     = weAreA ? parseInt(cells[2]) : parseInt(cells[3]);
    const sa     = weAreA ? parseInt(cells[3]) : parseInt(cells[2]);

    if (isNaN(sf) || isNaN(sa) || !opp || opp.includes('BYE')) return;

    bouts.push({
      opponent:     formatName(opp),
      scoreFor:     sf,
      scoreAgainst: sa,
      result:       sf > sa ? 'Won' : 'Lost',
      type:         'Poule',
    });
  });

  return bouts;
}

// ── Step 5: DE bouts ─────────────────────────────────────────────────────────

async function scrapeElimBouts(elimId, surname) {
  const html = await fetchHTML(`${UKR}/tourneys/eventelim/${elimId}`);
  const $ = cheerio.load(html);
  const surnameUpper = surname.toUpperCase();

  // Walk all leaf text nodes collecting round + text + CSS class
  const items = [];
  let currentRound = '';

  function walk(el) {
    const txt = $(el).text().trim();
    if (txt.match(/^Round \d+$/) || txt.match(/^(Semi Finals|Quarter Finals|Finals)$/)) {
      currentRound = txt;
    }
    const children = $(el).children().toArray();
    if (children.length === 0) {
      if (txt) {
        items.push({
          round: currentRound,
          text:  txt,
          cls:   el.attribs?.class || $(el).parent().attr('class') || '',
        });
      }
    } else {
      children.forEach(c => walk(c));
    }
  }
  $('body').children().toArray().forEach(el => walk(el));

  // Map round labels to standard names
  function mapRound(r) {
    const m = r.match(/^Round (\d+)$/);
    if (m) return `Table of ${m[1]}`;
    if (r === 'Quarter Finals') return 'Quarter Final';
    if (r === 'Semi Finals')    return 'Semi Final';
    if (r === 'Finals')         return 'Final';
    return r;
  }

  const bouts = [];
  const seen  = new Set();

  items.forEach((item, i) => {
    if (!item.text.toUpperCase().includes(surnameUpper)) return;

    const nextCls  = items[i + 1]?.cls || '';
    const isBottom = nextCls.includes('bb-score-row-bottom') && !nextCls.includes('second');
    const isTop    = nextCls.includes('bb-score-row-top')    && !nextCls.includes('second');
    if (!isBottom && !isTop) return;

    const ourScore = parseInt(items[i + 1]?.text);
    if (isNaN(ourScore)) return;

    let oppName = '', oppScore = NaN;

    if (isBottom) {
      // Scan BACKWARD for the nearest bb-score-row-top score
      for (let j = i - 1; j >= 0; j--) {
        if (items[j].cls.includes('bb-score-row-top') && !items[j].cls.includes('second')) {
          oppScore = parseInt(items[j].text);
          for (let k = j - 1; k >= 0; k--) {
            if (!items[k].cls || items[k].cls === '') { oppName = items[k].text; break; }
          }
          break;
        }
      }
    } else {
      // Scan FORWARD for the next bb-score-row-bottom score
      for (let j = i + 2; j < items.length; j++) {
        if (items[j].cls.includes('bb-score-row-bottom') && !items[j].cls.includes('second')) {
          oppScore = parseInt(items[j].text);
          for (let k = j - 1; k > i; k--) {
            if (!items[k].cls || items[k].cls === '') { oppName = items[k].text; break; }
          }
          break;
        }
      }
    }

    if (isNaN(oppScore) || !oppName || oppName.includes('BYE') || oppName.includes('- BYE')) return;

    const round  = mapRound(item.round);
    const oppFmt = formatName(oppName);
    const key    = `${round}|${oppFmt}`;
    if (seen.has(key)) return;
    seen.add(key);

    const result = ourScore > oppScore ? 'Won' : ourScore < oppScore ? 'Lost' : 'Draw';
    bouts.push({ opponent: oppFmt, scoreFor: ourScore, scoreAgainst: oppScore, result, type: `DE ${round}` });
  });

  return bouts;
}

// ── Save to Supabase ─────────────────────────────────────────────────────────

async function saveScrapedData(fencerId, scrapedResults) {
  let boutsAdded = 0;

  for (const comp of scrapedResults.competitions) {
    const { data: savedComp, error: compErr } = await supabase
      .from('competitions')
      .upsert({
        fencer_id:      fencerId,
        ukr_tourney_id: comp.ukrTourneyId,
        name:           comp.tourneyName,
        event_name:     comp.eventName || null,
        date:           comp.date      || null,
        rank:           comp.rank      || null,
        field_size:     comp.fieldSize || null,
        source:         'ukratings',
      }, { onConflict: 'fencer_id,ukr_tourney_id', ignoreDuplicates: false })
      .select()
      .single();

    if (compErr || !savedComp) {
      console.warn(`    Failed to save competition ${comp.tourneyName}: ${compErr?.message}`);
      continue;
    }

    const allBouts = [...(comp.poolBouts || []), ...(comp.deBouts || [])];
    for (const bout of allBouts) {
      if (!bout.opponent || bout.opponent.includes('BYE')) continue;
      const { error } = await supabase.from('bouts').upsert({
        fencer_id:     fencerId,
        competition_id: savedComp.id,
        date:          savedComp.date || null,
        opponent:      bout.opponent,
        score_for:     bout.scoreFor,
        score_against: bout.scoreAgainst,
        result:        bout.result,
        bout_type:     bout.type,
        source:        'ukratings',
      }, { onConflict: 'fencer_id,competition_id,opponent,bout_type', ignoreDuplicates: true });
      if (!error) boutsAdded++;
    }
  }

  return boutsAdded;
}

// ── Main scraper ──────────────────────────────────────────────────────────────

async function scrapeFencer(fencer) {
  const { ukr_id, name } = fencer;
  const surname = name.trim().split(/\s+/)[0];

  console.log(`\nScraping ${name} via UKRatings v6`);

  const results = { competitions: [], tournamentsChecked: 0, errors: [] };

  let competitions;
  try {
    competitions = await getCompetitionList(ukr_id);
    console.log(`  Found ${competitions.length} competitions`);
  } catch (err) {
    console.warn(`  Failed to get competition list: ${err.message}`);
    return results;
  }

  const BATCH = 5;
  for (let i = 0; i < competitions.length; i += BATCH) {
    const batch = competitions.slice(i, i + BATCH);
    const batchResults = await Promise.all(batch.map(async comp => {
      try {
        results.tournamentsChecked++;
        console.log(`  → ${comp.tourneyName} / ${comp.eventName}`);

        const eventFinalResultsId = await getEventFinalResultsId(comp.ukrTourneyId, comp.eventName);
        if (!eventFinalResultsId) {
          console.log(`    No event results page found — skipping`);
          return { ...comp, poolBouts: [], deBouts: [] };
        }

        const { date, poolIds, elimId } = await getEventDetails(eventFinalResultsId);
        comp.date = date;
        console.log(`    Date: ${date || '?'}, Pools: ${poolIds.length}, Elim: ${elimId ? 'yes' : 'no'}`);

        const poolBouts = (await Promise.all(poolIds.map(id => scrapePoolBouts(id, surname).catch(() => [])))).flat();
        const deBouts   = elimId ? await scrapeElimBouts(elimId, surname).catch(() => []) : [];

        console.log(`    ✓ ${poolBouts.length} pool + ${deBouts.length} DE bouts`);
        return { ...comp, poolBouts, deBouts };

      } catch (err) {
        console.warn(`    Error: ${err.message}`);
        results.errors.push(`${comp.tourneyName}: ${err.message}`);
        return { ...comp, poolBouts: [], deBouts: [] };
      }
    }));
    results.competitions.push(...batchResults);
    if (i + BATCH < competitions.length) await sleep(300);
  }

  return results;
}

// ── Public API ────────────────────────────────────────────────────────────────

async function syncFencer(fencerId, options = {}) {
  const { data: fencer } = await supabase.from('fencers').select('*').eq('id', fencerId).single();
  if (!fencer) throw new Error(`Fencer ${fencerId} not found`);

  const now = new Date().toISOString();
  await supabase.from('scrape_log').insert({ fencer_id: fencerId, sync_type: 'full', started_at: now, status: 'running' });

  try {
    const scrapedResults = await scrapeFencer(fencer);
    const boutsAdded     = await saveScrapedData(fencerId, scrapedResults);

    console.log(`\nSaved ${boutsAdded} bouts for fencer ${fencerId}`);
    await supabase.from('fencers').update({ last_sync: now, last_full_sync: now }).eq('id', fencerId);
    await supabase.from('scrape_log')
      .update({ status: 'complete', completed_at: new Date().toISOString(), tournaments_checked: scrapedResults.tournamentsChecked, bouts_added: boutsAdded })
      .eq('fencer_id', fencerId).eq('status', 'running');

    return { success: true, boutsAdded, errors: scrapedResults.errors };
  } catch (err) {
    await supabase.from('scrape_log')
      .update({ status: 'error', error: err.message, completed_at: new Date().toISOString() })
      .eq('fencer_id', fencerId).eq('status', 'running');
    throw err;
  }
}

// ── Manual FTL URL scrape (Add Tournament feature) ───────────────────────────

async function scrapeFromFTLUrl(ftlUrl, fencerId, coachMode = false) {
  console.log(`\nscrapeFromFTLUrl: ${ftlUrl}`);
  const results = { competitions: [], errors: [] };

  const { data: allFencers } = coachMode
    ? await supabase.from('fencers').select('*')
    : await supabase.from('fencers').select('*').eq('id', fencerId);
  if (!allFencers?.length) return results;

  const eventMatch = ftlUrl.match(/\/events\/(?:results|view)\/([A-F0-9]{32})/i);
  const schedMatch  = ftlUrl.match(/\/tournaments\/eventSchedule\/([A-F0-9]{32})/i);

  let eventGUID = null, tourneyDate = null;

  if (eventMatch) {
    eventGUID = eventMatch[1].toUpperCase();
  } else if (schedMatch) {
    const tGUID    = schedMatch[1].toUpperCase();
    const schedHtml = await fetchHTML(`${FTL}/tournaments/eventSchedule/${tGUID}`).catch(() => '');
    const dm = schedHtml.match(/(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\s+(\w+\s+\d{1,2},\s+\d{4})|(\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4})/i);
    if (dm) { const d = new Date((dm[1]||dm[2]).trim()); if (!isNaN(d)) tourneyDate = d.toISOString().slice(0,10); }
    const guids = [...new Set([
      ...[...schedHtml.matchAll(/data-href="\/events\/(?:view|results)\/([A-F0-9]{32})"/gi)].map(m=>m[1].toUpperCase()),
      ...[...schedHtml.matchAll(/href="\/events\/(?:view|results)\/([A-F0-9]{32})"/gi)].map(m=>m[1].toUpperCase()),
    ])];
    if (guids.length) eventGUID = guids[0];
  }

  if (!eventGUID) { console.warn('Could not extract event GUID'); return results; }

  const eventData      = await fetchJSON(`${FTL}/events/results/data/${eventGUID}`);
  const allEventFencers = Object.values(eventData || {});
  const evHtml         = await fetchHTML(`${FTL}/events/results/${eventGUID}`).catch(() => '');
  const $ev            = cheerio.load(evHtml);
  const eventName      = $ev('title').text().trim() || 'Unknown Event';
  const poolGUIDs = [], tabGUIDs = [];
  $ev('a[href*="/pools/scores/"]').each((_,a)=>{ const m=$ev(a).attr('href')?.match(/\/pools\/scores\/[A-F0-9]{32}\/([A-F0-9]{32})/i); if(m&&!poolGUIDs.includes(m[1].toUpperCase()))poolGUIDs.push(m[1].toUpperCase()); });
  $ev('a[href*="/tableaus/scores/"]').each((_,a)=>{ const m=$ev(a).attr('href')?.match(/\/tableaus\/scores\/[A-F0-9]{32}\/([A-F0-9]{32})/i); if(m&&!tabGUIDs.includes(m[1].toUpperCase()))tabGUIDs.push(m[1].toUpperCase()); });

  for (const fencer of allFencers) {
    const [surname] = fencer.name.split(' ');
    const match = allEventFencers.find(ef => ef.search?.toUpperCase().includes(surname.toUpperCase()));
    if (!match) continue;

    const poolBouts = (await Promise.all(poolGUIDs.map(g => scrapeFTLPool(eventGUID, g, surname).catch(() => [])))).flat();
    const deBouts   = (await Promise.all(tabGUIDs.map(g => scrapeFTLTableau(eventGUID, g, surname).catch(() => [])))).flat();

    const comp = {
      ukrTourneyId: eventGUID,
      tourneyName:  eventName,
      eventName:    null,
      date:         tourneyDate,
      rank:         parseInt(match.place) || null,
      fieldSize:    allEventFencers.filter(f => !f.excluded).length,
      poolBouts,
      deBouts,
    };

    await saveScrapedData(fencer.id, { competitions: [comp] });
    console.log(`  ${fencer.name}: ${poolBouts.length} pool + ${deBouts.length} DE`);
    results.competitions.push(comp);
  }

  return results;
}

// ── FTL pool (manual Add Tournament only) ────────────────────────────────────

async function scrapeFTLPool(eventGUID, poolGUID, surname) {
  const pageUrl  = `${FTL}/pools/scores/${eventGUID}/${poolGUID}`;
  const pageHtml = await fetchHTML(pageUrl);
  const idsMatch = pageHtml.match(/var ids = \[([\s\S]*?)\]/);
  const subGuids = idsMatch ? [...idsMatch[1].matchAll(/([A-F0-9]{32})/gi)].map(m=>m[1]) : [];
  const surnameU = surname.toUpperCase();
  const bouts    = [];

  for (const sg of subGuids) {
    const html = await axios.get(`${pageUrl}/${sg}?dbut=true`, { headers: HEADERS, timeout: 10000 }).then(r=>r.data).catch(()=>'');
    if (!html.toUpperCase().includes(surnameU)) continue;
    const $ = cheerio.load(html);
    const dataRows = [];
    $('table tr').each((_,row) => { if ($(row).find('td').length >= 8) dataRows.push($(row).find('td')); });
    const fencers = dataRows.map(cells => ({ name: $(cells[0]).text().trim().split('\n')[0].trim(), cells }));
    const ourIdx  = fencers.findIndex(f => f.name.toUpperCase().includes(surnameU));
    if (ourIdx === -1) continue;
    const ourCells = fencers[ourIdx].cells;
    fencers.forEach((opp, oppIdx) => {
      if (oppIdx === ourIdx) return;
      const txt = $(ourCells[2 + oppIdx]).text().trim();
      if (!txt) return;
      const isWin = txt.startsWith('V');
      const sf    = parseInt(txt.replace(/[VD]/g,'')) || 0;
      const oppTxt = $(opp.cells[2 + ourIdx]).text().trim();
      const sa    = parseInt(oppTxt.replace(/[VD]/g,'')) || 0;
      const parts = opp.name.split(' ');
      const fmt   = parts.length > 1 ? `${parts.slice(1).join(' ')} ${parts[0][0]}${parts[0].slice(1).toLowerCase()}` : opp.name;
      bouts.push({ opponent: fmt, scoreFor: sf, scoreAgainst: sa, result: isWin ? 'Won' : 'Lost', type: 'Poule' });
    });
    break;
  }
  return bouts;
}

// ── FTL tableau (manual Add Tournament only) ──────────────────────────────────

async function scrapeFTLTableau(eventGUID, tableauGUID, surname) {
  const surnameUpper = surname.toUpperCase();
  const bouts = [];
  const seen  = new Set();

  const trees = await fetchJSON(`${FTL}/tableaus/scores/${eventGUID}/${tableauGUID}/trees`);
  if (!Array.isArray(trees) || !trees.length) return [];

  // Round name from table index. 0 = leftmost (biggest bracket), numTables-1 = Final.
  function getRoundName(tableIdx, numTables) {
    const fromRight = numTables - 1 - tableIdx;
    if (fromRight === 0) return 'Final';
    if (fromRight === 1) return 'Semi Final';
    if (fromRight === 2) return 'Quarter Final';
    return `Table of ${Math.pow(2, fromRight + 1)}`;
  }

  // FTL name format: "SURNAME Firstname" or "(N) SURNAME Firstname CLUB / COUNTRY"
  // Convert to "Firstname Surname"
  function ftlFormatName(raw) {
    // Strip seed number prefix
    const clean = raw.replace(/^\(\d+\)\s*/, '').trim();
    // Strip club/country suffix (anything after multiple spaces or slash pattern)
    const nameOnly = clean.replace(/\s{2,}.*$/, '').replace(/\s+\/.*$/, '').trim();
    const words = nameOnly.split(/\s+/);
    if (words.length < 2) return nameOnly;
    // Find split: surname is all-caps word(s), first name is mixed case
    let splitAt = 1;
    for (let i = 1; i < words.length; i++) {
      if (words[i] !== words[i].toUpperCase()) { splitAt = i; break; }
      splitAt = i + 1;
    }
    const sur   = words.slice(0, splitAt).join(' ');
    const first = words.slice(splitAt).join(' ');
    if (!first) return sur;
    return `${first} ${sur[0]}${sur.slice(1).toLowerCase()}`;
  }

  for (const tree of trees) {
    const numTables = tree.numTables || 0;

    // Fetch all table HTML upfront
    const tableTexts = [];
    for (let t = 0; t < numTables; t++) {
      const url  = `${FTL}/tableaus/scores/${eventGUID}/${tableauGUID}/trees/${tree.guid}/tables/${t}/4`;
      const html = await axios.get(url, { headers: HEADERS, timeout: 10000 }).then(r => r.data).catch(() => '');
      // FTL tableaux use divs/spans, not tr/td. Extract visible text.
      const $    = cheerio.load(html);
      // Remove script/style tags then get text
      $('script, style').remove();
      const rawText = $.root().text();
      // Split into lines, clean up
      const lines = rawText.split(/\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(l => l);
      tableTexts.push({ t, lines, hasUs: html.toUpperCase().includes(surnameUpper) });
    }

    // For each table where our fencer appears (except the last — Final has no next table)
    for (let t = 0; t < numTables - 1; t++) {
      const cur  = tableTexts[t];
      const next = tableTexts[t + 1];
      if (!cur || !cur.hasUs) continue;

      const roundName = getRoundName(t, numTables);

      // Extract ordered list of fencer entries from the current table text.
      // Entries look like: "(N) SURNAME Firstname" or "(N) - BYE -"
      const nameEntries = cur.lines.filter(l => /^\(\d+\)/.test(l));

      // Find our position (0-indexed)
      const ourIdx = nameEntries.findIndex(e => e.toUpperCase().includes(surnameUpper));
      if (ourIdx === -1) continue;

      // Odd 1-indexed = fights below (oppIdx = ourIdx + 1)
      // Even 1-indexed = fights above (oppIdx = ourIdx - 1)
      const pos1   = ourIdx + 1;
      const oppIdx = pos1 % 2 === 1 ? ourIdx + 1 : ourIdx - 1;
      const oppRaw = nameEntries[oppIdx];
      if (!oppRaw || oppRaw.includes('BYE')) continue; // BYE — no bout

      const oppName = ftlFormatName(oppRaw);

      // Find winner: check next table — whichever of our fencer / opponent appears in
      // the slot at floor(ourIdx/2)
      const nextEntries = next ? next.lines.filter(l => /^\(\d+\)/.test(l)) : [];
      const winnerSlot  = Math.floor(ourIdx / 2);
      const winnerEntry = nextEntries[winnerSlot] || '';
      const weWon       = winnerEntry.toUpperCase().includes(surnameUpper);

      // Score: shown under the winner's name in the next table.
      // In the next table lines, find the winner entry then look for "X - Y" nearby.
      let scoreWinner = null, scoreLoser = null;
      if (next) {
        const winnerLineIdx = next.lines.findIndex(l => l.toUpperCase().includes(surnameUpper) && /^\(\d+\)/.test(l));
        const oppLineIdx    = next.lines.findIndex(l => l.toUpperCase().includes(oppName.split(' ')[0].toUpperCase()) && /^\(\d+\)/.test(l));
        const searchFrom    = weWon ? winnerLineIdx : oppLineIdx;
        if (searchFrom !== -1) {
          // Look for score in lines after the winner entry
          for (let i = searchFrom + 1; i < Math.min(searchFrom + 8, next.lines.length); i++) {
            const sm = next.lines[i].match(/^(\d+)\s*[-–]\s*(\d+)$/);
            if (sm) {
              scoreWinner = parseInt(sm[1]);
              scoreLoser  = parseInt(sm[2]);
              break;
            }
          }
        }
      }

      const sf = weWon ? scoreWinner : scoreLoser;
      const sa = weWon ? scoreLoser  : scoreWinner;

      const key = `${roundName}|${oppName}`;
      if (seen.has(key)) continue;
      seen.add(key);

      bouts.push({
        opponent:     oppName,
        scoreFor:     sf   ?? null,
        scoreAgainst: sa   ?? null,
        result:       weWon ? 'Won' : 'Lost',
        type:         `DE ${roundName}`,
      });
    }
  }

  return bouts;
}

// ── Legacy API shims for scrape.js route ─────────────────────────────────────

// Route calls scrapeFromFTLUrl(ftlUrl, { coachMode, allFencers, fencerId, fencerName })
// and expects back an object keyed by fencerId: { [fencerId]: { competitions, fencer } }
async function scrapeFromFTLUrlLegacy(ftlUrl, opts = {}) {
  const { coachMode = false, fencerId } = opts;
  const innerResults = await scrapeFromFTLUrl(ftlUrl, fencerId, coachMode);

  // Build the shape the route expects
  const { data: allFencers } = coachMode
    ? await supabase.from('fencers').select('*')
    : await supabase.from('fencers').select('*').eq('id', fencerId);

  const shaped = {};
  (allFencers || []).forEach(f => {
    const fComp = innerResults.competitions.filter(c => c.fencerId === f.id || !c.fencerId);
    if (fComp.length) shaped[f.id] = { fencer: f, competitions: fComp };
  });
  return shaped;
}

// Route calls saveManualTournamentData(scrapeResults) after scrapeFromFTLUrl
// New scraper already saves inside scrapeFromFTLUrl, so this is a no-op
async function saveManualTournamentData(scrapeResults) {
  return 0;
}

module.exports = {
  syncFencer,
  scrapeFencer,
  saveScrapedData,
  scrapeFromFTLUrl: scrapeFromFTLUrlLegacy,
  saveManualTournamentData,
};
