/**
 * Allez Fencing Hub — Scraper v6 (UKRatings-first)
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
    if (!rank && !fieldSize) return;
    const key = `${ukrTourneyId}|${eventName}`;
    if (seen.has(key)) return;
    seen.add(key);
    competitions.push({ ukrTourneyId, tourneyName, eventName, rank, fieldSize });
  });

  return competitions;
}

async function getEventFinalResultsId(ukrTourneyId, eventName) {
  const html = await fetchHTML(`${UKR}/tourneys/tourneydetail/${ukrTourneyId}`);
  const $ = cheerio.load(html);
  const normalise = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = normalise(eventName);
  let eventFinalResultsId = null;
  $('tr[onclick*="eventfinalresults"]').each((_, tr) => {
    const text    = $(tr).text().replace(/\s+/g, ' ').trim();
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

async function getEventDetails(eventFinalResultsId) {
  const html = await fetchHTML(`${UKR}/tourneys/eventfinalresults/${eventFinalResultsId}`);
  const $ = cheerio.load(html);
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

async function scrapePoolBouts(poolId, surname) {
  const html = await fetchHTML(`${UKR}/tourneys/eventroundpoolmatches/${poolId}`);
  const $ = cheerio.load(html);
  const bouts = [];
  const surnameUpper = surname.toUpperCase();
  $('table tr').each((_, tr) => {
    const cells = $(tr).find('td').map((_, td) => $(td).text().trim()).get();
    if (cells.length < 5) return;
    if (!cells.some(c => c.toUpperCase().includes(surnameUpper))) return;
    const weAreA = cells[1].toUpperCase().includes(surnameUpper);
    const opp    = weAreA ? cells[4] : cells[1];
    const sf     = weAreA ? parseInt(cells[2]) : parseInt(cells[3]);
    const sa     = weAreA ? parseInt(cells[3]) : parseInt(cells[2]);
    if (isNaN(sf) || isNaN(sa) || !opp || opp.includes('BYE')) return;
    bouts.push({ opponent: formatName(opp), scoreFor: sf, scoreAgainst: sa, result: sf > sa ? 'Won' : 'Lost', type: 'Poule' });
  });
  return bouts;
}

async function scrapeElimBouts(elimId, surname) {
  const html = await fetchHTML(`${UKR}/tourneys/eventelim/${elimId}`);
  const $ = cheerio.load(html);
  const surnameUpper = surname.toUpperCase();
  const items = [];
  let currentRound = '';
  function walk(el) {
    const txt = $(el).text().trim();
    if (txt.match(/^Round \d+$/) || txt.match(/^(Semi Finals|Quarter Finals|Finals)$/)) currentRound = txt;
    const children = $(el).children().toArray();
    if (children.length === 0) {
      if (txt) items.push({ round: currentRound, text: txt, cls: el.attribs?.class || $(el).parent().attr('class') || '' });
    } else {
      children.forEach(c => walk(c));
    }
  }
  $('body').children().toArray().forEach(el => walk(el));
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
      .select().single();
    if (compErr || !savedComp) { console.warn(`    Failed to save competition ${comp.tourneyName}: ${compErr?.message}`); continue; }
    const allBouts = [...(comp.poolBouts || []), ...(comp.deBouts || [])];
    for (const bout of allBouts) {
      if (!bout.opponent || bout.opponent.includes('BYE')) continue;
      const { error } = await supabase.from('bouts').upsert({
        fencer_id:      fencerId,
        competition_id: savedComp.id,
        date:           savedComp.date || null,
        opponent:       bout.opponent,
        score_for:      bout.scoreFor,
        score_against:  bout.scoreAgainst,
        result:         bout.result,
        bout_type:      bout.type,
        source:         'ukratings',
      }, { onConflict: 'fencer_id,competition_id,opponent,bout_type', ignoreDuplicates: true });
      if (!error) boutsAdded++;
    }
  }
  return boutsAdded;
}

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
        if (!eventFinalResultsId) { console.log(`    No event results page found — skipping`); return { ...comp, poolBouts: [], deBouts: [] }; }
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
    const tGUID     = schedMatch[1].toUpperCase();
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

  const eventData       = await fetchJSON(`${FTL}/events/results/data/${eventGUID}`);
  const allEventFencers = Object.values(eventData || {});
  const evHtml          = await fetchHTML(`${FTL}/events/results/${eventGUID}`).catch(() => '');
  const $ev             = cheerio.load(evHtml);
  const eventName       = $ev('title').text().trim() || 'Unknown Event';
  const poolGUIDs = [], tabGUIDs = [];
  $ev('a[href*="/pools/scores/"]').each((_,a)=>{ const m=$ev(a).attr('href')?.match(/\/pools\/scores\/[A-F0-9]{32}\/([A-F0-9]{32})/i); if(m&&!poolGUIDs.includes(m[1].toUpperCase()))poolGUIDs.push(m[1].toUpperCase()); });
  $ev('a[href*="/tableaus/scores/"]').each((_,a)=>{ const m=$ev(a).attr('href')?.match(/\/tableaus\/scores\/[A-F0-9]{32}\/([A-F0-9]{32})/i); if(m&&!tabGUIDs.includes(m[1].toUpperCase()))tabGUIDs.push(m[1].toUpperCase()); });

  for (const fencer of allFencers) {
    // Use last word of name (actual surname) since FTL lists SURNAME Firstname
    const nameParts = fencer.name.trim().split(/\s+/);
    const surname   = nameParts[nameParts.length - 1];
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
      const txt    = $(ourCells[2 + oppIdx]).text().trim();
      if (!txt) return;
      const isWin  = txt.startsWith('V');
      const sf     = parseInt(txt.replace(/[VD]/g,'')) || 0;
      const oppTxt = $(opp.cells[2 + ourIdx]).text().trim();
      const sa     = parseInt(oppTxt.replace(/[VD]/g,'')) || 0;
      const parts  = opp.name.split(' ');
      const fmt    = parts.length > 1 ? `${parts.slice(1).join(' ')} ${parts[0][0]}${parts[0].slice(1).toLowerCase()}` : opp.name;
      bouts.push({ opponent: fmt, scoreFor: sf, scoreAgainst: sa, result: isWin ? 'Won' : 'Lost', type: 'Poule' });
    });
    break;
  }
  return bouts;
}

async function scrapeFTLTableau(eventGUID, tableauGUID, surname) {
  const surnameUpper = surname.toUpperCase();
  const bouts = [];
  const seen  = new Set();

  const trees = await fetchJSON(`${FTL}/tableaus/scores/${eventGUID}/${tableauGUID}/trees`);
  if (!Array.isArray(trees) || !trees.length) return [];

  function getRoundName(tableIdx, numTables) {
    const fromRight = numTables - 1 - tableIdx;
    if (fromRight === 0) return 'Final';
    if (fromRight === 1) return 'Semi Final';
    if (fromRight === 2) return 'Quarter Final';
    return `Table of ${Math.pow(2, fromRight)}`;
  }

  function ftlFormatName(raw) {
    const noSeed = raw.replace(/^\(\d+\)\s*/, '').trim();
    const noClub = noSeed.replace(/\s+[A-Z0-9\s\-'\/]+\/\s*[A-Z]{2,3}.*$/, '').trim();
    const words  = noClub.split(/\s+/);
    if (words.length < 2) return noClub;
    let splitAt = 1;
    for (let i = 1; i < words.length; i++) {
      if (words[i] !== words[i].toUpperCase() || words[i].length <= 1) { splitAt = i; break; }
      splitAt = i + 1;
    }
    const sur   = words.slice(0, splitAt).join(' ');
    const first = words.slice(splitAt).join(' ');
    if (!first) return sur;
    return `${first} ${sur[0]}${sur.slice(1).toLowerCase()}`;
  }

  // Parse bracket order using first-occurrence-per-seed AND club filter,
  // then deduplicate so each seed appears only once.
  function parseBracketOrder(text) {
    const parts = text.split(/(?=\(\d+\))/);
    const seenSeeds = new Set();
    const ordered   = [];
    for (const part of parts) {
      const p = part.trim();
      if (!p || !/^\(\d+\)/.test(p)) continue;
      const seed   = parseInt(p.match(/^\((\d+)\)/)[1]);
      const isBye  = /BYE/i.test(p);
      const hasClub = /\/\s*[A-Z]{2,3}(\s|$)/.test(p);
      // Only keep leftmost-column entries (have club or are BYE), first occurrence per seed
      if ((isBye || hasClub) && !seenSeeds.has(seed)) {
        seenSeeds.add(seed);
        ordered.push({ seed, raw: p });
      }
    }
    return ordered;
  }

  for (const tree of trees) {
    const numTables = tree.numTables || 0;

    const tables = [];
    for (let t = 0; t < numTables; t++) {
      const url  = `${FTL}/tableaus/scores/${eventGUID}/${tableauGUID}/trees/${tree.guid}/tables/${t}/4`;
      const html = await axios.get(url, { headers: HEADERS, timeout: 10000 }).then(r => r.data).catch(() => '');
      const $    = cheerio.load(html);
      $('script,style').remove();
      const text = $.root().text().replace(/\s+/g, ' ').trim();
      tables.push({ t, text, hasUs: text.toUpperCase().includes(surnameUpper) });
    }

    for (let t = 0; t < numTables - 1; t++) {
      const cur  = tables[t];
      const next = tables[t + 1];
      if (!cur || !cur.hasUs) continue;

      const roundName = getRoundName(t, numTables);
      const curOrder  = parseBracketOrder(cur.text);
      const ourIdx    = curOrder.findIndex(e => e.raw.toUpperCase().includes(surnameUpper));
      if (ourIdx === -1) continue;

      const pos1      = ourIdx + 1;
      const oppIdx    = pos1 % 2 === 1 ? ourIdx + 1 : ourIdx - 1;
      const opp       = curOrder[oppIdx];

      // DEBUG — remove once working correctly
      console.log(`DE t=${t} round=${roundName} ourIdx=${ourIdx} pos1=${pos1} oppIdx=${oppIdx} opp="${opp?.raw?.slice(0,40)}" byeSkip=${opp?.raw?.includes('BYE')} weWon=${next.text.toUpperCase().includes(surnameUpper)}`);

      if (!opp || opp.raw.includes('BYE')) continue;

      const oppName = ftlFormatName(opp.raw);
      const weWon   = next.text.toUpperCase().includes(surnameUpper);

      let scoreWinner = null, scoreLoser = null;
      const winnerName = weWon ? surnameUpper : opp.raw.match(/^\(\d+\)\s*([A-Z]{2,})/)?.[1] || '';
      if (winnerName) {
        const idx = next.text.toUpperCase().indexOf(winnerName);
        if (idx !== -1) {
          const after = next.text.slice(idx, idx + 200);
          const sm = after.match(/(\d+)\s*[-–]\s*(\d+)/);
          if (sm) { scoreWinner = parseInt(sm[1]); scoreLoser = parseInt(sm[2]); }
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

async function scrapeFromFTLUrlLegacy(ftlUrl, opts = {}) {
  const { coachMode = false, fencerId } = opts;
  const innerResults = await scrapeFromFTLUrl(ftlUrl, fencerId, coachMode);
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

async function saveManualTournamentData(scrapeResults) { return 0; }

module.exports = { syncFencer, scrapeFencer, saveScrapedData, scrapeFromFTLUrl: scrapeFromFTLUrlLegacy, saveManualTournamentData };
