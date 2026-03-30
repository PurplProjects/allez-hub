import { useState } from 'react';
import { useTheme } from '../../hooks/useTheme';
import { useAuth } from '../../hooks/useAuth';

export default function AddTournamentTab() {
  const { theme: T } = useTheme();
  const s = {
    wrap:    { padding: 14, display: 'flex', flexDirection: 'column', gap: 12 },
    card:    { background: T.surface1, border: `0.5px solid ${T.surface2}`, borderRadius: T.borderRadius, padding: 14 },
    title:   { fontSize: 11, fontWeight: 500, color: T.textTertiary, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 },
    input:   { width: '100%', padding: '10px 12px', background: T.surface2, border: `0.5px solid ${T.surface3}`, borderRadius: T.borderRadiusSm, color: T.textPrimary, fontSize: 13, outline: 'none', boxSizing: 'border-box', marginBottom: 10 },
    btn:     { padding: '10px 16px', background: T.primary, border: 'none', borderRadius: T.borderRadiusSm, color: 'white', fontSize: 13, fontWeight: 500, cursor: 'pointer', width: '100%' },
    btnDis:  { opacity: 0.6, cursor: 'not-allowed' },
    success: { background: '#052e16', border: `0.5px solid ${T.success}22`, borderRadius: T.borderRadiusSm, padding: '10px 12px', fontSize: 13, color: '#86efac', lineHeight: 1.6 },
    error:   { background: '#450a0a', border: `0.5px solid ${T.danger}22`, borderRadius: T.borderRadiusSm, padding: '10px 12px', fontSize: 13, color: '#fca5a5', lineHeight: 1.6 },
    status:  { background: T.surface2, borderRadius: T.borderRadiusSm, padding: '10px 12px', fontSize: 12, color: T.textSecondary, lineHeight: 1.6 },
    example: { fontSize: 11, color: T.textTertiary, marginTop: 4, lineHeight: 1.6 },
  };
  const { user } = useAuth();
  const isCoach  = user?.role === 'coach';

  const [url,      setUrl]      = useState('');
  const [loading,  setLoading]  = useState(false);
  const [result,   setResult]   = useState(null);
  const [polling,  setPolling]  = useState(false);
  const [status,   setStatus]   = useState(null);

  const API = import.meta.env.VITE_API_URL || '/api';

  function getToken() { return localStorage.getItem('allez_token'); }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!url.trim()) return;
    setLoading(true); setResult(null); setStatus(null);
    try {
      const res = await fetch(`${API}/scrape/manual/tournament`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
        body: JSON.stringify({ ftlUrl: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start');
      setResult(data); setPolling(true); pollStatus(data.jobId);
    } catch (err) {
      setResult({ success: false, message: err.message });
    } finally { setLoading(false); }
  }

  async function pollStatus(jobId) {
    const interval = setInterval(async () => {
      try {
        const res  = await fetch(`${API}/scrape/${jobId}/status`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        const data = await res.json();
        setStatus(data.current);
        if (!data.inProgress) { clearInterval(interval); setPolling(false); }
      } catch { clearInterval(interval); setPolling(false); }
    }, 3000);
  }

  const isValidUrl = url.includes('fencingtimelive.com');

  return (
    <div style={s.wrap}>
      <div style={s.card}>
        <div style={s.title}>{isCoach ? 'Load non-UK tournament for all Allez fencers' : 'Add a non-UK tournament'}</div>
        <div style={{ fontSize: 13, color: T.textSecondary, lineHeight: 1.7 }}>
          {isCoach ? 'Paste a FencingTimeLive tournament or event URL. The system will search for every Allez fencer in that tournament and load all their bouts automatically.' : 'Paste a FencingTimeLive event URL for a tournament not already in your history. Your bouts will be loaded automatically.'}
        </div>
      </div>
      <div style={s.card}>
        <div style={s.title}>FencingTimeLive URL</div>
        <form onSubmit={handleSubmit}>
          <input style={{ ...s.input, borderColor: url && !isValidUrl ? T.danger : T.surface3 }} placeholder="https://www.fencingtimelive.com/events/results/..." value={url} onChange={e => setUrl(e.target.value)} />
          <div style={s.example}>Accepted formats:<br />• fencingtimelive.com/events/results/6EC1B9DD... — single event<br />• fencingtimelive.com/tournaments/eventSchedule/CF32... — whole tournament</div>
          <div style={{ marginTop: 12 }}>
            <button type="submit" style={{ ...s.btn, ...(loading || !isValidUrl ? s.btnDis : {}) }} disabled={loading || !isValidUrl}>
              {loading ? 'Starting…' : isCoach ? 'Load tournament for all Allez fencers' : 'Load my bouts'}
            </button>
          </div>
        </form>
      </div>
      {result && (<div style={result.success ? s.success : s.error}>{result.success ? '✓ ' : '✗ '}{result.message}</div>)}
      {(polling || status) && (
        <div style={s.status}>
          {polling && (<div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}><div style={{ width: 8, height: 8, borderRadius: '50%', background: T.primary }}/><span style={{ color: T.primary, fontWeight: 500 }}>In progress…</span></div>)}
          {status?.message}
          {status?.boutsAdded > 0 && (<div style={{ marginTop: 4, color: T.textSecondary }}>{status.boutsAdded} bouts saved</div>)}
        </div>
      )}
      <div style={{ ...s.card, borderLeft: `2px solid ${T.primary}` }}>
        <div style={{ fontSize: 11, fontWeight: 500, color: T.primary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.05em' }}>How to find the URL</div>
        <div style={{ fontSize: 12, color: T.textSecondary, lineHeight: 1.7 }}>
          1. Go to fencingtimelive.com<br />2. Find the tournament<br />3. Click on the event you competed in<br />4. Copy the URL from your browser<br />5. Paste it here<br /><br />
          {isCoach ? 'If you paste the tournament schedule URL, all events will be checked for any Allez fencer.' : 'UK tournaments are loaded automatically via UKRatings - only add non-UK events here.'}
        </div>
      </div>
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>
    </div>
  );
}
