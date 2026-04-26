import { useState, useEffect } from 'react';
import { getSquad, getFencerDetail, addCoachNote, triggerScrape } from '../../lib/api';
import { useTheme } from '../../hooks/useTheme';
import TopBar from '../Shared/TopBar';
import AddTournamentTab from '../Shared/AddTournamentTab';
import EditTournamentTab from '../Shared/EditTournamentTab';
import AddFencerTab from '../Shared/AddFencerTab';

const TABS = [
  { id: 'squad',      label: 'Squad' },
  { id: 'fencer',     label: 'Fencer' },
  { id: 'compare',    label: 'Comparison' },
  { id: 'tournament', label: '+ Add tournament' },
  { id: 'edit',       label: '✏️ Edit results' },
  { id: 'addfencer',  label: '➕ Add fencer' },
];

export default function CoachDashboard() {
  const { theme: T } = useTheme();

  const [activeTab,    setActiveTab]    = useState('squad');
  const [squad,        setSquad]        = useState([]);
  const [selected,     setSelected]     = useState(null);
  const [detail,       setDetail]       = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [syncingId,    setSyncingId]    = useState(null);
  const [syncAllBusy,  setSyncAllBusy]  = useState(false);
  const [note,         setNote]         = useState('');
  const [fencerTab,    setFencerTab]    = useState(null); // fencer picker in Fencer tab

  useEffect(() => { loadSquad(); }, []);

  async function loadSquad() {
    setLoading(true);
    try {
      const data = await getSquad();
      setSquad(data.squad || []);
    } finally { setLoading(false); }
  }

  async function openFencer(f) {
    setSelected(f);
    setDetail(null);
    const d = await getFencerDetail(f.id);
    setDetail(d);
  }

  async function handleSync(fencerId, e) {
    e?.stopPropagation();
    setSyncingId(fencerId);
    try {
      await triggerScrape(fencerId);
      setTimeout(loadSquad, 90000);
    } catch {}
    finally { setTimeout(() => setSyncingId(null), 3000); }
  }

  async function handleSyncAll() {
    setSyncAllBusy(true);
    for (const f of squad.filter(f => f.ukr_id)) {
      await triggerScrape(f.id).catch(() => {});
    }
    setSyncAllBusy(false);
    setTimeout(loadSquad, 90000);
  }

  async function handleAddNote() {
    if (!note.trim() || !selected) return;
    await addCoachNote(selected.id, note);
    setNote('');
    const d = await getFencerDetail(selected.id);
    setDetail(d);
  }

  function getStatus(f) {
    if (!f.ukr_id) return 'no-ukr';
    if (!f.stats?.events) return 'not-synced';
    return 'synced';
  }

  function statusBadge(f) {
    const s = getStatus(f);
    if (s === 'synced')     return { label: 'synced',     bg: '#f0fdf4', col: '#15803d', dot: '#16A34A' };
    if (s === 'not-synced') return { label: 'not synced', bg: '#f9fafb', col: '#6b7280', dot: '#9CA3AF' };
    return                         { label: 'no UKR ID',  bg: '#fffbeb', col: '#b45309', dot: '#D97706' };
  }

  function getFocusFlags(f) {
    const s = f.stats || {};
    const flags = [];
    const gap = (s.pouleWinPct || 0) - (s.deWinPct || 0);
    if (s.winPct < 45)            flags.push({ sev: 'r', text: 'Win rate below 45%',             detail: 'Below average. Review training approach.' });
    if (gap > 15)                 flags.push({ sev: 'r', text: `DE gap ${gap}pp`,                detail: `${s.deWinPct}% DE vs ${s.pouleWinPct}% pools.` });
    if ((s.trend || 0) < -5)      flags.push({ sev: 'r', text: `Down ${Math.abs(s.trend)}pp YoY`, detail: 'Performance declining year on year.' });
    if (gap > 8 && gap <= 15)     flags.push({ sev: 'a', text: `Poule–DE gap ${gap}pp`,          detail: 'Pressure drill work recommended.' });
    if (!s.medals && s.events > 5) flags.push({ sev: 'a', text: 'No medals this season',         detail: 'No podium finishes yet.' });
    if ((s.trend || 0) > 10)      flags.push({ sev: 'g', text: `+${s.trend}pp improvement YoY`,  detail: 'Strong year-on-year improvement.' });
    if (flags.length === 0)       flags.push({ sev: 'g', text: 'On track',                        detail: 'No issues to flag.' });
    return flags;
  }

  function flagStyle(sev) {
    if (sev === 'r') return { bg: '#fef2f2', col: '#b91c1c', dot: '#ef4444' };
    if (sev === 'a') return { bg: '#fffbeb', col: '#b45309', dot: '#f59e0b' };
    return                  { bg: '#f0fdf4', col: '#15803d', dot: '#22c55e' };
  }

  const winCol = p => p >= 65 ? '#16A34A' : p >= 50 ? '#F97316' : '#ef4444';

  // ── Light theme palette (independent of T) ────────────────────────────────
  const L = {
    bg:       '#F9FAFB',
    surface:  '#FFFFFF',
    border:   '#E5E7EB',
    border2:  '#D1D5DB',
    text:     '#111827',
    textSub:  '#6B7280',
    textHint: '#9CA3AF',
    orange:   '#F97316',
    orangeL:  '#FFF7ED',
    green:    '#16A34A',
    tab:      '#374151',
  };

  if (loading) return (
    <div style={{ minHeight: '100vh', background: L.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
      <div style={{ width: 36, height: 36, borderRadius: 10, background: L.orange, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 500, fontSize: 14 }}>AF</div>
      <div style={{ fontSize: 13, color: L.textSub }}>Loading squad…</div>
    </div>
  );

  const squadStats = {
    active:  squad.length,
    avgWin:  squad.length ? Math.round(squad.filter(f => f.stats?.events).reduce((s, f) => s + (f.stats?.winPct || 0), 0) / (squad.filter(f => f.stats?.events).length || 1)) : 0,
    medals:  squad.reduce((s, f) => s + (f.stats?.medals || 0), 0),
    synced:  squad.filter(f => f.stats?.events).length,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: L.bg, fontFamily: 'var(--font-sans)' }}>
      <TopBar />

      {/* ── Tab bar ── */}
      <div style={{ background: L.surface, borderBottom: `1px solid ${L.border}`, padding: '0 20px', display: 'flex', gap: 0, overflowX: 'auto' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => { setActiveTab(t.id); setSelected(null); }}
            style={{ padding: '12px 16px', fontSize: 13, cursor: 'pointer', border: 'none', background: 'none',
              borderBottom: activeTab === t.id ? `2px solid ${L.orange}` : '2px solid transparent',
              color: activeTab === t.id ? L.orange : L.textSub,
              fontWeight: activeTab === t.id ? 500 : 400, whiteSpace: 'nowrap' }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 20px 40px' }}>

        {/* ══════════════════ SQUAD TAB ══════════════════ */}
        {activeTab === 'squad' && !selected && (
          <>
            {/* Stat cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
              {[
                { val: squadStats.active,         label: 'Active fencers',    sub: '2025–26 season' },
                { val: `${squadStats.avgWin}%`,    label: 'Squad win rate',    sub: 'poule avg, this season', orange: true },
                { val: squadStats.medals,          label: 'Medals this season', sub: 'top 3 finishes' },
                { val: `${squadStats.synced}/${squadStats.active}`, label: 'Synced from UKRatings', sub: 'have results data' },
              ].map(s => (
                <div key={s.label} style={{ background: '#F3F4F6', borderRadius: 10, padding: '14px 16px' }}>
                  <div style={{ fontSize: 11, color: L.textSub, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>{s.label}</div>
                  <div style={{ fontSize: 24, fontWeight: 500, color: s.orange ? L.orange : L.text }}>{s.val}</div>
                  <div style={{ fontSize: 11, color: L.textHint, marginTop: 3 }}>{s.sub}</div>
                </div>
              ))}
            </div>

            {/* Section header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: L.textSub, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                Squad — {squad.length} fencers
              </div>
              <button onClick={handleSyncAll} disabled={syncAllBusy}
                style={{ fontSize: 12, color: L.orange, border: `1px solid ${L.orange}`, background: 'none', padding: '5px 14px', borderRadius: 8, cursor: 'pointer', opacity: syncAllBusy ? 0.6 : 1 }}>
                {syncAllBusy ? 'Syncing…' : '↻ Sync all from UKRatings'}
              </button>
            </div>

            {/* Fencer cards grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {squad.map(f => {
                const s = f.stats || {};
                const status = statusBadge(f);
                const hasData = !!s.events;
                const syncing = syncingId === f.id;
                const col = f.colour || L.orange;

                return (
                  <div key={f.id} onClick={() => { setSelected(f); openFencer(f); }}
                    style={{ background: L.surface, border: `1px solid ${L.border}`, borderRadius: 12, cursor: 'pointer', overflow: 'hidden' }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = L.border2}
                    onMouseLeave={e => e.currentTarget.style.borderColor = L.border}>

                    {/* Card header */}
                    <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <div style={{ width: 40, height: 40, borderRadius: '50%', background: col + '22', color: col, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 500, flexShrink: 0 }}>
                        {f.name?.split(' ').map(p => p[0]).join('').slice(0, 2)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 3 }}>
                          <span style={{ fontSize: 14, fontWeight: 500, color: L.text }}>{f.name}</span>
                          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: status.bg, color: status.col, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: status.dot, display: 'inline-block' }}/>
                            {status.label}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: L.textHint }}>
                          {f.category} · {hasData ? `${s.events} events · ${s.bouts} bouts` : (f.ukr_id ? `UKR: ${f.ukr_id}` : 'No UKR ID set')}
                        </div>
                      </div>
                      {hasData && (
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ fontSize: 20, fontWeight: 500, color: winCol(s.winPct || 0) }}>{s.winPct || 0}%</div>
                          <div style={{ fontSize: 10, color: (s.trend || 0) >= 0 ? L.green : '#ef4444' }}>
                            {(s.trend || 0) >= 0 ? '↑ +' : '↓ '}{Math.abs(s.trend || 0)}pp
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Data section */}
                    {hasData ? (
                      <div style={{ padding: '0 16px 12px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
                          {[
                            { val: `${s.pouleWinPct || 0}%`, label: 'Poule', col: L.orange },
                            { val: `${s.deWinPct || 0}%`,    label: 'DE',    col: L.textSub },
                            { val: s.medals || 0,            label: 'Medals', col: L.green },
                          ].map(m => (
                            <div key={m.label} style={{ background: '#F9FAFB', borderRadius: 8, padding: '8px 6px', textAlign: 'center' }}>
                              <div style={{ fontSize: 16, fontWeight: 500, color: m.col }}>{m.val}</div>
                              <div style={{ fontSize: 10, color: L.textHint, marginTop: 2 }}>{m.label}</div>
                            </div>
                          ))}
                        </div>
                        {[['Poule', s.pouleWinPct || 0, L.orange], ['DE', s.deWinPct || 0, '#9CA3AF']].map(([lbl, pct, c]) => (
                          <div key={lbl} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                            <span style={{ fontSize: 10, color: L.textHint, width: 30 }}>{lbl}</span>
                            <div style={{ flex: 1, height: 5, background: '#F3F4F6', borderRadius: 3 }}>
                              <div style={{ height: 5, background: c, borderRadius: 3, width: `${pct}%` }}/>
                            </div>
                            <span style={{ fontSize: 10, color: L.textSub, width: 28, textAlign: 'right' }}>{pct}%</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ margin: '0 16px 12px', background: '#F9FAFB', borderRadius: 8, padding: '12px', textAlign: 'center', fontSize: 12, color: L.textHint }}>
                        {f.ukr_id ? 'Never synced — click Sync to load results' : 'Set UKRatings ID to enable auto-sync'}
                      </div>
                    )}

                    {/* Footer */}
                    <div style={{ padding: '10px 16px', borderTop: `1px solid ${L.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontSize: 11, color: L.textHint }}>
                        {hasData ? `Last: ${f.lastComp || 'recent'}` : 'No competitions loaded'}
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={e => { e.stopPropagation(); setSelected(f); openFencer(f); }}
                          style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${L.border}`, background: 'white', color: L.textSub }}>
                          View
                        </button>
                        {f.ukr_id && (
                          <button onClick={e => handleSync(f.id, e)} disabled={syncing}
                            style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', border: 'none', background: L.orange, color: 'white', opacity: syncing ? 0.7 : 1 }}>
                            {syncing ? '…' : '↻ Sync'}
                          </button>
                        )}
                        {!f.ukr_id && (
                          <button onClick={e => { e.stopPropagation(); setActiveTab('addfencer'); }}
                            style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', border: 'none', background: L.orange, color: 'white' }}>
                            + Edit
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ── Drilldown ── */}
        {activeTab === 'squad' && selected && (
          <>
            <button onClick={() => { setSelected(null); setDetail(null); }}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: L.textSub, cursor: 'pointer', background: 'none', border: 'none', marginBottom: 16, padding: 0 }}>
              ← Back to squad
            </button>

            {!detail ? (
              <div style={{ textAlign: 'center', padding: 40, color: L.textHint, fontSize: 13 }}>Loading…</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

                {/* Profile header */}
                <div style={{ background: L.surface, border: `1px solid ${L.border}`, borderRadius: 12, padding: 16, borderLeft: `3px solid ${selected.colour || L.orange}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                    <div style={{ width: 48, height: 48, borderRadius: '50%', background: (selected.colour || L.orange) + '22', color: selected.colour || L.orange, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 500 }}>
                      {selected.name?.split(' ').map(p => p[0]).join('').slice(0, 2)}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 17, fontWeight: 500, color: L.text }}>{selected.name}</div>
                      <div style={{ fontSize: 12, color: L.textHint, marginTop: 2 }}>{selected.category} · BF {selected.bf_licence} · UKR {selected.ukr_id}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 26, fontWeight: 500, color: winCol(selected.stats?.winPct || 0) }}>{selected.stats?.winPct || 0}%</div>
                      <div style={{ fontSize: 11, color: L.textHint }}>win rate</div>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>
                    {[
                      { val: `${selected.stats?.pouleWinPct || 0}%`, label: 'Poule', col: L.orange },
                      { val: `${selected.stats?.deWinPct || 0}%`,    label: 'DE' },
                      { val: selected.stats?.medals || 0,            label: 'Medals', col: L.green },
                      { val: selected.stats?.events || 0,            label: 'Events' },
                    ].map(m => (
                      <div key={m.label} style={{ background: '#F3F4F6', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
                        <div style={{ fontSize: 20, fontWeight: 500, color: m.col || L.text }}>{m.val}</div>
                        <div style={{ fontSize: 11, color: L.textHint, marginTop: 2 }}>{m.label}</div>
                      </div>
                    ))}
                  </div>

                  <button onClick={() => handleSync(selected.id)} disabled={syncingId === selected.id}
                    style={{ fontSize: 12, padding: '6px 14px', background: L.orange, border: 'none', borderRadius: 8, color: 'white', cursor: 'pointer', opacity: syncingId === selected.id ? 0.7 : 1 }}>
                    {syncingId === selected.id ? '↻ Syncing…' : '↻ Sync UKRatings data'}
                  </button>
                </div>

                {/* Data signals */}
                <div style={{ background: L.surface, border: `1px solid ${L.border}`, borderRadius: 12, padding: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 500, color: L.textHint, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 12 }}>Data signals</div>
                  {getFocusFlags(selected).map((fl, i) => {
                    const fs = flagStyle(fl.sev);
                    return (
                      <div key={i} style={{ background: fs.bg, borderRadius: 8, padding: '10px 12px', marginBottom: 8, display: 'flex', gap: 10 }}>
                        <div style={{ width: 7, height: 7, borderRadius: '50%', background: fs.dot, flexShrink: 0, marginTop: 4 }}/>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 500, color: fs.col }}>{fl.text}</div>
                          <div style={{ fontSize: 12, color: fs.col, opacity: .8, marginTop: 2 }}>{fl.detail}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Coach notes */}
                <div style={{ background: L.surface, border: `1px solid ${L.border}`, borderRadius: 12, padding: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 500, color: L.textHint, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 12 }}>Coach notes</div>
                  {(detail.notes || []).map((n, i) => (
                    <div key={i} style={{ padding: '8px 0', borderBottom: `1px solid ${L.border}`, fontSize: 13, color: L.textSub, lineHeight: 1.6 }}>
                      <div>{n.note}</div>
                      <div style={{ fontSize: 11, color: L.textHint, marginTop: 3 }}>{n.created_at?.slice(0, 10)}</div>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <input value={note} onChange={e => setNote(e.target.value)} placeholder="Add a coaching note…"
                      onKeyDown={e => e.key === 'Enter' && handleAddNote()}
                      style={{ flex: 1, padding: '8px 12px', background: '#F9FAFB', border: `1px solid ${L.border}`, borderRadius: 8, color: L.text, fontSize: 13, outline: 'none', boxSizing: 'border-box' }}/>
                    <button onClick={handleAddNote}
                      style={{ padding: '8px 16px', background: L.orange, border: 'none', borderRadius: 8, color: 'white', fontSize: 13, cursor: 'pointer' }}>
                      Add
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ══════════════════ FENCER TAB ══════════════════ */}
        {activeTab === 'fencer' && (
          <div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: L.textHint, marginBottom: 8 }}>Select a fencer to view their full performance hub:</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {squad.map(f => (
                  <button key={f.id} onClick={() => { setFencerTab(f); openFencer(f); }}
                    style={{ padding: '8px 16px', fontSize: 13, fontWeight: 500, borderRadius: 20, cursor: 'pointer',
                      background: fencerTab?.id === f.id ? L.orange : L.surface,
                      color: fencerTab?.id === f.id ? 'white' : L.textSub,
                      border: `1px solid ${fencerTab?.id === f.id ? L.orange : L.border}` }}>
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: f.colour || L.orange, marginRight: 6 }}/>
                    {f.name?.split(' ')[0]}
                  </button>
                ))}
              </div>
            </div>

            {fencerTab && !detail && <div style={{ color: L.textHint, fontSize: 13, padding: 20, textAlign: 'center' }}>Loading…</div>}

            {fencerTab && detail && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ background: L.surface, border: `1px solid ${L.border}`, borderRadius: 12, padding: 16, borderLeft: `3px solid ${fencerTab.colour || L.orange}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                    <div style={{ width: 44, height: 44, borderRadius: '50%', background: (fencerTab.colour || L.orange) + '22', color: fencerTab.colour || L.orange, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 500 }}>
                      {fencerTab.name?.split(' ').map(p => p[0]).join('').slice(0, 2)}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 16, fontWeight: 500, color: L.text }}>{fencerTab.name}</div>
                      <div style={{ fontSize: 12, color: L.textHint, marginTop: 2 }}>{fencerTab.category} · {fencerTab.stats?.events || 0} events · {fencerTab.stats?.bouts || 0} bouts</div>
                    </div>
                    <div style={{ fontSize: 24, fontWeight: 500, color: winCol(fencerTab.stats?.winPct || 0) }}>{fencerTab.stats?.winPct || 0}%</div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                    {[
                      { val: `${fencerTab.stats?.pouleWinPct || 0}%`, label: 'Poule', col: L.orange },
                      { val: `${fencerTab.stats?.deWinPct || 0}%`,    label: 'DE' },
                      { val: fencerTab.stats?.medals || 0,            label: 'Medals', col: L.green },
                      { val: fencerTab.stats?.events || 0,            label: 'Events' },
                    ].map(m => (
                      <div key={m.label} style={{ background: '#F3F4F6', borderRadius: 8, padding: '10px', textAlign: 'center' }}>
                        <div style={{ fontSize: 18, fontWeight: 500, color: m.col || L.text }}>{m.val}</div>
                        <div style={{ fontSize: 11, color: L.textHint, marginTop: 2 }}>{m.label}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ background: L.surface, border: `1px solid ${L.border}`, borderRadius: 12, padding: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 500, color: L.textHint, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 12 }}>Data signals</div>
                  {getFocusFlags(fencerTab).map((fl, i) => {
                    const fs = flagStyle(fl.sev);
                    return (
                      <div key={i} style={{ background: fs.bg, borderRadius: 8, padding: '10px 12px', marginBottom: 8, display: 'flex', gap: 10 }}>
                        <div style={{ width: 7, height: 7, borderRadius: '50%', background: fs.dot, flexShrink: 0, marginTop: 4 }}/>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 500, color: fs.col }}>{fl.text}</div>
                          <div style={{ fontSize: 12, color: fs.col, opacity: .8, marginTop: 2 }}>{fl.detail}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════ COMPARISON TAB ══════════════════ */}
        {activeTab === 'compare' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ background: L.surface, border: `1px solid ${L.border}`, borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: L.textHint, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 14 }}>Win rate — all fencers</div>
              {[...squad].sort((a, b) => (b.stats?.winPct || 0) - (a.stats?.winPct || 0)).map(f => (
                <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <div style={{ width: 24, height: 24, borderRadius: '50%', background: (f.colour || L.orange) + '22', color: f.colour || L.orange, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 500, flexShrink: 0 }}>
                    {f.name?.split(' ').map(p => p[0]).join('').slice(0, 2)}
                  </div>
                  <div style={{ fontSize: 12, color: L.textSub, width: 90, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name?.split(' ')[0]}</div>
                  <div style={{ flex: 1, height: 6, background: '#F3F4F6', borderRadius: 3 }}>
                    <div style={{ height: 6, background: f.colour || L.orange, borderRadius: 3, width: `${f.stats?.winPct || 0}%` }}/>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: winCol(f.stats?.winPct || 0), width: 34, textAlign: 'right' }}>{f.stats?.winPct || 0}%</div>
                  <div style={{ fontSize: 11, color: (f.stats?.trend || 0) >= 0 ? L.green : '#ef4444', width: 44, textAlign: 'right' }}>
                    {(f.stats?.trend || 0) >= 0 ? '↑ +' : '↓ '}{Math.abs(f.stats?.trend || 0)}pp
                  </div>
                </div>
              ))}
            </div>

            <div style={{ background: L.surface, border: `1px solid ${L.border}`, borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: L.textHint, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 14 }}>Full comparison</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${L.border}` }}>
                      {['Fencer', 'Events', 'Win %', 'Poule', 'DE', 'Medals'].map(h => (
                        <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 500, color: L.textHint, textTransform: 'uppercase' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...squad].sort((a, b) => (b.stats?.winPct || 0) - (a.stats?.winPct || 0)).map(f => {
                      const s = f.stats || {};
                      return (
                        <tr key={f.id} style={{ borderBottom: `1px solid ${L.border}` }}
                          onMouseEnter={e => e.currentTarget.style.background = '#F9FAFB'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                          <td style={{ padding: '10px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ width: 22, height: 22, borderRadius: '50%', background: (f.colour || L.orange) + '22', color: f.colour || L.orange, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 500 }}>
                                {f.name?.split(' ').map(p => p[0]).join('').slice(0, 2)}
                              </div>
                              <span style={{ color: L.text, fontWeight: 500 }}>{f.name?.split(' ')[0]}</span>
                            </div>
                          </td>
                          {[s.events || 0, `${s.winPct || 0}%`, `${s.pouleWinPct || 0}%`, `${s.deWinPct || 0}%`, s.medals || 0].map((v, i) => (
                            <td key={i} style={{ padding: '10px', color: L.textSub }}>{v}</td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════ OTHER TABS ══════════════════ */}
        {activeTab === 'tournament' && <AddTournamentTab />}
        {activeTab === 'edit'       && <EditTournamentTab isCoach />}
        {activeTab === 'addfencer' && <AddFencerTab />}

      </div>
    </div>
  );
}
