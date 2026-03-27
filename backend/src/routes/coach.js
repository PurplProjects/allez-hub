const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const supabase = require('../db/supabase');

router.use(auth);
router.use(auth.coachOnly);  // All coach routes require coach role

// ── GET /api/coach/squad ──────────────────────────────────────
// Full squad overview with stats for each fencer
router.get('/squad', async (req, res) => {
  const { data: fencers } = await supabase
    .from('fencers')
    .select('*')
    .eq('active', true)
    .order('name');

  const squadWithStats = await Promise.all(fencers.map(async f => {
    const { data: bouts } = await supabase
      .from('bouts')
      .select('result, bout_type, score_for, score_against, date')
      .eq('fencer_id', f.id);

    const { data: comps } = await supabase
      .from('competitions')
      .select('rank, field_size, date')
      .eq('fencer_id', f.id)
      .order('date', { ascending: false });

    const b = bouts || [];
    const won   = b.filter(x => x.result === 'Won').length;
    const poule = b.filter(x => x.bout_type === 'Poule');
    const de    = b.filter(x => x.bout_type?.startsWith('DE'));

    // Year comparison for trend
    const thisYear = new Date().getFullYear().toString();
    const lastYear = (new Date().getFullYear() - 1).toString();
    const byYear = (yr) => b.filter(x => x.date?.startsWith(yr));
    const yrWinPct = (yr) => {
      const yb = byYear(yr);
      return yb.length ? Math.round(yb.filter(x => x.result === 'Won').length / yb.length * 100) : null;
    };

    return {
      ...f,
      stats: {
        events:      (comps || []).length,
        bouts:       b.length,
        winPct:      b.length ? Math.round(won / b.length * 100) : 0,
        pouleWinPct: poule.length ? Math.round(poule.filter(x=>x.result==='Won').length/poule.length*100) : 0,
        deWinPct:    de.length    ? Math.round(de.filter(x=>x.result==='Won').length/de.length*100)    : 0,
        medals:      (comps||[]).filter(c => c.rank && c.rank <= 3).length,
        top8:        (comps||[]).filter(c => c.rank && c.rank <= 8).length,
        avgNet:      b.length ? +((b.reduce((s,x)=>s+(x.score_for-x.score_against),0)/b.length).toFixed(2)) : 0,
        trend:       yrWinPct(thisYear) !== null && yrWinPct(lastYear) !== null
                       ? yrWinPct(thisYear) - yrWinPct(lastYear) : null,
        thisYearWinPct: yrWinPct(thisYear),
        recentForm:  b.slice(0, 10).map(x => x.result === 'Won' ? 'W' : 'L').join(''),
        lastEvent:   comps?.[0]?.date || null,
      }
    };
  }));

  res.json({ squad: squadWithStats });
});

// ── GET /api/coach/fencer/:id ─────────────────────────────────
// Full detail for one fencer (coach view)
router.get('/fencer/:id', async (req, res) => {
  const { data: fencer } = await supabase
    .from('fencers').select('*').eq('id', req.params.id).single();

  const { data: bouts } = await supabase
    .from('bouts').select('*, competitions(name,date,rank,field_size)')
    .eq('fencer_id', req.params.id).order('date', { ascending: false });

  const { data: notes } = await supabase
    .from('coach_notes').select('note, created_at')
    .eq('fencer_id', req.params.id).order('created_at', { ascending: false });

  res.json({ fencer, bouts: bouts || [], notes: notes || [] });
});

// ── POST /api/coach/notes ─────────────────────────────────────
router.post('/notes', async (req, res) => {
  const { fencerId, note } = req.body;
  await supabase.from('coach_notes').insert({
    fencer_id:  fencerId,
    author_id:  req.user.userId,
    note,
  });
  res.json({ success: true });
});

// ── POST /api/coach/fencers ───────────────────────────────────
// Add a new fencer to the club
router.post('/fencers', async (req, res) => {
  const { name, first_name, bf_licence, ukr_id, category, dob_year, school, colour, email } = req.body;

  // Create user account for fencer
  let userId = null;
  if (email) {
    const { data: newUser } = await supabase.from('users').insert({
      email: email.toLowerCase(),
      role: 'fencer',
      name,
    }).select().single();
    userId = newUser?.id;
  }

  const { data: fencer, error } = await supabase.from('fencers').insert({
    user_id: userId, name, first_name, bf_licence, ukr_id,
    category, dob_year, school, colour: colour || '#F97316',
  }).select().single();

  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, fencer });
});

module.exports = router;
