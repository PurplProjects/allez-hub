const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const supabase = require('../db/supabase');
const { scrapeFencer, saveScrapedData } = require('../services/scraper');

router.use(auth);

// In-memory scrape status (resets on server restart — that's fine)
const scrapeStatus = {};

// ── POST /api/scrape/:fencerId ────────────────────────────────
// Fires off a background scrape — returns immediately
// Poll GET /api/scrape/:fencerId/status for progress
router.post('/:fencerId', async (req, res) => {
  const { fencerId } = req.params;

  if (req.user.role !== 'coach' && req.user.fencerId !== fencerId) {
    return res.status(403).json({ error: 'Not authorised' });
  }

  const { data: fencer } = await supabase
    .from('fencers').select('*').eq('id', fencerId).single();

  if (!fencer) return res.status(404).json({ error: 'Fencer not found' });

  // Don't allow concurrent scrapes for the same fencer
  if (scrapeStatus[fencerId]?.running) {
    return res.json({ success: true, message: 'Sync already in progress', status: scrapeStatus[fencerId] });
  }

  // Throttle — max once per 30 minutes
  const { data: lastScrape } = await supabase
    .from('scrape_log')
    .select('scraped_at')
    .eq('fencer_id', fencerId)
    .order('scraped_at', { ascending: false })
    .limit(1)
    .single();

  if (lastScrape) {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
    if (new Date(lastScrape.scraped_at) > thirtyMinAgo) {
      return res.status(429).json({
        error: 'Synced recently — please wait 30 minutes between syncs',
        lastSync: lastScrape.scraped_at,
      });
    }
  }

  // Determine sync mode for the user message
  const syncMode = lastScrape ? 'incremental' : 'full';
  const modeMsg  = syncMode === 'incremental'
    ? `Incremental sync — checking only tournaments since last sync`
    : `Full sync — scanning all FTL tournaments (takes 2-4 minutes)`;

  // Mark as running
  scrapeStatus[fencerId] = {
    running:  true,
    started:  new Date().toISOString(),
    syncMode,
    message:  modeMsg,
    found:    0,
    boutsAdded: 0,
  };

  // Return immediately — scrape runs in background
  res.json({
    success:  true,
    syncMode,
    message:  `${modeMsg}. Poll /status for progress.`,
    fencer:   fencer.name,
  });

  // Background scrape
  (async () => {
    try {
      scrapeStatus[fencerId].message = 'Fetching tournament list from FTL...';
      const scrapedData = await scrapeFencer(fencer);

      scrapeStatus[fencerId].message = `Found ${scrapedData.competitions.length} events — saving to database...`;
      scrapeStatus[fencerId].found   = scrapedData.competitions.length;

      const boutsAdded = await saveScrapedData(fencerId, scrapedData);

      scrapeStatus[fencerId] = {
        running:              false,
        completed:            new Date().toISOString(),
        syncMode:             scrapedData.syncMode,
        message:              `Done — ${boutsAdded} bouts saved across ${scrapedData.competitions.length} events`,
        found:                scrapedData.competitions.length,
        boutsAdded,
        tournamentsChecked:   scrapedData.tournamentsChecked,
        eventsChecked:        scrapedData.eventsChecked,
        errors:               scrapedData.errors.slice(0, 3),
      };
    } catch (err) {
      console.error('Scrape failed:', err);
      scrapeStatus[fencerId] = {
        running:   false,
        completed: new Date().toISOString(),
        message:   `Error: ${err.message}`,
        error:     true,
      };
    }
  })();
});

// ── GET /api/scrape/:fencerId/status ──────────────────────────
router.get('/:fencerId/status', async (req, res) => {
  const inMemory = scrapeStatus[req.params.fencerId];

  // Also check DB for last completed scrape
  const { data: dbLog } = await supabase
    .from('scrape_log')
    .select('scraped_at, status, bouts_added')
    .eq('fencer_id', req.params.fencerId)
    .order('scraped_at', { ascending: false })
    .limit(1)
    .single();

  res.json({
    inProgress: inMemory?.running || false,
    current:    inMemory || null,
    lastSync:   dbLog || null,
  });
});

module.exports = router;
