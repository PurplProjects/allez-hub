const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const supabase = require('../db/supabase');
const { scrapeFencer, saveScrapedData } = require('../services/scraper');

router.use(auth);

// ── POST /api/scrape/:fencerId ────────────────────────────────
// Triggers a fresh scrape from UKRatings for a fencer
// Coach can scrape any fencer; fencers can only scrape themselves
router.post('/:fencerId', async (req, res) => {
  const { fencerId } = req.params;

  // Permission check
  if (req.user.role !== 'coach' && req.user.fencerId !== fencerId) {
    return res.status(403).json({ error: 'Not authorised' });
  }

  const { data: fencer } = await supabase
    .from('fencers')
    .select('*')
    .eq('id', fencerId)
    .single();

  if (!fencer) return res.status(404).json({ error: 'Fencer not found' });
  if (!fencer.ukr_id) return res.status(400).json({ error: 'No UKRatings ID for this fencer' });

  // Check last scrape — don't allow more than once per hour
  const { data: lastScrape } = await supabase
    .from('scrape_log')
    .select('scraped_at')
    .eq('fencer_id', fencerId)
    .eq('status', 'success')
    .order('scraped_at', { ascending: false })
    .limit(1)
    .single();

  if (lastScrape) {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    if (new Date(lastScrape.scraped_at) > hourAgo) {
      return res.status(429).json({
        error: 'Data was synced recently. Please wait before syncing again.',
        lastSync: lastScrape.scraped_at,
      });
    }
  }

  // Run scrape asynchronously — return immediately, scrape in background
  res.json({ success: true, message: 'Sync started — data will update in 1-2 minutes.' });

  // Background scrape
  scrapeFencer(fencer)
    .then(results => saveScrapedData(fencerId, results))
    .then(added => console.log(`Scraped ${fencer.name}: ${added} bouts added`))
    .catch(err => console.error(`Scrape failed for ${fencer.name}:`, err));
});

// ── GET /api/scrape/:fencerId/status ──────────────────────────
router.get('/:fencerId/status', async (req, res) => {
  const { data } = await supabase
    .from('scrape_log')
    .select('scraped_at, status, bouts_added')
    .eq('fencer_id', req.params.fencerId)
    .order('scraped_at', { ascending: false })
    .limit(1)
    .single();

  res.json(data || { status: 'never_synced' });
});

module.exports = router;
