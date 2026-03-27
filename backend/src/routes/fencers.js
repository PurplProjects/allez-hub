const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const supabase = require('../db/supabase');

// All fencer routes require login
router.use(auth);

// ── GET /api/fencers/me ───────────────────────────────────────
// Returns the logged-in fencer's full profile + computed stats
router.get('/me', async (req, res) => {
  const fencerId = req.user.fencerId;
  if (!fencerId) return res.status(403).json({ error: 'No fencer linked to this account' });

  const { data: fencer } = await supabase
    .from('fencers')
    .select('*')
    .eq('id', fencerId)
    .single();

  const { data: bouts } = await supabase
    .from('bouts')
    .select('*, competitions(name, date, rank, field_size)')
    .eq('fencer_id', fencerId)
    .order('date', { ascending: false });

  const { data: comps } = await supabase
    .from('competitions')
    .select('*')
    .eq('fencer_id', fencerId)
    .order('date', { ascending: false });

  res.json({
    fencer,
    stats: computeStats(bouts || [], comps || []),
    bouts: bouts || [],
    competitions: comps || [],
  });
});

// ── GET /api/fencers/me/bouts ─────────────────────────────────
// Paginated, filterable bout history
router.get('/me/bouts', async (req, res) => {
  const fencerId = req.user.fencerId;
  const { year, competition, type, result, opponent, page = 1, limit = 50 } = req.query;

  let query = supabase
    .from('bouts')
    .select('*, competitions(name)', { count: 'exact' })
    .eq('fencer_id', fencerId)
    .order('date', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  if (year)        query = query.gte('date', `${year}-01-01`).lte('date', `${year}-12-31`);
  if (type) {
    if (type === 'DE') {
      query = query.like('bout_type', 'DE%');
    } else {
      query = query.eq('bout_type', type);
    }
  }
  if (result)      query = query.eq('result', result);
  if (opponent)    query = query.ilike('opponent', `%${opponent}%`);
  if (competition) query = query.eq('competition_id', competition);

  const { data, count } = await query;
  res.json({ bouts: data || [], total: count, page: Number(page), limit: Number(limit) });
});

// ── GET /api/fencers/me/checklist ─────────────────────────────
router.get('/me/checklist', async (req, res) => {
  const { date } = req.query;
  const checkDate = date || new Date().toISOString().split('T')[0];

  const { data } = await supabase
    .from('checklist_state')
    .select('item_index, completed')
    .eq('fencer_id', req.user.fencerId)
    .eq('checklist_date', checkDate);

  const completed = (data || []).filter(r => r.completed).map(r => r.item_index);
  res.json({ date: checkDate, completed });
});

// ── POST /api/fencers/me/checklist ────────────────────────────
router.post('/me/checklist', async (req, res) => {
  const { date, itemIndex, completed } = req.body;
  const checkDate = date || new Date().toISOString().split('T')[0];

  await supabase.from('checklist_state').upsert({
    fencer_id:      req.user.fencerId,
    checklist_date: checkDate,
    item_index:     itemIndex,
    completed,
    completed_at:   new Date().toISOString(),
  }, { onConflict: 'fencer_id,checklist_date,item_index' });

  res.json({ success: true });
});

// ── Compute stats from raw bouts + comps ─────────────────────
function computeStats(bouts, comps) {
  if (!bouts.length) return {};

  const won   = bouts.filter(b => b.result === 'Won').length;
  const total = bouts.length;
  const poule = bouts.filter(b => b.bout_type === 'Poule');
  const de    = bouts.filter(b => b.bout_type?.startsWith('DE'));

  // By year
  const byYear = {};
  bouts.forEach(b => {
    const y = b.date?.slice(0, 4);
    if (!y) return;
    if (!byYear[y]) byYear[y] = { won: 0, total: 0, pouleW: 0, pouleT: 0, deW: 0, deT: 0, ts: 0, tr: 0 };
    byYear[y].total++;
    byYear[y].ts += b.score_for;
    byYear[y].tr += b.score_against;
    if (b.result === 'Won') byYear[y].won++;
    if (b.bout_type === 'Poule') { byYear[y].pouleT++; if (b.result === 'Won') byYear[y].pouleW++; }
    if (b.bout_type?.startsWith('DE'))    { byYear[y].deT++;    if (b.result === 'Won') byYear[y].deW++; }
  });

  // Rival analysis (opponents faced 3+ times)
  const oppMap = {};
  bouts.forEach(b => {
    if (!oppMap[b.opponent]) oppMap[b.opponent] = { enc: 0, wins: 0, tsFor: 0, tsAgainst: 0, firstDate: b.date };
    oppMap[b.opponent].enc++;
    if (b.result === 'Won') oppMap[b.opponent].wins++;
    oppMap[b.opponent].tsFor     += b.score_for;
    oppMap[b.opponent].tsAgainst += b.score_against;
    if (b.date < oppMap[b.opponent].firstDate) oppMap[b.opponent].firstDate = b.date;
  });
  const rivals = Object.entries(oppMap)
    .filter(([, v]) => v.enc >= 3)
    .map(([name, v]) => ({
      name,
      enc:        v.enc,
      wins:       v.wins,
      winPct:     Math.round(v.wins / v.enc * 100),
      avgFor:     +(v.tsFor / v.enc).toFixed(1),
      avgAgainst: +(v.tsAgainst / v.enc).toFixed(1),
    }))
    .sort((a, b) => b.enc - a.enc);

  // New vs repeat opponent split
  const firstMet = {};
  const sortedBouts = [...bouts].sort((a, b) => a.date?.localeCompare(b.date));
  sortedBouts.forEach(b => { if (!firstMet[b.opponent]) firstMet[b.opponent] = b.date; });
  const newOpp    = bouts.filter(b => b.date === firstMet[b.opponent]);
  const repeatOpp = bouts.filter(b => b.date !== firstMet[b.opponent]);

  // Monthly win rates
  const byMonth = {};
  bouts.forEach(b => {
    const m = b.date?.slice(5, 7);
    if (!m) return;
    if (!byMonth[m]) byMonth[m] = { won: 0, total: 0 };
    byMonth[m].total++;
    if (b.result === 'Won') byMonth[m].won++;
  });

  const avgNet = total ? +((bouts.reduce((s, b) => s + (b.score_for - b.score_against), 0) / total).toFixed(2)) : 0;

  return {
    career: {
      events:     comps.length,
      bouts:      total,
      won,
      winPct:     Math.round(won / total * 100),
      top8:       comps.filter(c => c.rank && c.field_size && c.rank <= 8).length,
      medals:     comps.filter(c => c.rank && c.rank <= 3).length,
      pouleWinPct: poule.length ? Math.round(poule.filter(b => b.result === 'Won').length / poule.length * 100) : 0,
      deWinPct:    de.length    ? Math.round(de.filter(b => b.result === 'Won').length / de.length * 100) : 0,
      avgNet,
    },
    byYear,
    rivals,
    newOppWinPct:    newOpp.length    ? Math.round(newOpp.filter(b => b.result === 'Won').length / newOpp.length * 100) : 0,
    repeatOppWinPct: repeatOpp.length ? Math.round(repeatOpp.filter(b => b.result === 'Won').length / repeatOpp.length * 100) : 0,
    byMonth,
  };
}

module.exports = router;
