const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const supabase = require('../db/supabase');

router.use(auth);

// ── GET /api/bouts — filterable bout list ─────────────────────
router.get('/', async (req, res) => {
  const { year, competition_id, bout_type, result, opponent, page = 1, limit = 100 } = req.query;
  const fencerId = req.user.fencerId;
  if (!fencerId) return res.status(403).json({ error: 'No fencer linked to this account' });

  let query = supabase
    .from('bouts')
    .select('*, competitions(name, date)', { count: 'exact' })
    .eq('fencer_id', fencerId)
    .order('date', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  if (year)           query = query.gte('date', `${year}-01-01`).lte('date', `${year}-12-31`);
  if (competition_id) query = query.eq('competition_id', competition_id);
  if (bout_type)      query = query.eq('bout_type', bout_type);
  if (result)         query = query.eq('result', result);
  if (opponent)       query = query.ilike('opponent', `%${opponent}%`);

  const { data, count, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ bouts: data || [], total: count, page: Number(page), limit: Number(limit) });
});

// ── GET /api/bouts/competitions/search — search competitions ──
// ?q=search_term&fencer_id=uuid (fencer_id only used by coach)
router.get('/competitions/search', async (req, res) => {
  const { q = '', fencer_id } = req.query;
  const isCoach  = req.user.role === 'coach';

  // Fencer can only see their own; coach can specify a fencer_id
  let targetFencerId;
  if (isCoach && fencer_id) {
    targetFencerId = fencer_id;
  } else if (req.user.fencerId) {
    targetFencerId = req.user.fencerId;
  } else {
    return res.status(403).json({ error: 'No fencer specified' });
  }

  const { data, error } = await supabase
    .from('competitions')
    .select('id, name, date, rank, field_size, event_name')
    .eq('fencer_id', targetFencerId)
    .ilike('name', `%${q}%`)
    .order('date', { ascending: false })
    .limit(20);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ competitions: data || [] });
});

// ── GET /api/bouts/competitions/:id — get competition + bouts ─
router.get('/competitions/:id', async (req, res) => {
  const isCoach = req.user.role === 'coach';
  const fencerId = req.user.fencerId;

  const { data: comp, error: compErr } = await supabase
    .from('competitions')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (compErr || !comp) return res.status(404).json({ error: 'Competition not found' });

  // Ownership check
  if (!isCoach && comp.fencer_id !== fencerId)
    return res.status(403).json({ error: 'Access denied' });

  const { data: bouts, error: boutsErr } = await supabase
    .from('bouts')
    .select('*')
    .eq('competition_id', comp.id)
    .order('bout_type', { ascending: true });

  if (boutsErr) return res.status(500).json({ error: boutsErr.message });
  res.json({ competition: comp, bouts: bouts || [] });
});

// ── PUT /api/bouts/competitions/:id — update competition ──────
router.put('/competitions/:id', async (req, res) => {
  const isCoach  = req.user.role === 'coach';
  const fencerId = req.user.fencerId;
  const { name, date, rank, field_size } = req.body;

  const { data: comp } = await supabase
    .from('competitions').select('fencer_id').eq('id', req.params.id).single();

  if (!comp) return res.status(404).json({ error: 'Competition not found' });
  if (!isCoach && comp.fencer_id !== fencerId)
    return res.status(403).json({ error: 'Access denied' });

  const { data, error } = await supabase
    .from('competitions')
    .update({ name, date, rank: Number(rank), field_size: Number(field_size) })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ competition: data });
});

// ── PUT /api/bouts/:id — update a single bout ─────────────────
router.put('/:id', async (req, res) => {
  const isCoach  = req.user.role === 'coach';
  const fencerId = req.user.fencerId;
  const { opponent, score_for, score_against, result, bout_type, comments } = req.body;

  const { data: bout } = await supabase
    .from('bouts').select('fencer_id').eq('id', req.params.id).single();

  if (!bout) return res.status(404).json({ error: 'Bout not found' });
  if (!isCoach && bout.fencer_id !== fencerId)
    return res.status(403).json({ error: 'Access denied' });

  const { data, error } = await supabase
    .from('bouts')
    .update({ opponent, score_for: Number(score_for), score_against: Number(score_against), result, bout_type, comments })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ bout: data });
});

// ── DELETE /api/bouts/:id — delete a bout ─────────────────────
router.delete('/:id', async (req, res) => {
  const isCoach  = req.user.role === 'coach';
  const fencerId = req.user.fencerId;

  const { data: bout } = await supabase
    .from('bouts').select('fencer_id').eq('id', req.params.id).single();

  if (!bout) return res.status(404).json({ error: 'Bout not found' });
  if (!isCoach && bout.fencer_id !== fencerId)
    return res.status(403).json({ error: 'Access denied' });

  const { error } = await supabase.from('bouts').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── POST /api/bouts/competitions/:id/bouts — add a bout ───────
router.post('/competitions/:id/bouts', async (req, res) => {
  const isCoach  = req.user.role === 'coach';
  const fencerId = req.user.fencerId;
  const { opponent, score_for, score_against, result, bout_type, comments } = req.body;

  const { data: comp } = await supabase
    .from('competitions').select('fencer_id, date').eq('id', req.params.id).single();

  if (!comp) return res.status(404).json({ error: 'Competition not found' });
  if (!isCoach && comp.fencer_id !== fencerId)
    return res.status(403).json({ error: 'Access denied' });

  const { data, error } = await supabase
    .from('bouts')
    .insert({
      fencer_id:     comp.fencer_id,
      competition_id: req.params.id,
      date:          comp.date,
      opponent,
      score_for:     Number(score_for || 0),
      score_against: Number(score_against || 0),
      result:        result || 'Lost',
      bout_type:     bout_type || 'Poule',
      comments:      comments || null,
      source:        'manual',
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ bout: data });
});

module.exports = router;
