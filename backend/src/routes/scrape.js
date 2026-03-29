const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const supabase = require('../db/supabase');
const { scrapeFencer, saveScrapedData, scrapeFromFTLUrl, saveManualTournamentData } = require('../services/scraper');


// GET /api/scrape/debug/chromium — check what's available
router.get('/debug/chromium', async (req, res) => {
  const fs = require('fs');
  const { execSync } = require('child_process');
  
  const candidates = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/nix/var/nix/profiles/default/bin/chromium',
    '/run/current-system/sw/bin/chromium',
  ];
  
  const found = candidates.map(p => ({ path: p, exists: (() => { try { return fs.existsSync(p); } catch { return false; } })() }));
  
  let whichChromium = null;
  try { whichChromium = execSync('which chromium 2>/dev/null || which chromium-browser 2>/dev/null || which google-chrome 2>/dev/null').toString().trim(); } catch {}
  
  let lsUsr = null;
  try { lsUsr = execSync('ls /usr/bin/ | grep -i chrom 2>/dev/null').toString().trim(); } catch {}

  let envVars = {
    PLAYWRIGHT_CHROMIUM_PATH: process.env.PLAYWRIGHT_CHROMIUM_PATH,
    PUPPETEER_EXECUTABLE_PATH: process.env.PUPPETEER_EXECUTABLE_PATH,
  };
  
  res.json({ candidates: found, whichChromium, lsUsr, envVars });
});

router.use(auth);

// In-memory status tracker
const scrapeStatus = {};

// ── POST /api/scrape/:fencerId ────────────────────────────────
// Standard sync — UKRatings → FTL for UK tournaments
router.post('/:fencerId', async (req, res) => {
  const { fencerId } = req.params;

  if (req.user.role !== 'coach' && req.user.fencerId !== fencerId) {
    return res.status(403).json({ error: 'Not authorised' });
  }

  const { data: fencer } = await supabase
    .from('fencers').select('*').eq('id', fencerId).single();

  if (!fencer)        return res.status(404).json({ error: 'Fencer not found' });
  if (!fencer.ukr_id) return res.status(400).json({ error: 'No UKRatings ID for this fencer — add it first' });

  if (scrapeStatus[fencerId]?.running) {
    return res.json({ success: true, message: 'Sync already in progress', status: scrapeStatus[fencerId] });
  }

  // Throttle — 30 minutes between syncs
  const { data: lastScrape } = await supabase
    .from('scrape_log')
    .select('scraped_at')
    .eq('fencer_id', fencerId)
    .order('scraped_at', { ascending: false })
    .limit(1).single();

  if (lastScrape) {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
    if (new Date(lastScrape.scraped_at) > thirtyMinAgo) {
      return res.status(429).json({
        error: 'Synced recently — please wait 30 minutes',
        lastSync: lastScrape.scraped_at,
      });
    }
  }

  const syncMode = lastScrape ? 'incremental' : 'full';

  scrapeStatus[fencerId] = {
    running:  true,
    started:  new Date().toISOString(),
    syncMode,
    message:  syncMode === 'incremental'
      ? 'Incremental sync — checking new tournaments only'
      : 'Full sync — loading all UKRatings history',
    found: 0, boutsAdded: 0,
  };

  res.json({
    success: true, syncMode,
    message: `${syncMode === 'incremental' ? 'Incremental' : 'Full'} sync started. Poll /status for progress.`,
    fencer:  fencer.name,
  });

  // Background
  (async () => {
    try {
      const data       = await scrapeFencer(fencer);
      const boutsAdded = await saveScrapedData(fencerId, data);
      scrapeStatus[fencerId] = {
        running: false, completed: new Date().toISOString(), syncMode,
        message: `Done — ${boutsAdded} bouts saved across ${data.competitions.length} competitions`,
        found: data.competitions.length, boutsAdded,
        tournamentsChecked: data.tournamentsChecked,
        errors: data.errors.slice(0, 3),
      };
    } catch (err) {
      scrapeStatus[fencerId] = {
        running: false, completed: new Date().toISOString(),
        message: `Error: ${err.message}`, error: true,
      };
    }
  })();
});

// ── POST /api/scrape/manual ───────────────────────────────────
// Manual tournament load from FTL URL
// Body: { ftlUrl, fencerId? }
//   - If called by fencer: loads their own bouts from that event
//   - If called by coach: finds all Allez fencers in that event
router.post('/manual/tournament', async (req, res) => {
  const { ftlUrl } = req.body;

  if (!ftlUrl || !ftlUrl.includes('fencingtimelive.com')) {
    return res.status(400).json({ error: 'Please provide a valid FencingTimeLive URL' });
  }

  const isCoach = req.user.role === 'coach';

  // Get fencer details
  let fencersToLoad = [];

  if (isCoach) {
    // Coach: find all active Allez fencers
    const { data: allFencers } = await supabase
      .from('fencers')
      .select('id, name, ukr_id')
      .eq('active', true);
    fencersToLoad = allFencers || [];
  } else {
    // Fencer: just themselves
    const { data: fencer } = await supabase
      .from('fencers')
      .select('id, name')
      .eq('id', req.user.fencerId)
      .single();
    if (fencer) fencersToLoad = [fencer];
  }

  if (fencersToLoad.length === 0) {
    return res.status(404).json({ error: 'No fencers found' });
  }

  // Return immediately — run in background
  const jobId = `manual_${Date.now()}`;
  scrapeStatus[jobId] = {
    running: true,
    started: new Date().toISOString(),
    message: `Loading tournament from FTL — searching for ${fencersToLoad.length} fencer(s)`,
    ftlUrl,
  };

  res.json({
    success: true,
    jobId,
    message: `Loading tournament data. Poll /api/scrape/status/${jobId} for progress.`,
    fencers: fencersToLoad.map(f => f.name),
  });

  // Background scrape
  (async () => {
    try {
      const scrapeResults = await scrapeFromFTLUrl(ftlUrl, {
        coachMode:   isCoach,
        allFencers:  isCoach ? fencersToLoad : undefined,
        fencerId:    isCoach ? undefined : fencersToLoad[0]?.id,
        fencerName:  isCoach ? undefined : fencersToLoad[0]?.name,
      });

      const boutsAdded = await saveManualTournamentData(scrapeResults);

      const foundFencers = Object.values(scrapeResults)
        .filter(r => r.competitions?.length > 0)
        .map(r => r.fencer.name);

      scrapeStatus[jobId] = {
        running:  false,
        completed: new Date().toISOString(),
        message:  `Done — ${boutsAdded} bouts saved for: ${foundFencers.join(', ') || 'no fencers found'}`,
        boutsAdded,
        foundFencers,
      };
    } catch (err) {
      scrapeStatus[jobId] = {
        running:  false,
        completed: new Date().toISOString(),
        message:  `Error: ${err.message}`,
        error:    true,
      };
    }
  })();
});

// ── GET /api/scrape/:fencerIdOrJobId/status ───────────────────
router.get('/:id/status', async (req, res) => {
  const inMemory = scrapeStatus[req.params.id];

  const { data: dbLog } = await supabase
    .from('scrape_log')
    .select('scraped_at, status, bouts_added, sync_type')
    .eq('fencer_id', req.params.id)
    .order('scraped_at', { ascending: false })
    .limit(1)
    .single();

  res.json({
    inProgress: inMemory?.running || false,
    current:    inMemory || null,
    lastSync:   dbLog   || null,
  });
});


// GET /api/scrape/debug/ajith-bouts-csv — scrape every bout for Ajith, return CSV
// Columns: tournament, date, rank, field_size, bout_type, round, opponent, score_for, score_against, result, margin
router.get('/debug/ajith-bouts-csv', async (req, res) => {
  try {
    const axios   = require('axios');
    const cheerio = require('cheerio');

    const UKR = 'https://www.ukratings.co.uk';
    const FTL = 'https://www.fencingtimelive.com';
    const H   = { 'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept':'text/html,application/xhtml+xml', 'Accept-Language':'en-GB,en;q=0.5', 'Upgrade-Insecure-Requests':'1' };

    async function fetchHTML(url) {
      const jar = {}; let cur = url;
      for (let i = 0; i < 8; i++) {
        const r = await axios.get(cur, { headers:{...H, Cookie:Object.entries(jar).map(([k,v])=>k+'='+v).join('; ')}, timeout:20000, maxRedirects:0, validateStatus:s=>s<400 });
        (r.headers['set-cookie']||[]).forEach(c=>{const[p]=c.split(';');const[k,v]=p.split('=');if(k)jar[k.trim()]=(v||'').trim();});
        if (r.status < 300) return r.data;
        const loc = r.headers['location'];
        if (!loc) return r.data;
        cur = loc.startsWith('http') ? loc : new URL(loc, cur).href;
      }
    }
    async function fetchJSON(url) { return axios.get(url,{headers:H,timeout:10000}).then(r=>r.data).catch(()=>null); }

    function extractName(raw) {
      const s = raw.replace(/^\(\d+\)\s*/, '').trim();
      const m = s.match(/^((?:[A-Z][A-Z\s\-'\/]+\s+)*[A-Z]+(?:\s+[A-Z]+)*)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/);
      if (!m) return s.replace(/Strip\s*\d+.*/gi,'').trim();
      return m[2].trim() + ' ' + m[1][0] + m[1].slice(1).toLowerCase();
    }

    const bouts = []; // all bout rows

    // Step 1: UKRatings
    const html = await fetchHTML(UKR + '/tourneys/athleteex/34/65339/None');
    const $ = cheerio.load(html);
    const tournaments = []; const seen = new Set();
    $('tr[onclick*="tourneydetail"]').each((_,tr) => {
      const m = $(tr).attr('onclick')?.match(/tourneydetail\/(\d+)/);
      if (!m) return;
      const tid = m[1]; if (seen.has(tid)) return; seen.add(tid);
      const cells = $(tr).find('td').map((_,td)=>$(td).text().trim()).get();
      const rm = cells.join('|').match(/(\d+)\s+of\s+(\d+)/);
      tournaments.push({ tid, name:cells[0], date:cells[1]||'', rank:rm?rm[1]:'', field_size:rm?rm[2]:'' });
    });

    for (const t of tournaments) {
      try {
        // Step 2: FTL tournament GUID
        const det = await fetchHTML(UKR + '/tourneys/tourneydetail/' + t.tid);
        const gm  = det.match(/fencingtimelive\.com\/tournaments\/[^\/]+\/([A-F0-9]{32})/i);
        if (!gm) continue;
        const ftlGUID = gm[1].toUpperCase();

        // Step 3: Event GUIDs
        const sched = await fetchHTML(FTL + '/tournaments/eventSchedule/' + ftlGUID);
        const eGuids = [...new Set([
          ...[...sched.matchAll(/data-href="\/events\/(?:view|results)\/([A-F0-9]{32})"/gi)].map(m=>m[1].toUpperCase()),
          ...[...sched.matchAll(/href="\/events\/(?:view|results)\/([A-F0-9]{32})"/gi)].map(m=>m[1].toUpperCase()),
        ])];
        if (!eGuids.length) continue;

        // Step 4: Find Ajith
        let matched = null;
        for (const eg of eGuids) {
          const data = await fetchJSON(FTL + '/events/results/data/' + eg);
          if (!Array.isArray(data)) continue;
          const f = data.find(f=>(f.search||'').toLowerCase().includes('badhrinath'));
          if (f) { matched = { eg, place:f.place, fieldSize:data.filter(x=>!x.excluded).length }; break; }
        }
        if (!matched) continue;

        const rank = matched.place || t.rank;
        const fs   = matched.fieldSize || t.field_size;

        // Step 5: Get pool + tableau GUIDs
        const evHtml = await fetchHTML(FTL + '/events/results/' + matched.eg);
        const $ev = cheerio.load(evHtml);
        const pools=[], tabs=[];
        $ev('a[href*="/pools/scores/"]').each((_,a)=>{const m=$ev(a).attr('href')?.match(/\/pools\/scores\/[A-F0-9]{32}\/([A-F0-9]{32})/i);if(m&&!pools.includes(m[1].toUpperCase()))pools.push(m[1].toUpperCase());});
        $ev('a[href*="/tableaus/scores/"]').each((_,a)=>{const m=$ev(a).attr('href')?.match(/\/tableaus\/scores\/[A-F0-9]{32}\/([A-F0-9]{32})/i);if(m&&!tabs.includes(m[1].toUpperCase()))tabs.push(m[1].toUpperCase());});

        // Step 6: Pool bouts
        for (const pg of pools) {
          const ph = await fetchHTML(FTL + '/pools/scores/' + matched.eg + '/' + pg);
          const idsM = ph.match(/var ids = \[([\s\S]*?)\]/);
          const subGuids = idsM ? [...idsM[1].matchAll(/([A-F0-9]{32})/gi)].map(m=>m[1]) : [];
          for (const sg of subGuids) {
            const bh = await axios.get(FTL+'/pools/scores/'+matched.eg+'/'+pg+'/'+sg+'?dbut=true',{headers:H,timeout:10000}).then(r=>r.data).catch(()=>'');
            if (!bh.toUpperCase().includes('BADHRINATH')) continue;
            const $b = cheerio.load(bh);
            const dataRows = [];
            $b('table tr').each((_,row) => { if ($b(row).find('td').length >= 8) dataRows.push($b(row)); });
            const fencers = dataRows.map(row => ({ name: $b(row.find('td').eq(0)).text().trim().split('\n')[0].trim(), cells: row.find('td') }));
            const ourIdx = fencers.findIndex(f=>f.name.toUpperCase().includes('BADHRINATH'));
            if (ourIdx === -1) continue;
            const ourCells = fencers[ourIdx].cells;
            fencers.forEach((opp, oppIdx) => {
              if (oppIdx === ourIdx) return;
              const txt = $b(ourCells.eq(2+oppIdx)).text().trim();
              if (!txt) return;
              const isWin = txt.startsWith('V');
              const sf = parseInt(txt.replace(/[VD]/g,''))||0;
              const oppTxt = $b(opp.cells.eq(2+ourIdx)).text().trim();
              const sa = parseInt(oppTxt.replace(/[VD]/g,''))||0;
              const parts = opp.name.split(' ');
              const fmt = parts.length>1 ? parts.slice(1).join(' ')+' '+parts[0][0]+parts[0].slice(1).toLowerCase() : opp.name;
              bouts.push({ tournament:t.name, date:t.date, rank, field_size:fs, bout_type:'Poule', round:'Pool', opponent:fmt, score_for:isWin?sf:sa, score_against:isWin?sa:sf, result:isWin?'Won':'Lost', margin:(isWin?sf:sa)-(isWin?sa:sf) });
            });
            break;
          }
        }

        // Step 7: DE bouts
        const roundNames=['Table of 128','Table of 64','Table of 32','Table of 16','Quarter-Final','Semi-Final','Final'];
        for (const tg of tabs) {
          const trees = await fetchJSON(FTL+'/tableaus/scores/'+matched.eg+'/'+tg+'/trees');
          if (!Array.isArray(trees)) continue;
          for (const tree of trees) {
            for (let tn=0; tn<(tree.numTables||0); tn++) {
              const th = await axios.get(FTL+'/tableaus/scores/'+matched.eg+'/'+tg+'/trees/'+tree.guid+'/tables/'+tn+'/4',{headers:H,timeout:10000}).then(r=>r.data).catch(()=>'');
              if (!th.toUpperCase().includes('BADHRINATH')) continue;
              const round = roundNames[tn]||('Round '+(tn+1));
              const $t = cheerio.load(th);
              const rows = $t('tr').toArray().map(r=>({text:$t(r).text().trim()}));
              rows.forEach((row,i)=>{
                const clean = row.text.replace(/Strip\s*\d+/gi,'');
                const sm = clean.match(/(\d+)\s*-\s*(\d+)/);
                if (!sm||row.text.includes('BYE')) return;
                const s1=parseInt(sm[1]),s2=parseInt(sm[2]);
                if (s1>20||s2>20) return;
                const hasUs = row.text.toUpperCase().includes('BADHRINATH');
                const nameRaw = row.text.replace(/^\(\d+\)\s*/,'').replace(/\s*\d+\s*-\s*\d+[\s\S]*$/,'').trim();
                const winnerName = extractName(nameRaw);
                if (hasUs) {
                  for (const off of [-2,-1,1,2]) {
                    const o=rows[i+off]; if(!o) continue;
                    if(!o.text||o.text.includes('BYE')||/\d+-\d+/.test(o.text)) continue;
                    if(o.text.toUpperCase().includes('BADHRINATH')) continue;
                    const oppName = extractName(o.text.replace(/^\(\d+\)\s*/,'').trim());
                    if(!oppName||oppName.length<3) continue;
                    bouts.push({tournament:t.name,date:t.date,rank,field_size:fs,bout_type:'DE',round,opponent:oppName,score_for:s1,score_against:s2,result:'Won',margin:s1-s2});
                    break;
                  }
                } else {
                  for (const off of [-2,-1,1,2]) {
                    const o=rows[i+off]; if(!o) continue;
                    if(!o.text.toUpperCase().includes('BADHRINATH')) continue;
                    if(/\d+-\d+/.test(o.text)) continue;
                    if(!winnerName||winnerName.length<3) continue;
                    bouts.push({tournament:t.name,date:t.date,rank,field_size:fs,bout_type:'DE',round,opponent:winnerName,score_for:s2,score_against:s1,result:'Lost',margin:s2-s1});
                    break;
                  }
                }
              });
            }
          }
        }
      } catch(e) { /* skip failed tournaments */ }
    }

    // Build CSV
    const header = 'tournament,date,rank,field_size,bout_type,round,opponent,score_for,score_against,result,margin';
    const csvRows = bouts.map(b => [
      '"'+String(b.tournament||'').replace(/"/g,'""')+'"',
      b.date||'',
      b.rank||'',
      b.field_size||'',
      b.bout_type||'',
      '"'+String(b.round||'').replace(/"/g,'""')+'"',
      '"'+String(b.opponent||'').replace(/"/g,'""')+'"',
      b.score_for||0,
      b.score_against||0,
      b.result||'',
      b.margin||0,
    ].join(','));

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="ajith_all_bouts.csv"');
    res.send([header, ...csvRows].join('\n'));

  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});


module.exports = router;
