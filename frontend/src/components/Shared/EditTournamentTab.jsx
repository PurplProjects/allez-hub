import { useState, useEffect, useCallback } from 'react';
import { useTheme } from '../../hooks/useTheme';
import { searchCompetitions, getCompetitionWithBouts, updateCompetition, updateBout, deleteBout, addBout } from '../../lib/api';
import { getSquad } from '../../lib/api';

const BOUT_TYPES = ['Poule','DE Table of 16','DE Quarter Final','DE Semi Final','DE Final'];

export default function EditTournamentTab({ isCoach = false }) {
  const { theme: T } = useTheme();

  // Coach — fencer selector
  const [squad,           setSquad]           = useState([]);
  const [selectedFencer,  setSelectedFencer]  = useState(null);

  // Search
  const [searchQuery,     setSearchQuery]     = useState('');
  const [searchResults,   setSearchResults]   = useState([]);
  const [searching,       setSearching]       = useState(false);

  // Selected competition
  const [competition,     setCompetition]     = useState(null);
  const [bouts,           setBouts]           = useState([]);
  const [loadingComp,     setLoadingComp]     = useState(false);

  // Edit state
  const [compDraft,       setCompDraft]       = useState(null);
  const [boutDrafts,      setBoutDrafts]      = useState({}); // { boutId: {...} }
  const [saving,          setSaving]          = useState(false);
  const [savingComp,      setSavingComp]      = useState(false);
  const [saveMsg,         setSaveMsg]         = useState('');
  const [errors,          setErrors]          = useState({});

  // Load squad for coach
  useEffect(() => {
    if (isCoach) {
      getSquad().then(d => setSquad(d.fencers || [])).catch(() => {});
    }
  }, [isCoach]);

  // Search debounce
  useEffect(() => {
    if (!searchQuery.trim() && !isCoach) return;
    if (isCoach && !selectedFencer) return;
    const t = setTimeout(() => doSearch(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery, selectedFencer]);

  async function doSearch(q) {
    setSearching(true);
    try {
      const fencerId = isCoach ? selectedFencer?.id : undefined;
      const data = await searchCompetitions(q, fencerId);
      setSearchResults(data.competitions || []);
    } catch {}
    finally { setSearching(false); }
  }

  async function selectCompetition(comp) {
    setLoadingComp(true);
    setCompetition(null);
    setBouts([]);
    setBoutDrafts({});
    setErrors({});
    setSaveMsg('');
    try {
      const data = await getCompetitionWithBouts(comp.id);
      setCompetition(data.competition);
      setCompDraft({ ...data.competition });
      setBouts(data.bouts);
      // Init drafts for each bout
      const drafts = {};
      data.bouts.forEach(b => { drafts[b.id] = { ...b }; });
      setBoutDrafts(drafts);
    } catch (e) {
      setSaveMsg('Error loading competition');
    } finally { setLoadingComp(false); }
  }

  async function saveCompetition() {
    setSavingComp(true);
    setSaveMsg('');
    try {
      await updateCompetition(competition.id, {
        name:       compDraft.name,
        date:       compDraft.date,
        rank:       compDraft.rank,
        field_size: compDraft.field_size,
      });
      setCompetition({ ...competition, ...compDraft });
      flash('Competition saved');
    } catch (e) {
      setSaveMsg('Error: ' + e.message);
    } finally { setSavingComp(false); }
  }

  async function saveAllBouts() {
    setSaving(true);
    setSaveMsg('');
    const errs = {};
    const updates = bouts
      .filter(b => b.id)  // existing bouts
      .map(async b => {
        const d = boutDrafts[b.id];
        if (!d) return;
        try {
          await updateBout(b.id, {
            opponent:      d.opponent,
            score_for:     d.score_for,
            score_against: d.score_against,
            result:        d.result,
            bout_type:     d.bout_type,
            comments:      d.comments,
          });
        } catch (e) { errs[b.id] = e.message; }
      });
    await Promise.all(updates);

    // Save new bouts (no id yet)
    const newBouts = bouts.filter(b => !b.id);
    for (const b of newBouts) {
      try {
        const { bout } = await addBout(competition.id, {
          opponent:      b.opponent,
          score_for:     b.score_for,
          score_against: b.score_against,
          result:        b.result,
          bout_type:     b.bout_type,
          comments:      b.comments,
        });
        // Replace temp entry with saved one
        setBouts(prev => prev.map(x => x === b ? bout : x));
        setBoutDrafts(prev => {
          const next = { ...prev };
          next[bout.id] = { ...bout };
          return next;
        });
      } catch (e) { errs['new_' + b.opponent] = e.message; }
    }

    setErrors(errs);
    setSaving(false);
    if (Object.keys(errs).length === 0) flash('All bouts saved');
    else setSaveMsg('Some bouts had errors — check rows');
  }

  async function handleDeleteBout(boutId) {
    if (!window.confirm('Delete this bout?')) return;
    if (boutId) {
      try { await deleteBout(boutId); } catch (e) { setSaveMsg('Delete failed: ' + e.message); return; }
    }
    setBouts(prev => prev.filter(b => b.id !== boutId));
    setBoutDrafts(prev => { const n = { ...prev }; delete n[boutId]; return n; });
  }

  function handleDeleteNewBout(idx) {
    setBouts(prev => prev.filter((_, i) => i !== idx));
  }

  function addNewBout() {
    setBouts(prev => [...prev, {
      opponent: '', score_for: 0, score_against: 0,
      result: 'Lost', bout_type: 'Poule', comments: '',
    }]);
  }

  function updateBoutDraft(boutId, field, value) {
    setBoutDrafts(prev => {
      const d = { ...prev[boutId], [field]: value };
      // Auto-calc result from scores
      if (field === 'score_for' || field === 'score_against') {
        const sf = field === 'score_for' ? Number(value) : Number(d.score_for);
        const sa = field === 'score_against' ? Number(value) : Number(d.score_against);
        d.result = sf > sa ? 'Won' : 'Lost';
      }
      return { ...prev, [boutId]: d };
    });
  }

  function updateNewBout(idx, field, value) {
    setBouts(prev => prev.map((b, i) => {
      if (i !== idx || b.id) return b;
      const updated = { ...b, [field]: value };
      if (field === 'score_for' || field === 'score_against') {
        const sf = field === 'score_for' ? Number(value) : Number(b.score_for);
        const sa = field === 'score_against' ? Number(value) : Number(b.score_against);
        updated.result = sf > sa ? 'Won' : 'Lost';
      }
      return updated;
    }));
  }

  function flash(msg) {
    setSaveMsg(msg);
    setTimeout(() => setSaveMsg(''), 3000);
  }

  // ── Styles ─────────────────────────────────────────────────
  const card = { background: T.surface1, border: `1px solid ${T.surface3}`, borderRadius: T.borderRadius, padding: 14, marginBottom: 12 };
  const label = { fontSize: 10, fontWeight: 500, color: T.textTertiary, textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 4 };
  const inp = { width: '100%', padding: '6px 10px', background: T.surface2, border: `1px solid ${T.surface3}`, borderRadius: 6, color: T.textPrimary, fontSize: 13, outline: 'none', boxSizing: 'border-box' };
  const btn = (primary) => ({ padding: '6px 14px', fontSize: 12, fontWeight: 500, borderRadius: 6, cursor: 'pointer', border: primary ? 'none' : `1px solid ${T.surface3}`, background: primary ? T.primary : 'transparent', color: primary ? 'white' : T.textPrimary });

  return (
    <div style={{ padding: '14px 14px 32px' }}>

      {/* ── COACH: fencer selector ── */}
      {isCoach && (
        <div style={card}>
          <span style={label}>Select fencer</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {squad.map(f => (
              <button key={f.id} onClick={() => { setSelectedFencer(f); setSearchQuery(''); setSearchResults([]); setCompetition(null); }}
                style={{ padding: '6px 12px', fontSize: 12, borderRadius: 20, cursor: 'pointer', fontWeight: 500,
                  background: selectedFencer?.id === f.id ? T.primary : T.surface2,
                  color: selectedFencer?.id === f.id ? 'white' : T.textSecondary,
                  border: `1px solid ${selectedFencer?.id === f.id ? T.primary : T.surface3}`,
                }}>
                {f.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── SEARCH ── */}
      {(!isCoach || selectedFencer) && (
        <div style={card}>
          <span style={label}>{isCoach ? `Search tournaments for ${selectedFencer?.name}` : 'Search tournaments'}</span>
          <input
            style={inp} placeholder="Type tournament name…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onFocus={() => !searchResults.length && doSearch('')}
          />
          {searching && <div style={{ fontSize: 12, color: T.textTertiary, marginTop: 6 }}>Searching…</div>}
          {searchResults.length > 0 && !competition && (
            <div style={{ marginTop: 8, border: `1px solid ${T.surface3}`, borderRadius: 8, overflow: 'hidden' }}>
              {searchResults.map(c => (
                <div key={c.id} onClick={() => { selectCompetition(c); setSearchResults([]); }}
                  style={{ padding: '10px 12px', fontSize: 13, cursor: 'pointer', borderBottom: `1px solid ${T.surface3}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: T.surface1, color: T.textPrimary }}
                  onMouseEnter={e => e.currentTarget.style.background = T.surface2}
                  onMouseLeave={e => e.currentTarget.style.background = T.surface1}
                >
                  <span>{c.name}{c.event_name ? ` — ${c.event_name}` : ''}</span>
                  <span style={{ fontSize: 11, color: T.textTertiary, flexShrink: 0, marginLeft: 8 }}>
                    {c.date?.slice(0, 7)} · {c.rank ? `${c.rank}/${c.field_size}` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
          {competition && (
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, color: T.primary, fontWeight: 500 }}>✓ {competition.name}</span>
              <button style={btn(false)} onClick={() => { setCompetition(null); setSearchResults([]); setSearchQuery(''); }}>Change</button>
            </div>
          )}
        </div>
      )}

      {loadingComp && <div style={{ fontSize: 13, color: T.textTertiary, textAlign: 'center', padding: 20 }}>Loading…</div>}

      {/* ── COMPETITION DETAILS ── */}
      {competition && compDraft && (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={label}>Competition details</span>
            <button style={btn(true)} onClick={saveCompetition} disabled={savingComp}>
              {savingComp ? 'Saving…' : 'Save details'}
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div>
              <span style={label}>Tournament name</span>
              <input style={inp} value={compDraft.name || ''} onChange={e => setCompDraft(d => ({ ...d, name: e.target.value }))} />
            </div>
            <div>
              <span style={label}>Date</span>
              <input style={inp} type="date" value={compDraft.date || ''} onChange={e => setCompDraft(d => ({ ...d, date: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <span style={label}>Total fencers</span>
              <input style={inp} type="number" min="1" value={compDraft.field_size || ''} onChange={e => setCompDraft(d => ({ ...d, field_size: e.target.value }))} />
            </div>
            <div>
              <span style={label}>Final position</span>
              <input style={inp} type="number" min="1" value={compDraft.rank || ''} onChange={e => setCompDraft(d => ({ ...d, rank: e.target.value }))} />
            </div>
          </div>
        </div>
      )}

      {/* ── BOUTS TABLE ── */}
      {competition && (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={label}>Bouts ({bouts.length})</span>
            <button style={btn(true)} onClick={saveAllBouts} disabled={saving}>
              {saving ? 'Saving…' : 'Save all bouts'}
            </button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${T.surface3}` }}>
                  {['Type','Opponent','My score','Opp score','Result','Comments',''].map(h => (
                    <th key={h} style={{ padding: '6px 6px 8px', textAlign: 'left', fontSize: 10, fontWeight: 500, color: T.textTertiary, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bouts.map((bout, idx) => {
                  const isNew = !bout.id;
                  const d = isNew ? bout : (boutDrafts[bout.id] || bout);
                  const hasErr = errors[bout.id];
                  const won = d.result === 'Won';

                  const cellInp = { ...inp, fontSize: 12, padding: '4px 6px' };
                  const update = isNew
                    ? (f, v) => updateNewBout(idx, f, v)
                    : (f, v) => updateBoutDraft(bout.id, f, v);

                  return (
                    <tr key={bout.id || idx} style={{ borderBottom: `1px solid ${T.surface3}`, background: hasErr ? '#450a0a22' : 'transparent' }}>
                      <td style={{ padding: '5px 4px', minWidth: 90 }}>
                        <select style={cellInp} value={d.bout_type || 'Poule'} onChange={e => update('bout_type', e.target.value)}>
                          {BOUT_TYPES.map(t => <option key={t}>{t}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: '5px 4px', minWidth: 120 }}>
                        <input style={cellInp} value={d.opponent || ''} onChange={e => update('opponent', e.target.value)} placeholder="Opponent name" />
                      </td>
                      <td style={{ padding: '5px 4px', width: 60 }}>
                        <input style={{ ...cellInp, textAlign: 'center' }} type="number" min="0" value={d.score_for ?? ''} onChange={e => update('score_for', e.target.value)} />
                      </td>
                      <td style={{ padding: '5px 4px', width: 60 }}>
                        <input style={{ ...cellInp, textAlign: 'center' }} type="number" min="0" value={d.score_against ?? ''} onChange={e => update('score_against', e.target.value)} />
                      </td>
                      <td style={{ padding: '5px 8px', fontWeight: 500, color: won ? T.success : T.danger, whiteSpace: 'nowrap' }}>
                        {won ? 'Won' : 'Lost'}
                      </td>
                      <td style={{ padding: '5px 4px', minWidth: 140 }}>
                        <input style={cellInp} value={d.comments || ''} onChange={e => update('comments', e.target.value)} placeholder="Add comment…" />
                      </td>
                      <td style={{ padding: '5px 4px' }}>
                        <button onClick={() => isNew ? handleDeleteNewBout(idx) : handleDeleteBout(bout.id)}
                          style={{ padding: '3px 8px', fontSize: 11, borderRadius: 4, cursor: 'pointer', background: 'transparent', border: `1px solid ${T.danger}33`, color: T.danger }}>
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <button onClick={addNewBout} style={{ marginTop: 10, fontSize: 12, color: T.primary, background: 'none', border: 'none', cursor: 'pointer', padding: '6px 0' }}>
            + Add bout
          </button>
        </div>
      )}

      {/* ── STATUS MESSAGE ── */}
      {saveMsg && (
        <div style={{
          padding: '10px 14px', borderRadius: 8, fontSize: 13, marginTop: 8,
          background: saveMsg.startsWith('Error') || saveMsg.includes('error') ? '#450a0a' : '#052e16',
          color: saveMsg.startsWith('Error') || saveMsg.includes('error') ? '#fca5a5' : '#86efac',
          border: `1px solid ${saveMsg.startsWith('Error') || saveMsg.includes('error') ? '#EF444433' : '#16A34A33'}`,
        }}>
          {saveMsg}
        </div>
      )}
    </div>
  );
}
