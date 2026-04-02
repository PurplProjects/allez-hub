import { useState } from 'react';
import { useTheme } from '../../hooks/useTheme';

const CATEGORIES = ['U10','U12','U14','U16','U18','U20','Senior'];
const COLOURS = ['#F97316','#34d399','#60a5fa','#a78bfa','#f472b6','#fb923c','#4ade80','#facc15'];

const API = import.meta.env.VITE_API_URL || '/api';
function getToken() { return localStorage.getItem('allez_token'); }

export default function AddFencerTab() {
  const { theme: T } = useTheme();

  const empty = { name:'', email:'', bf_licence:'', ukr_id:'', category:'U12', dob_year:'', school:'Brentwood School', colour:'#F97316' };
  const [form,    setForm]    = useState(empty);
  const [saving,  setSaving]  = useState(false);
  const [msg,     setMsg]     = useState(null);

  function set(field, value) { setForm(f => ({ ...f, [field]: value })); }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) { setMsg({ type:'error', text:'Name is required' }); return; }
    setSaving(true); setMsg(null);
    try {
      const res = await fetch(`${API}/coach/fencers`, {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${getToken()}` },
        body: JSON.stringify({
          name:        form.name.trim(),
          email:       form.email.trim() || undefined,
          bf_licence:  form.bf_licence.trim() || undefined,
          ukr_id:      form.ukr_id.trim() ? Number(form.ukr_id) : undefined,
          category:    form.category,
          dob_year:    form.dob_year ? Number(form.dob_year) : undefined,
          school:      form.school.trim() || undefined,
          colour:      form.colour,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add fencer');
      setMsg({ type:'success', text:`${form.name} added successfully${form.email ? ' — login account created' : ''}` });
      setForm(empty);
    } catch (err) {
      setMsg({ type:'error', text: err.message });
    } finally { setSaving(false); }
  }

  const card  = { background:T.surface1, border:`1px solid ${T.surface3}`, borderRadius:T.borderRadius, padding:16, marginBottom:12 };
  const lbl   = { fontSize:11, fontWeight:500, color:T.textTertiary, textTransform:'uppercase', letterSpacing:'.05em', display:'block', marginBottom:4 };
  const inp   = { width:'100%', padding:'8px 10px', background:T.surface2, border:`1px solid ${T.surface3}`, borderRadius:6, color:T.textPrimary, fontSize:13, outline:'none', boxSizing:'border-box' };
  const grid2 = { display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 };

  return (
    <div style={{ padding:'14px 14px 32px' }}>
      <form onSubmit={handleSubmit}>

        <div style={card}>
          <div style={{ fontSize:11, fontWeight:500, color:T.textTertiary, textTransform:'uppercase', letterSpacing:'.05em', marginBottom:14 }}>
            Fencer details
          </div>

          <div style={grid2}>
            <div>
              <span style={lbl}>Full name *</span>
              <input style={inp} placeholder="Ajith Badhrinath" value={form.name} onChange={e => set('name', e.target.value)} />
            </div>
            <div>
              <span style={lbl}>Email (optional — enables login)</span>
              <input style={inp} type="email" placeholder="ajith@example.com" value={form.email} onChange={e => set('email', e.target.value)} />
            </div>
          </div>

          <div style={grid2}>
            <div>
              <span style={lbl}>BF licence number</span>
              <input style={inp} placeholder="157149" value={form.bf_licence} onChange={e => set('bf_licence', e.target.value)} />
            </div>
            <div>
              <span style={lbl}>UKRatings ID</span>
              <input style={inp} placeholder="65339" value={form.ukr_id} onChange={e => set('ukr_id', e.target.value)} />
            </div>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:12 }}>
            <div>
              <span style={lbl}>Category</span>
              <select style={inp} value={form.category} onChange={e => set('category', e.target.value)}>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <span style={lbl}>Year of birth</span>
              <input style={inp} placeholder="2014" value={form.dob_year} onChange={e => set('dob_year', e.target.value)} />
            </div>
            <div>
              <span style={lbl}>School</span>
              <input style={inp} placeholder="Brentwood School" value={form.school} onChange={e => set('school', e.target.value)} />
            </div>
          </div>

          <div>
            <span style={lbl}>Avatar colour</span>
            <div style={{ display:'flex', gap:8, marginTop:4 }}>
              {COLOURS.map(c => (
                <div key={c} onClick={() => set('colour', c)} style={{
                  width:28, height:28, borderRadius:'50%', background:c, cursor:'pointer',
                  border: form.colour === c ? `3px solid ${T.textPrimary}` : '2px solid transparent',
                  flexShrink:0,
                }} />
              ))}
              <div style={{ marginLeft:12, width:28, height:28, borderRadius:'50%', background:form.colour, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:500, color:'white' }}>
                {form.name?.split(' ').map(p=>p[0]).join('').slice(0,2) || 'AB'}
              </div>
            </div>
          </div>
        </div>

        <div style={{ fontSize:12, color:T.textTertiary, marginBottom:16, lineHeight:1.6 }}>
          <strong style={{ color:T.textSecondary }}>UKRatings ID</strong> is needed for automatic scraping. Find it in the fencer's profile URL at ukratings.co.uk.<br />
          <strong style={{ color:T.textSecondary }}>Email</strong> is optional — if provided, a login account is created so the fencer can view their own dashboard.
        </div>

        <button type="submit" disabled={saving} style={{
          width:'100%', padding:'11px', background:T.primary, border:'none',
          borderRadius:T.borderRadiusSm, color:'white', fontSize:14, fontWeight:600,
          cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1,
        }}>
          {saving ? 'Adding fencer…' : 'Add fencer to squad'}
        </button>

        {msg && (
          <div style={{
            marginTop:12, padding:'10px 14px', borderRadius:8, fontSize:13,
            background: msg.type === 'success' ? '#052e16' : '#450a0a',
            color:      msg.type === 'success' ? '#86efac'  : '#fca5a5',
            border: `1px solid ${msg.type === 'success' ? '#16A34A33' : '#EF444433'}`,
          }}>
            {msg.type === 'success' ? '✓ ' : '✗ '}{msg.text}
          </div>
        )}

      </form>
    </div>
  );
}
