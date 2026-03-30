// PoolDETab.jsx
import { useTheme } from '../../../hooks/useTheme';

export function PoolDETab({ stats }) {
  const { theme: T } = useTheme();
  if (!stats) return null;
  const c = stats.career || {};
  const years = Object.keys(stats.byYear || {}).sort();

  const gapColor = (gap) => gap > 15 ? T.danger : gap > 8 ? T.warning : T.success;

  return (
    <div style={{ padding:14, display:'flex', flexDirection:'column', gap:10 }}>
      <div style={{ background:T.surface1, border:`0.5px solid ${T.surface2}`, borderRadius:T.borderRadius, padding:14 }}>
        <div style={{ fontSize:11, fontWeight:500, color:T.textTertiary, textTransform:'uppercase', letterSpacing:'.05em', marginBottom:12 }}>Career poule vs DE</div>
        {[['Poule', c.pouleWinPct, T.primary],['DE', c.deWinPct, T.textTertiary]].map(([lbl,pct,col]) => (
          <div key={lbl} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
            <div style={{ fontSize:12, color:T.textSecondary, width:55, flexShrink:0 }}>{lbl}</div>
            <div style={{ flex:1, height:8, background:T.surface2, borderRadius:4 }}>
              <div style={{ height:8, background:col, borderRadius:4, width:`${pct}%`, transition:'width .5s' }}/>
            </div>
            <div style={{ fontSize:12, fontWeight:500, color:col, width:34, textAlign:'right' }}>{pct}%</div>
          </div>
        ))}
        <div style={{ background:T.surface2, borderRadius:6, padding:'8px 10px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontSize:12, color:T.textSecondary }}>Gap (Poule - DE)</span>
          <span style={{ fontSize:12, fontWeight:500, color:gapColor(c.pouleWinPct - c.deWinPct) }}>{c.pouleWinPct - c.deWinPct}pp</span>
        </div>
      </div>
      <div style={{ background:T.surface1, border:`0.5px solid ${T.surface2}`, borderRadius:T.borderRadius, padding:14 }}>
        <div style={{ fontSize:11, fontWeight:500, color:T.textTertiary, textTransform:'uppercase', letterSpacing:'.05em', marginBottom:12 }}>By year</div>
        {years.map(y => {
          const yd = stats.byYear[y];
          const p = yd.pouleT ? Math.round(yd.pouleW/yd.pouleT*100) : 0;
          const d = yd.deT    ? Math.round(yd.deW/yd.deT*100)    : 0;
          const gap = p - d;
          return (
            <div key={y} style={{ marginBottom:14 }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:5 }}>
                <span style={{ fontSize:13, fontWeight:500, color:T.textPrimary }}>{y}</span>
                <span style={{ fontSize:11, color:gapColor(gap) }}>Gap: {gap}pp</span>
              </div>
              {[['Poule',p,T.primary],['DE',d,T.textTertiary]].map(([lbl,pct,col]) => (
                <div key={lbl} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                  <span style={{ fontSize:11, color:T.textTertiary, width:44 }}>{lbl}</span>
                  <div style={{ flex:1, height:5, background:T.surface2, borderRadius:3 }}>
                    <div style={{ width:`${pct}%`, height:5, background:col, borderRadius:3 }}/>
                  </div>
                  <span style={{ fontSize:11, fontWeight:500, color:col, width:28, textAlign:'right' }}>{pct}%</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function RivalsTab({ rivals = [] }) {
  const { theme: T } = useTheme();
  const priorityTargets = rivals.filter(r => r.winPct < 40).sort((a,b) => a.winPct - b.winPct);
  const strongRecords   = rivals.filter(r => r.winPct >= 60).sort((a,b) => b.winPct - a.winPct);
  const competitive     = rivals.filter(r => r.winPct >= 40 && r.winPct < 60);

  const RivalRow = ({ r }) => {
    const col = r.winPct >= 60 ? T.success : r.winPct >= 40 ? T.warning : T.danger;
    const bg  = r.winPct >= 60 ? '#052e16' : r.winPct >= 40 ? '#451a03' : '#450a0a';
    const tc  = r.winPct >= 60 ? '#86efac' : r.winPct >= 40 ? '#fcd34d' : '#fca5a5';
    return (
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'9px 0', borderBottom:`0.5px solid ${T.surface2}` }}>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:13, fontWeight:500, color:T.textPrimary }}>{r.name}
            <span style={{ fontSize:10, color:T.textTertiary, fontWeight:400, marginLeft:6 }}>({r.enc} bouts)</span>
          </div>
          <div style={{ fontSize:11, color:T.textTertiary, marginTop:2 }}>Avg: {r.avgFor} scored vs {r.avgAgainst} conceded</div>
        </div>
        <div style={{ textAlign:'right' }}>
          <span style={{ fontSize:11, padding:'2px 8px', borderRadius:10, fontWeight:500, background:bg, color:tc }}>{r.winPct}%</span>
          <div style={{ marginTop:4, width:60, height:4, background:T.surface2, borderRadius:2, marginLeft:'auto' }}>
            <div style={{ width:`${r.winPct}%`, height:4, background:col, borderRadius:2 }}/>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ padding:14, display:'flex', flexDirection:'column', gap:10 }}>
      {[
        { title:'Priority targets', items:priorityTargets, border:T.danger },
        { title:'Competitive - winnable', items:competitive, border:T.warning },
        { title:'Strong records', items:strongRecords, border:T.success },
      ].map(section => section.items.length > 0 && (
        <div key={section.title} style={{ background:T.surface1, border:`0.5px solid ${T.surface2}`, borderRadius:T.borderRadius, padding:14, borderLeft:`2px solid ${section.border}` }}>
          <div style={{ fontSize:11, fontWeight:500, color:T.textTertiary, textTransform:'uppercase', letterSpacing:'.05em', marginBottom:8 }}>{section.title}</div>
          {section.items.map(r => <RivalRow key={r.name} r={r} />)}
        </div>
      ))}
      {rivals.length === 0 && (
        <div style={{ padding:32, textAlign:'center', color:T.textTertiary, fontSize:13 }}>
          Not enough data yet - rivals appear after 3+ encounters with the same opponent.
        </div>
      )}
    </div>
  );
}
