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

module.exports = router;
