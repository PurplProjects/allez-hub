/**
 * UKRatings Scraper
 * Pulls all competition and bout data for a fencer from ukratings.co.uk
 *
 * URL patterns used:
 *   Profile:     ukratings.co.uk/tourneys/athleteex/34/{ukr_id}/None
 *   Tourney:     ukratings.co.uk/tourneys/tourneydetail/{tourney_id}
 *   Event:       ukratings.co.uk/tourneys/eventfinalresults/{event_id}
 *   Pool grids:  ukratings.co.uk/tourneys/eventroundgrids/{round_id}
 */

const axios   = require('axios');
const cheerio = require('cheerio');
const supabase = require('../db/supabase');

const BASE    = 'https://www.ukratings.co.uk';
const DELAY   = 800;  // ms between requests — be polite to the server
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; AllezFencingHub/1.0)',
  'Accept': 'text/html',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Main entry point ──────────────────────────────────────────
async function scrapeFencer(fencer) {
  console.log(`Scraping ${fencer.name} (UKR ID: ${fencer.ukr_id})`);
  const results = { competitions: [], bouts: [], errors: [] };

  try {
    // Step 1: Load main profile page — competitions tab + DE scores tab
    const profileHtml = await fetchPage(`${BASE}/tourneys/athleteex/${fencer.ukr_weapon_id || 34}/${fencer.ukr_id}/None`);
    const $ = cheerio.load(profileHtml);

    // ── Parse competitions ───────────────────────────────────
    const compRows = [];
    $('#Competitions table').eq(2).find('tr').each((i, tr) => {
      if (i === 0) return; // skip header
      const cells = $(tr).find('td').map((_, td) => $(td).text().trim()).get();
      const onclick = $(tr).attr('onclick') || '';
      const tourneyId = (onclick.match(/tourneydetail\/(\d+)/) || [])[1];
      if (cells[0] && cells[3]) {
        const [rank, fieldSize] = cells[3].split(' of ').map(s => parseInt(s.trim()));
        compRows.push({
          tourneyId,
          name:      cells[0],
          eventName: cells[1],
          rank:      rank || null,
          fieldSize: fieldSize || null,
          category:  cells[1]?.match(/U-?(\d+)/)?.[0]?.replace('-','') || null,
        });
      }
    });

    // ── Parse DE scores ──────────────────────────────────────
    const deRows = [];
    $('#DEScores table tr').each((i, tr) => {
      if (i === 0) return;
      const cells = $(tr).find('td');
      const winLoss  = cells.eq(0).text().trim();
      const cellText = cells.eq(1).text().trim();

      // Parse: "10 - 5\n\nLEE, Marcus\nPublic Schools...\nDE Round: 32"
      const scoreMatch = cellText.match(/(\d+)\s*-\s*(\d+)/);
      const opponent   = cellText.split('\n').find(l => l.includes(','))?.trim() || 'BYE';
      const tournament = cellText.split('\n').find(l => l.length > 10 && !l.includes('Round') && !l.includes('-'))?.trim() || '';
      const roundMatch = cellText.match(/DE Round:\s*(\d+)/);

      if (scoreMatch) {
        const isBye    = opponent === 'BYE' || winLoss === 'Won';
        const scoreFor = winLoss.includes('Won') ? parseInt(scoreMatch[1]) : parseInt(scoreMatch[2]);
        const scoreAgainst = winLoss.includes('Won') ? parseInt(scoreMatch[2]) : parseInt(scoreMatch[1]);

        deRows.push({
          result:   winLoss.includes('Won') ? 'Won' : 'Lost',
          opponent: formatName(opponent),
          scoreFor,
          scoreAgainst,
          tournament,
          deRound:  roundMatch ? `T${roundMatch[1]}` : null,
          type:     'DE',
        });
      }
    });

    console.log(`  Found ${compRows.length} competitions, ${deRows.length} DE bouts`);

    // ── Step 2: For each competition, get pool bouts via eventroundgrids ──
    for (const comp of compRows.slice(0, 30)) {  // limit to last 30 events
      await sleep(DELAY);

      if (!comp.tourneyId) continue;

      try {
        // Get tournament detail page to find event IDs
        const tourneyHtml = await fetchPage(`${BASE}/tourneys/tourneydetail/${comp.tourneyId}`);
        const $t = cheerio.load(tourneyHtml);

        // Find the event that matches this fencer's event name
        let eventId = null;
        $t('table tr').each((_, tr) => {
          const onclick = $t(tr).attr('onclick') || '';
          const rowText = $t(tr).text().trim();
          const evIdMatch = onclick.match(/eventfinalresults\/(\d+)/);
          if (evIdMatch && rowText.toLowerCase().includes(
            (comp.eventName || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6)
          )) {
            eventId = evIdMatch[1];
          }
        });

        if (!eventId) continue;

        await sleep(DELAY);

        // Get event final results page to find pool round IDs
        const eventHtml = await fetchPage(`${BASE}/tourneys/eventfinalresults/${eventId}`);
        const $e = cheerio.load(eventHtml);

        const roundIds = [];
        $e('a[href*="eventroundgrids"]').each((_, a) => {
          const m = ($e(a).attr('href') || '').match(/eventroundgrids\/(\d+)/);
          if (m && !roundIds.includes(m[1])) roundIds.push(m[1]);
        });

        // Get pool grids for each round
        for (const roundId of roundIds) {
          await sleep(DELAY);
          const poolBouts = await scrapePoolRound(roundId, fencer.name, comp.name);
          comp.poolBouts = [...(comp.poolBouts || []), ...poolBouts];
        }
      } catch (err) {
        console.warn(`  Could not scrape pool for ${comp.name}: ${err.message}`);
        results.errors.push(`${comp.name}: ${err.message}`);
      }
    }

    // ── Step 3: Assemble results ─────────────────────────────
    // Match DE bouts to competitions by tournament name
    for (const comp of compRows) {
      const compDEs = deRows.filter(d =>
        d.tournament.toLowerCase().includes(comp.name.toLowerCase().slice(0, 15))
      );
      comp.deBouts = compDEs;
    }

    results.competitions = compRows;
    results.bouts = [
      ...deRows,
      ...compRows.flatMap(c => c.poolBouts || []),
    ];

  } catch (err) {
    console.error(`Failed to scrape ${fencer.name}:`, err.message);
    results.errors.push(err.message);
  }

  return results;
}

// ── Scrape a single pool round grid page ─────────────────────
async function scrapePoolRound(roundId, fencerName, compName) {
  const html = await fetchPage(`${BASE}/tourneys/eventroundgrids/${roundId}`);
  const $ = cheerio.load(html);
  const bouts = [];

  // Each pool is 3 consecutive tables: names | score grid | stats
  const tables = $('table').toArray();

  for (let i = 0; i < tables.length; i += 3) {
    const nameTable  = tables[i];
    const scoreTable = tables[i + 1];
    if (!nameTable || !scoreTable) break;

    const names = [];
    $(nameTable).find('tr').each((ri, tr) => {
      if (ri === 0) return;
      const cells = $(tr).find('td').map((_, td) => $(td).text().trim()).get();
      if (cells[1]) names.push(formatName(cells[1]));
    });

    // Find which position our fencer is
    const fencerIdx = names.findIndex(n =>
      n.toLowerCase().includes(fencerName.split(' ')[1]?.toLowerCase() || '')
    );
    if (fencerIdx === -1) continue;

    // Read scores from grid — rows are indexed 1..n
    const scoreRows = $(scoreTable).find('tr').toArray().slice(1); // skip header
    const fencerRow = scoreRows[fencerIdx];
    if (!fencerRow) continue;

    $(fencerRow).find('td').each((colIdx, td) => {
      if (colIdx === 0) return; // skip row number
      const cellVal = $(td).text().trim();
      if (!cellVal || colIdx - 1 === fencerIdx) return; // skip self-vs-self

      const opponent = names[colIdx - 1];
      if (!opponent) return;

      const isVictory = cellVal.startsWith('V');
      const score = parseInt(cellVal.replace('V', '').replace('D', '')) || 0;

      // Need opponent's score — found in opponent's row, our column
      let oppScore = 0;
      const oppRow = scoreRows[colIdx - 1];
      if (oppRow) {
        const oppCells = $(oppRow).find('td').toArray();
        const ourColCell = oppCells[fencerIdx + 1];
        if (ourColCell) {
          oppScore = parseInt($(ourColCell).text().trim().replace('V','').replace('D','')) || 0;
        }
      }

      bouts.push({
        opponent,
        scoreFor:     isVictory ? score : oppScore,
        scoreAgainst: isVictory ? oppScore : score,
        result:       isVictory ? 'Won' : 'Lost',
        type:         'Poule',
        tournament:   compName,
      });
    });
  }

  return bouts;
}

// ── Save scraped data to Supabase ─────────────────────────────
async function saveScrapedData(fencerId, scrapedResults) {
  let boutsAdded = 0;

  for (const comp of scrapedResults.competitions) {
    // Upsert competition
    const { data: savedComp } = await supabase
      .from('competitions')
      .upsert({
        fencer_id:     fencerId,
        ukr_tourney_id: comp.tourneyId,
        name:          comp.name,
        event_name:    comp.eventName,
        rank:          comp.rank,
        field_size:    comp.fieldSize,
        category:      comp.category,
        source:        'ukratings',
      }, { onConflict: 'fencer_id,ukr_tourney_id', returning: 'representation' })
      .select()
      .single();

    if (!savedComp) continue;

    // Upsert bouts for this competition
    const allBouts = [...(comp.poolBouts || []), ...(comp.deBouts || [])];
    for (const bout of allBouts) {
      const { error } = await supabase.from('bouts').upsert({
        fencer_id:      fencerId,
        competition_id: savedComp.id,
        date:           savedComp.date,
        opponent:       bout.opponent,
        score_for:      bout.scoreFor,
        score_against:  bout.scoreAgainst,
        result:         bout.result,
        bout_type:      bout.type,
        de_round:       bout.deRound || null,
        source:         'ukratings',
      }, { onConflict: 'fencer_id,competition_id,opponent,bout_type' });

      if (!error) boutsAdded++;
    }
  }

  // Log the scrape
  await supabase.from('scrape_log').insert({
    fencer_id:  fencerId,
    status:     scrapedResults.errors.length ? 'partial' : 'success',
    bouts_added: boutsAdded,
    error_msg:  scrapedResults.errors.join('; ') || null,
  });

  return boutsAdded;
}

// ── Format opponent name: "SURNAME, First" → "First Surname" ─
function formatName(raw) {
  if (!raw || raw.includes('BYE')) return 'BYE';
  const parts = raw.split(',').map(s => s.trim());
  if (parts.length === 2) {
    return `${capitalise(parts[1])} ${capitalise(parts[0])}`;
  }
  return capitalise(raw);
}

function capitalise(s) {
  return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

async function fetchPage(url) {
  const res = await axios.get(url, { headers: HEADERS, timeout: 10000 });
  return res.data;
}

module.exports = { scrapeFencer, saveScrapedData };
