import { useState, useEffect } from 'react';
import { getSquad, getFencerDetail, addCoachNote, triggerScrape } from '../../lib/api';
import { theme } from '../../lib/theme';
import TopBar from '../Shared/TopBar';
import AddTournamentTab from '../Shared/AddTournamentTab';
import SectionTabs from '../Shared/SectionTabs';

const T = theme;
const TABS = [
  { id:'squad',    label:'Squad overview' },
  { id:'compare',  label:'Comparison' },
  { id:'focus',    label:'Focus areas' },
  { id:'upcoming',   label:'Upcoming events' },
  { id:'tournament',  label:'+ Add tournament' },
];

export default function CoachDashboard() {
  const [activeTab,  setActiveTab]  = useState('squad');
  const [squad,      setSquad]      = useState([]);
  const [selected,   setSelected]   = useState(null);   // drilled-down fencer
  const [detail,     setDetail]     = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [note,       setNote]       = useState('');

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
    const d = await getFencerDetail(f.id);
    setDetail(d);
  }

  async function handleAddNote() {
    if (!note.trim() || !selected) return;
    await addCoachNote(selected.id, note);
    setNote('');
    const d = await getFencerDetail(selected.id);
    setDetail(d);
  }

  async function handleSync(fencerId) {
    await triggerScrape(fencerId).catch(() => {});
    alert('Sync started — data will update in 1-2 minutes.');
  }

  const pctColor = p => p >= 65 ? T.success : p >= 55 ? T.primary : T.warning;
  const flag = (sev) => sev==='r'?{bg:'#450a0a',col:'#fca5a5'}:sev==='a'?{bg:'#451a03',col:'#fcd34d'}:sev==='g'?{bg:'#052e16',col:'#86efac'}:{bg:'#1e3a5f',col:'#93c5fd'};

  function getFocusFlags(f) {
    const s = f.stats || {};
    const flags = [];
    const gap = (s.pouleWinPct||0) - (s.deWinPct||0);
    if (s.winPct < 45)   flags.push({ sev:'r', text:'Win rate below 45%',  detail:'Below average for this age group. Review training approach.' });
    if (gap > 15)        flags.push({ sev:'r', text:`DE gap ${gap}pp`,      detail:`${s.deWinPct}% in DE vs ${s.pouleWinPct}% in pools. DE simulation work needed.` });
    if (s.trend < -5)    flags.push({ sev:'r', text:`Win rate down ${Math.abs(s.trend||0)}pp YoY`, detail:'Performance declining year on year. Review tactical development.' });
    if (gap > 8)         flags.push({ sev:'a', text:`Poule–DE gap ${gap}pp`, detail:'Noticeable drop from pools to DE. Pressure drill work recommended.' });
    if ((s.medals||0)===0 && (s.events||0)>5) flags.push({ sev:'a', text:'No medals this season', detail:'Good events count but no podium finishes yet.' });
    if (flags.length === 0) flags.push({ sev:'g', text:'On track', detail:'No significant data issues to flag.' });
    if ((s.trend||0) > 10) flags.push({ sev:'g', text:`+${s.trend}pp improvement YoY`, detail:'Strong year-on-year improvement.' });
    return flags;
  }

  if (loading) return <div style={{ minHeight:'100vh', background:T.black, display:'flex', alignItems:'center', justifyContent:'center', color:T.textTertiary }}>Loading squad…</div>;

  return (
    <div style={{ display:'flex', flexDirection:'column', minHeight:'100vh', background:T.black }}>
      <TopBar />
      <SectionTabs tabs={TABS} active={activeTab} onChange={t => { setActiveTab(t); setSelected(null); }} />

      <div style={{ flex:1, overflowY:'auto', padding:14, display:'flex', flexDirection:'column', gap:10 }}>

        {/* ── SQUAD OVERVIEW ── */}
        {activeTab === 'squad' && !selected && (
          <>
            {/* Headline metrics */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,minmax(0,1fr))', gap:8 }}>
              {[
                { val:squad.length,                                                  lbl:'Active fencers', sub:'2025–26' },
                { val:squad.length?Math.round(squad.reduce((s,f)=>s+(f.stats?.winPct||0),0)/squad.length)+'%':'-', lbl:'Squad avg win rate', sub:'all weapons', col:T.success },
                { val:squad.reduce((s,f)=>s+(f.stats?.medals||0),0),                lbl:'Total medals',   sub:'this season' },
                { val:squad.filter(f=>getFocusFlags(f).some(fl=>fl.sev==='r')).length, lbl:'Need attention', sub:'data flags', col:T.danger },
              ].map(m => (
                <div key={m.lbl} style={{ background:T.surface2, borderRadius:6, padding:'10px 12px' }}>
                  <div style={{ fontSize:22, fontWeight:500, color:m.col||T.primary }}>{m.val}</div>
                  <div style={{ fontSize:10, color:T.textTertiary, marginTop:2 }}>{m.lbl}</div>
                  <div style={{ fontSize:9, color:T.textTertiary }}>{m.sub}</div>
                </div>
              ))}
            </div>

            <div style={{ fontSize:11, color:T.textTertiary }}>Tap a fencer to see their full profile</div>

            {/* Fencer cards */}
            {squad.map(f => {
              const s = f.stats || {};
              const flags = getFocusFlags(f);
              const col = f.colour || T.primary;
              return (
                <div key={f.id}
                  onClick={() => openFencer(f)}
                  style={{ background:T.surface1, border:`0.5px solid ${T.surface2}`, borderRadius:T.borderRadius, cursor:'pointer', overflow:'hidden', transition:'border-color .15s' }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = T.surface3}
                  onMouseLeave={e => e.currentTarget.style.borderColor = T.surface2}
                >
                  {/* Header */}
                  <div style={{ padding:'12px 14px', display:'flex', alignItems:'center', gap:10, borderBottom:`0.5px solid ${T.surface2}` }}>
                    <div style={{ width:38, height:38, borderRadius:'50%', background:col+'22', color:col, display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, fontWeight:500, flexShrink:0 }}>
                      {f.name?.split(' ').map(p=>p[0]).join('').slice(0,2)}
                    </div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:14, fontWeight:500, color:T.textPrimary }}>{f.name}</div>
                      <div style={{ fontSize:11, color:T.textTertiary, marginTop:1 }}>{f.category} · {s.events} events · {s.bouts} bouts</div>
                    </div>
                    <div style={{ textAlign:'right' }}>
                      <div style={{ fontSize:20, fontWeight:500, color:pctColor(s.winPct||0) }}>{s.winPct||0}%</div>
                      <div style={{ fontSize:9, color:(s.trend||0)>=0?T.success:T.danger }}>{(s.trend||0)>=0?'↑ +':'↓ '}{Math.abs(s.trend||0)}pp</div>
                    </div>
                  </div>

                  {/* Bars */}
                  <div style={{ padding:'10px 14px', display:'flex', flexDirection:'column', gap:6 }}>
                    {[['Poule', s.pouleWinPct||0, col],['DE', s.deWinPct||0, col+'88']].map(([lbl,pct,c]) => (
                      <div key={lbl} style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <span style={{ fontSize:10, color:T.textTertiary, width:38 }}>{lbl}</span>
                        <div style={{ flex:1, height:5, background:T.surface2, borderRadius:3 }}>
                          <div style={{ height:5, background:c, borderRadius:3, width:`${pct}%` }}/>
                        </div>
                        <span style={{ fontSize:10, fontWeight:500, color:c, width:28, textAlign:'right' }}>{pct}%</span>
                      </div>
                    ))}
                  </div>

                  {/* Flags */}
                  <div style={{ padding:'8px 14px 10px', borderTop:`0.5px solid ${T.surface2}`, display:'flex', gap:4, flexWrap:'wrap' }}>
                    {flags.map((fl,i) => {
                      const { bg, col } = flag(fl.sev);
                      return <span key={i} style={{ fontSize:10, padding:'2px 8px', borderRadius:10, fontWeight:500, background:bg, color:col }}>{fl.text}</span>;
                    })}
                  </div>
                </div>
              );
            })}
          </>
        )}

        {/* ── DRILL DOWN ── */}
        {activeTab === 'squad' && selected && (
          <>
            <div onClick={() => { setSelected(null); setDetail(null); }}
              style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, color:T.textTertiary, cursor:'pointer', marginBottom:2 }}>
              ← Back to squad
            </div>

            {!detail ? (
              <div style={{ color:T.textTertiary, fontSize:13, padding:20 }}>Loading…</div>
            ) : (
              <>
                {/* Profile header */}
                <div style={{ background:T.surface1, border:`0.5px solid ${T.surface2}`, borderRadius:T.borderRadius, padding:14, borderLeft:`3px solid ${selected.colour||T.primary}` }}>
                  <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:14 }}>
                    <div style={{ width:48, height:48, borderRadius:'50%', background:(selected.colour||T.primary)+'22', color:selected.colour||T.primary, display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, fontWeight:500, flexShrink:0 }}>
                      {selected.name?.split(' ').map(p=>p[0]).join('').slice(0,2)}
                    </div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:16, fontWeight:500, color:T.textPrimary }}>{selected.name}</div>
                      <div style={{ fontSize:11, color:T.textTertiary, marginTop:2 }}>{selected.category} · BF {selected.bf_licence} · UKR {selected.ukr_id}</div>
                    </div>
                    <div style={{ textAlign:'right' }}>
                      <div style={{ fontSize:24, fontWeight:500, color:pctColor(selected.stats?.winPct||0) }}>{selected.stats?.winPct||0}%</div>
                      <div style={{ fontSize:10, color:T.textTertiary }}>win rate</div>
                    </div>
                  </div>

                  <div style={{ display:'grid', gridTemplateColumns:'repeat(4,minmax(0,1fr))', gap:8, marginBottom:12 }}>
                    {[
                      { val:(selected.stats?.pouleWinPct||0)+'%', lbl:'Poule' },
                      { val:(selected.stats?.deWinPct||0)+'%',    lbl:'DE',    col:(selected.stats?.deWinPct||0)>=55?T.success:(selected.stats?.deWinPct||0)>=42?T.primary:T.danger },
                      { val:((selected.stats?.avgNet||0)>0?'+':'')+selected.stats?.avgNet, lbl:'Net touches', col:(selected.stats?.avgNet||0)>=0?T.success:T.danger },
                      { val:selected.stats?.medals||0, lbl:'Medals' },
                    ].map(m => (
                      <div key={m.lbl} style={{ background:T.surface2, borderRadius:6, padding:'8px 10px' }}>
                        <div style={{ fontSize:18, fontWeight:500, color:m.col||T.primary }}>{m.val}</div>
                        <div style={{ fontSize:10, color:T.textTertiary, marginTop:2 }}>{m.lbl}</div>
                      </div>
                    ))}
                  </div>

                  <button onClick={() => handleSync(selected.id)}
                    style={{ fontSize:11, padding:'5px 10px', background:'transparent', border:`0.5px solid ${T.surface3}`, borderRadius:T.borderRadiusSm, color:T.primary, cursor:'pointer' }}>
                    ↻ Sync UKRatings data
                  </button>
                </div>

                {/* Data signals */}
                <div style={{ background:T.surface1, border:`0.5px solid ${T.surface2}`, borderRadius:T.borderRadius, padding:14 }}>
                  <div style={{ fontSize:11, fontWeight:500, color:T.textTertiary, textTransform:'uppercase', letterSpacing:'.05em', marginBottom:10 }}>Data signals</div>
                  {getFocusFlags(selected).map((fl,i) => {
                    const { bg, col } = flag(fl.sev);
                    return (
                      <div key={i} style={{ background:bg, borderRadius:6, padding:'10px 12px', marginBottom:6, display:'flex', gap:10 }}>
                        <div style={{ width:7, height:7, borderRadius:'50%', background:col, flexShrink:0, marginTop:4 }}/>
                        <div>
                          <div style={{ fontSize:12, fontWeight:500, color:col }}>{fl.text}</div>
                          <div style={{ fontSize:11, color:col, opacity:.8, marginTop:2 }}>{fl.detail}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Coach notes */}
                <div style={{ background:T.surface1, border:`0.5px solid ${T.surface2}`, borderRadius:T.borderRadius, padding:14 }}>
                  <div style={{ fontSize:11, fontWeight:500, color:T.primary, textTransform:'uppercase', letterSpacing:'.05em', marginBottom:10 }}>Coach notes</div>
                  {(detail.notes||[]).map((n,i) => (
                    <div key={i} style={{ padding:'8px 0', borderBottom:`0.5px solid ${T.surface2}`, fontSize:13, color:T.textSecondary, lineHeight:1.6 }}>
                      <div>{n.note}</div>
                      <div style={{ fontSize:10, color:T.textTertiary, marginTop:3 }}>{n.created_at?.slice(0,10)}</div>
                    </div>
                  ))}
                  <div style={{ display:'flex', gap:8, marginTop:10 }}>
                    <input
                      value={note}
                      onChange={e => setNote(e.target.value)}
                      placeholder="Add a coaching note…"
                      style={{ flex:1, padding:'8px 10px', background:T.surface2, border:`0.5px solid ${T.surface3}`, borderRadius:T.borderRadiusSm, color:T.textPrimary, fontSize:13, outline:'none' }}
                      onKeyDown={e => e.key==='Enter' && handleAddNote()}
                    />
                    <button onClick={handleAddNote}
                      style={{ padding:'8px 14px', background:T.primary, border:'none', borderRadius:T.borderRadiusSm, color:'white', fontSize:12, cursor:'pointer' }}>
                      Add
                    </button>
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {/* ── COMPARISON ── */}
        {activeTab === 'compare' && (
          <>
            <div style={{ background:T.surface1, border:`0.5px solid ${T.surface2}`, borderRadius:T.borderRadius, padding:14 }}>
              <div style={{ fontSize:11, fontWeight:500, color:T.textTertiary, textTransform:'uppercase', letterSpacing:'.05em', marginBottom:12 }}>Win rate — all fencers</div>
              {[...squad].sort((a,b)=>(b.stats?.winPct||0)-(a.stats?.winPct||0)).map(f => (
                <div key={f.id} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
                  <div style={{ width:22, height:22, borderRadius:'50%', background:(f.colour||T.primary)+'22', color:f.colour||T.primary, display:'flex', alignItems:'center', justifyContent:'center', fontSize:9, fontWeight:500, flexShrink:0 }}>
                    {f.name?.split(' ').map(p=>p[0]).join('').slice(0,2)}
                  </div>
                  <div style={{ fontSize:12, color:T.textSecondary, width:100, flexShrink:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f.name?.split(' ')[0]}</div>
                  <div style={{ flex:1, height:6, background:T.surface2, borderRadius:3 }}>
                    <div style={{ height:6, background:f.colour||T.primary, borderRadius:3, width:`${f.stats?.winPct||0}%` }}/>
                  </div>
                  <div style={{ fontSize:12, fontWeight:500, color:pctColor(f.stats?.winPct||0), width:34, textAlign:'right' }}>{f.stats?.winPct||0}%</div>
                  <div style={{ fontSize:11, color:(f.stats?.trend||0)>=0?T.success:T.danger, width:44, textAlign:'right' }}>
                    {(f.stats?.trend||0)>=0?'↑ +':'↓ '}{Math.abs(f.stats?.trend||0)}pp
                  </div>
                </div>
              ))}
            </div>

            <div style={{ background:T.surface1, border:`0.5px solid ${T.surface2}`, borderRadius:T.borderRadius, padding:14 }}>
              <div style={{ fontSize:11, fontWeight:500, color:T.textTertiary, textTransform:'uppercase', letterSpacing:'.05em', marginBottom:12 }}>Full comparison</div>
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                  <thead>
                    <tr>
                      {['Fencer','Events','Win %','Poule','DE','Net','Medals','Top 8'].map(h => (
                        <th key={h} style={{ padding:'6px 10px', textAlign:'left', fontSize:10, fontWeight:500, color:T.textTertiary, textTransform:'uppercase', borderBottom:`0.5px solid ${T.surface2}` }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...squad].sort((a,b)=>(b.stats?.winPct||0)-(a.stats?.winPct||0)).map(f => {
                      const s = f.stats || {};
                      return (
                        <tr key={f.id} onMouseEnter={e=>e.currentTarget.style.background=T.surface2} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                          <td style={{ padding:'9px 10px', borderBottom:`0.5px solid ${T.surface2}` }}>
                            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                              <div style={{ width:20, height:20, borderRadius:'50%', background:(f.colour||T.primary)+'22', color:f.colour||T.primary, display:'flex', alignItems:'center', justifyContent:'center', fontSize:9, fontWeight:500 }}>
                                {f.name?.split(' ').map(p=>p[0]).join('').slice(0,2)}
                              </div>
                              {f.name?.split(' ')[0]}
                            </div>
                          </td>
                          {[s.events||0, `${s.winPct||0}%`, `${s.pouleWinPct||0}%`, `${s.deWinPct||0}%`, (s.avgNet||0)>0?`+${s.avgNet}`:s.avgNet||0, s.medals||0, s.top8||0].map((v,i) => (
                            <td key={i} style={{ padding:'9px 10px', borderBottom:`0.5px solid ${T.surface2}`, color:T.textSecondary }}>{v}</td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* ── FOCUS AREAS ── */}
        {activeTab === 'focus' && (
          <>
            {['r','a','g'].map(sev => {
              const label = sev==='r'?'Priority — action required':sev==='a'?'Monitor — watch closely':'On track — positive signals';
              const border = sev==='r'?T.danger:sev==='a'?T.warning:T.success;
              const items = squad.flatMap(f =>
                getFocusFlags(f).filter(fl=>fl.sev===sev).map(fl=>({ fencer:f, ...fl }))
              );
              return (
                <div key={sev} style={{ background:T.surface1, border:`0.5px solid ${T.surface2}`, borderRadius:T.borderRadius, padding:14, borderLeft:`2px solid ${border}` }}>
                  <div style={{ fontSize:11, fontWeight:500, color:T.textTertiary, textTransform:'uppercase', letterSpacing:'.05em', marginBottom:10 }}>{label}</div>
                  {items.length === 0 ? (
                    <div style={{ fontSize:12, color:T.textTertiary }}>None at this level.</div>
                  ) : items.map((item,i) => {
                    const { bg, col } = flag(sev);
                    return (
                      <div key={i} style={{ background:bg, borderRadius:6, padding:'10px 12px', marginBottom:6, display:'flex', gap:10, alignItems:'flex-start' }}>
                        <div style={{ width:7, height:7, borderRadius:'50%', background:col, flexShrink:0, marginTop:4 }}/>
                        <div>
                          <div style={{ fontSize:12, fontWeight:500, color:col, display:'flex', alignItems:'center', gap:6 }}>
                            <div style={{ width:16, height:16, borderRadius:'50%', background:(item.fencer.colour||T.primary)+'22', color:item.fencer.colour||T.primary, display:'flex', alignItems:'center', justifyContent:'center', fontSize:8, fontWeight:500 }}>
                              {item.fencer.name?.split(' ').map(p=>p[0]).join('').slice(0,2)}
                            </div>
                            {item.fencer.name?.split(' ')[0]} — {item.text}
                          </div>
                          <div style={{ fontSize:11, color:col, opacity:.8, marginTop:3 }}>{item.detail}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </>
        )}

        {/* ── ADD TOURNAMENT ── */}
        {activeTab === 'tournament' && (
          <AddTournamentTab />
        )}

        {/* ── UPCOMING ── */}
        {activeTab === 'upcoming' && (
          <div style={{ background:T.surface1, border:`0.5px solid ${T.surface2}`, borderRadius:T.borderRadius, padding:14 }}>
            <div style={{ fontSize:11, fontWeight:500, color:T.textTertiary, textTransform:'uppercase', letterSpacing:'.05em', marginBottom:12 }}>Upcoming events</div>
            <div style={{ fontSize:13, color:T.textTertiary, padding:'20px 0', textAlign:'center' }}>
              Upcoming events are pulled from UKRatings upcoming competitions data.<br/>
              <span style={{ fontSize:12, color:T.primary, cursor:'pointer', marginTop:8, display:'block' }} onClick={() => window.open('https://www.ukratings.co.uk', '_blank')}>
                View on UKRatings →
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
