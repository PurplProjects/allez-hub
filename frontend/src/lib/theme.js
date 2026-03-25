// ── ALLEZ FENCING THEME ─────────────────────────────────────
// Change these values to update the entire dashboard appearance.
// No other files need to be touched for branding changes.

export const theme = {
  // Club identity
  clubName:   'Allez Fencing',
  clubShort:  'AF',
  coachName:  'Christian Galesloot',
  coachEmail: 'christian@allezfencing.com',

  // Colours — orange and black
  primary:    '#F97316',   // Allez orange
  primary2:   '#EA580C',   // darker orange (hover states)
  primaryPale:'#FFF7ED',   // very light orange (backgrounds)

  black:      '#0F0F0F',   // near-black page background
  surface1:   '#1A1A1A',   // card background
  surface2:   '#262626',   // inner card / hover
  surface3:   '#333333',   // border / divider

  textPrimary:   '#F5F5F5',
  textSecondary: '#A3A3A3',
  textTertiary:  '#737373',

  // Semantic colours — DO NOT change these
  success: '#22C55E',
  warning: '#F59E0B',
  danger:  '#EF4444',
  info:    '#3B82F6',

  // Fencer avatar colours — assigned in order when adding new fencers
  avatarColors: [
    '#F97316', '#34d399', '#60a5fa', '#a78bfa',
    '#f472b6', '#fb923c', '#4ade80', '#facc15',
  ],

  // Layout
  borderRadius: '10px',
  borderRadiusSm: '6px',
};

export const CHECKLIST_ITEMS = [
  { cat: 'sleep',  catColor: '#7c3aed', catBg: '#2e1065', title: 'Sleep & recovery',       detail: '8+ hours last night. If not, note it — it affects your body, not just your mind.' },
  { cat: 'food',   catColor: '#16a34a', catBg: '#052e16', title: 'Eaten a proper breakfast', detail: 'Carbs + protein, 2+ hours before fencing. Water bottle filled.' },
  { cat: 'mental', catColor: '#F97316', catBg: '#431407', title: 'Set one process goal',    detail: 'Write it: something you control — e.g. "vary my attack preparation vs familiar opponents".' },
  { cat: 'mental', catColor: '#F97316', catBg: '#431407', title: 'Visualised one DE bout',  detail: '5 minutes: see yourself 2-3 down, resetting, fighting back and winning the next point.' },
  { cat: 'body',   catColor: '#2563EB', catBg: '#1e3a5f', title: 'Dynamic warm-up done',   detail: '10 advance-retreat cycles, 5 lunges each leg, arm circles. Not static stretching.' },
  { cat: 'mental', catColor: '#F97316', catBg: '#431407', title: 'Cue phrase ready',        detail: 'Say your personal cue phrase once now so it is loaded and ready.' },
  { cat: 'kit',    catColor: '#64748b', catBg: '#1e293b', title: 'Kit check complete',      detail: 'Mask, jacket, glove, body wire, spare blade. All packed and checked.' },
];

export const ROUTINE_STEPS = [
  { time: 'Night before',          title: 'Review and rest',       detail: 'Look at your process goal for tomorrow. Do the 5-min visualisation. Then put your phone down — sleep is your biggest performance tool.',        cue: '' },
  { time: 'Morning — 2h before',   title: 'Eat and hydrate',       detail: 'Porridge or eggs and toast. 500ml water before you leave. No energy drinks.',                                                                   cue: '' },
  { time: 'Arrival — 30 min before',title: 'Physical warm-up',     detail: '10 advance-retreat cycles at competition pace. 5 lunges each leg. Arm circles. Blade work — 20 fast parry-ripostes.',                          cue: '' },
  { time: '5 min before each bout', title: 'Pre-bout sequence',    detail: 'Box breathing: inhale 4, hold 4, exhale 4, hold 4. Repeat 4 times. Then set your action for this specific opponent.',                         cue: 'Stay light. Attack on their advance.' },
  { time: 'At the salute',          title: 'Lock in',              detail: 'One deep breath out. Say your cue phrase. Fence.',                                                                                                cue: 'Your cue phrase' },
  { time: 'Between points',         title: 'Reset',                detail: 'Win: shake weapon hand, breathe out, say "reset". Loss: touch blade to floor, breathe out, say "that\'s done". Next point starts fresh.',       cue: '' },
  { time: 'After every bout',       title: 'One note',             detail: 'One thing that worked, one thing to adjust for the next opponent. 30 seconds — then move on.',                                                   cue: '' },
];
