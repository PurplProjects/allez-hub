import { theme, ROUTINE_STEPS } from '../../../lib/theme';

const T = theme;

export default function RoutineTab({ cuephrase }) {
  const cue = cuephrase || 'My footwork';

  return (
    <div style={{ padding:14, display:'flex', flexDirection:'column', gap:10 }}>
      <div style={{ background:T.surface1, border:`0.5px solid ${T.surface2}`, borderRadius:T.borderRadius, padding:14 }}>
        <div style={{ fontSize:11, fontWeight:500, color:T.textTertiary, textTransform:'uppercase', letterSpacing:'.05em', marginBottom:12 }}>
          Match-day routine — refer here on competition day
        </div>

        {ROUTINE_STEPS.map((step, i) => (
          <div key={i} style={{ display:'flex', gap:12, padding:'10px 0', borderBottom:`0.5px solid ${T.surface2}` }}>
            {/* Step number */}
            <div style={{ width:26, height:26, borderRadius:'50%', background:T.primary, color:'white', fontSize:12, fontWeight:500, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, marginTop:2 }}>
              {i + 1}
            </div>

            <div style={{ flex:1 }}>
              <div style={{ fontSize:10, fontWeight:500, color:T.primary, marginBottom:2 }}>{step.time}</div>
              <div style={{ fontSize:13, fontWeight:500, color:T.textPrimary }}>{step.title}</div>
              <div style={{ fontSize:11, color:T.textTertiary, marginTop:4, lineHeight:1.6 }}>{step.detail}</div>
              {step.cue && step.cue !== 'Your cue phrase' && (
                <div style={{ background:T.surface2, borderLeft:`2px solid ${T.primary}`, padding:'5px 8px', borderRadius:'0 5px 5px 0', marginTop:6, fontSize:11, color:'#FFEDD5', fontStyle:'italic' }}>
                  "{step.cue}"
                </div>
              )}
              {step.cue === 'Your cue phrase' && (
                <div style={{ background:T.surface2, borderLeft:`2px solid ${T.primary}`, padding:'5px 8px', borderRadius:'0 5px 5px 0', marginTop:6, fontSize:11, color:T.primary, fontStyle:'italic', fontWeight:500 }}>
                  "{cue}"
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Personal cue phrase card */}
      <div style={{ background:T.surface2, border:`0.5px solid ${T.surface3}`, borderRadius:T.borderRadius, padding:'16px 14px' }}>
        <div style={{ fontSize:11, fontWeight:500, color:T.primary, marginBottom:8, textTransform:'uppercase', letterSpacing:'.05em' }}>Your personal cue phrase</div>
        <div style={{ fontSize:24, fontWeight:500, color:T.textPrimary, textAlign:'center', padding:'12px 0' }}>"{cue}"</div>
        <div style={{ fontSize:11, color:T.textTertiary, textAlign:'center' }}>Say this at the salute — every bout, every time</div>
      </div>
    </div>
  );
}
