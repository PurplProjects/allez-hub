import { useState, useEffect } from 'react';
import { getChecklist, saveChecklist } from '../../../lib/api';
import { CHECKLIST_ITEMS, theme } from '../../../lib/theme';

const T = theme;

export default function MentalTab({ fencerId }) {
  const today = new Date().toISOString().split('T')[0];
  const [checked, setChecked] = useState(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getChecklist(today)
      .then(data => setChecked(new Set(data.completed || [])))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [today]);

  async function toggle(idx) {
    const newSet = new Set(checked);
    const completing = !newSet.has(idx);
    if (completing) newSet.add(idx); else newSet.delete(idx);
    setChecked(newSet);
    await saveChecklist(today, idx, completing).catch(() => {});
  }

  const done  = checked.size;
  const total = CHECKLIST_ITEMS.length;
  const pct   = Math.round(done / total * 100);

  return (
    <div style={{ padding:14, display:'flex', flexDirection:'column', gap:10 }}>
      <div style={{ background:T.surface1, border:`0.5px solid ${T.surface2}`, borderRadius:T.borderRadius, padding:14 }}>

        {/* Header + progress */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
          <div style={{ fontSize:11, fontWeight:500, color:T.textTertiary, textTransform:'uppercase', letterSpacing:'.05em' }}>
            Pre-competition checklist
          </div>
          <span style={{ fontSize:11, color:T.textTertiary }}>{done} / {total} done</span>
        </div>
        <div style={{ height:5, background:T.surface2, borderRadius:3, marginBottom:14 }}>
          <div style={{ height:5, background:pct===100?T.success:T.primary, borderRadius:3, width:`${pct}%`, transition:'width .3s' }}/>
        </div>

        {/* Checklist items */}
        {CHECKLIST_ITEMS.map((item, i) => {
          const done = checked.has(i);
          return (
            <div
              key={i}
              onClick={() => toggle(i)}
              style={{ display:'flex', alignItems:'flex-start', gap:10, padding:'10px 0', borderBottom:`0.5px solid ${T.surface2}`, cursor:'pointer' }}
            >
              {/* Checkbox */}
              <div style={{
                width:20, height:20, borderRadius:5,
                border:`1.5px solid ${done ? T.primary : T.surface3}`,
                background: done ? T.primary : 'transparent',
                flexShrink:0, marginTop:1,
                display:'flex', alignItems:'center', justifyContent:'center',
                transition:'all .15s',
              }}>
                {done && <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><polyline points="1.5,5.5 4,8 8.5,2" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
              </div>

              {/* Text */}
              <div style={{ flex:1 }}>
                <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                  <span style={{ fontSize:13, fontWeight:500, color:done?T.textTertiary:T.textPrimary, textDecoration:done?'line-through':'none' }}>
                    {item.title}
                  </span>
                  <span style={{ fontSize:9, padding:'2px 6px', borderRadius:4, fontWeight:500, background:item.catBg, color:item.catColor }}>
                    {item.cat}
                  </span>
                </div>
                <div style={{ fontSize:11, color:T.textTertiary, marginTop:3, lineHeight:1.5 }}>{item.detail}</div>
              </div>
            </div>
          );
        })}

        {pct === 100 && (
          <div style={{ background:'#052e16', borderRadius:T.borderRadiusSm, padding:'10px 12px', marginTop:12, fontSize:13, color:'#86efac', textAlign:'center' }}>
            All done — you're ready to fence. Go get it.
          </div>
        )}
      </div>

      {/* Coach note */}
      <div style={{ background:T.surface1, border:`0.5px solid ${T.surface2}`, borderRadius:T.borderRadius, padding:14, borderLeft:`2px solid ${T.primary}` }}>
        <div style={{ fontSize:11, fontWeight:500, color:T.primary, marginBottom:6, textTransform:'uppercase', letterSpacing:'.05em' }}>Coach note</div>
        <div style={{ fontSize:12, color:T.textSecondary, lineHeight:1.6 }}>
          Complete this checklist on the morning of every competition. Focus on process goals — things you control — not result goals like "I want to medal".
        </div>
      </div>
    </div>
  );
}
