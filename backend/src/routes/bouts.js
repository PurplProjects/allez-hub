const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const supabase = require('../db/supabase');

router.use(auth);

router.get('/', async (req, res) => {
  const fencerId = req.user.fencerId;
  if (!fencerId) return res.status(403).json({ error: 'No fencer linked to this account' });

  const { year, competition_id, bout_type, result, opponent, page = 1, limit = 500 } = req.query;

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

module.exports = router;
