import { useState, useEffect } from 'react';
import { useTheme } from '../../../hooks/useTheme';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale,
  LineElement, PointElement, Tooltip, Filler,
} from 'chart.js';
ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Tooltip, Filler);

// ── AI insight engine ─────────────────────────────────────────
function generateInsights(stats) {
  if (!stats?.career) return [];
  const c = stats.career;
  const byYear = stats.byYear || {};
  const years  = Object.keys(byYear).sort();
  const thisYr = new Date().getFullYear().toString();
  const lastYr = (new Date().getFullYear() - 1).toString();
  const insights = [];

  // Season momentum
  const thisWP = byYear[thisYr]?.total ? Math.round(byYear[thisYr].won / byYear[thisYr].total * 100) : null;
  const lastWP = byYear[lastYr]?.total ? Math.round(byYear[lastYr].won / byYear[lastYr].total * 100) : null;
  if (thisWP !== null && lastWP !== null) {
    const delta = thisWP - lastWP;
    if (delta >= 15) insights.push({ emoji:'🔥', label:'On fire', title:`+${delta}pp year-on-year`, body:'Best form of career.', type:'positive' });
    else if (delta >= 6) insights.push({ emoji:'📈', label:'Improving', title:`+${delta}pp vs ${lastYr}`, body:'Consistent upward trajectory.', type:'positive' });
    else if (delta <= -8) insights.push({ emoji:'⚠️', label:'Form dip', title:`${delta}pp vs ${lastYr}`, body:'Worth reviewing in sessions.', type:'warning' });
  }

  // Poule–DE gap
  const gap = (c.pouleWinPct || 0) - (c.deWinPct || 0);
  if (gap >= 20) insights.push({ emoji:'⚡', label:'DE focus', title:`${gap}pp pool–DE gap`, body:'DE composure is the key lever.', type:'warning' });
  else if (gap >= 10) insights.push({ emoji:'⚡', label:'DE gap', title:`${gap}pp pool–DE gap`, body:'Closing — keep the drill work up.', type:'neutral' });
  else if (gap <= 3 && (c.deWinPct || 0) >= 50) insights.push({ emoji:'🛡️', label:'DE performer', title:`${c.deWinPct}% DE win rate`, body:'Real composure under pressure.', type:'positive' });

  // Multi-year growth
  if (years.length >= 3) {
    const wps = years.slice(-3).map(y => byYear[y]?.total ? Math.round(byYear[y].won/byYear[y].total*100) : 0);
    if (wps.every((v,i) => i === 0 || v >= wps[i-1]-3) && wps[wps.length-1] > wps[0]+5)
      insights.push({ emoji:'🚀', label:'Multi-year growth', title:`Improving every season`, body:`${years.slice(-3).join(', ')}: sustained development.`, type:'positive' });
  }

  // Medals
  if ((c.medals || 0) >= 3) insights.push({ emoji:'🥇', label:'Podium record', title:`${c.medals} career medals`, body:`${c.top8} top-8s across ${c.events} events.`, type:'positive' });
  else if ((c.top8 || 0) >= 3 && (c.medals || 0) === 0) insights.push({ emoji:'🎯', label:'Near misses', title:`${c.top8} top-8 finishes`, body:'The semi-final DE is the next barrier.', type:'neutral' });

  const order = { positive:0, neutral:1, warning:2 };
  return insights.sort((a,b) => order[a.type]-order[b.type]).slice(0,3);
}

// ── Year row emoji ────────────────────────────────────────────
function yearEmoji(year, byYear) {
  const thisYr = new Date().getFullYear().toString();
  if (year === thisYr) return '🚀';
  const years = Object.keys(byYear).sort();
  const idx   = years.indexOf(year);
  if (idx <= 0) return '📊';
  const prevWP = byYear[years[idx-1]]?.total ? byYear[years[idx-1]].won/byYear[years[idx-1]].total : 0;
  const thisWP = byYear[year]?.total ? byYear[year].won/byYear[year].total : 0;
  if (thisWP - prevWP > 0.05) return '📈';
  if (thisWP - prevWP < -0.05) return '📉';
  return '⬆️';
}

export default function OverviewTab({ fencer, stats, competitions }) {
  const { theme: T } = useTheme();
  const [animIn, setAnimIn] = useState(false);
  useEffect(() => { const t = setTimeout(() => setAnimIn(true), 50); return () => clearTimeout(t); }, []);

  if (!fencer || !stats) return (
    <div style={{ padding:40, textAlign:'center', color:T.textTertiary, fontSize:13 }}>
      No data yet — trigger a sync to load results.
    </div>
  );

  const c      = stats.career || {};
  const byYear = stats.byYear || {};
  const years  = Object.keys(byYear).sort();
  const thisYr = new Date().getFullYear().toString();
  const lastYr = (new Date().getFullYear()-1).toString();
  const insights = generateInsights(stats);

  const thisWP  = byYear[thisYr]?.total ? Math.round(byYear[thisYr].won/byYear[thisYr].total*100) : null;
  const lastWP  = byYear[lastYr]?.total ? Math.round(byYear[lastYr].won/byYear[lastYr].total*100) : null;
  const delta   = thisWP !== null && lastWP !== null ? thisWP - lastWP : null;
  const thisEvt = byYear[thisYr]?.events || 0;
  const thisMed = byYear[thisYr]?.medals || 0;

  // Net touches per year for sparkline
  const netByYear = years.map(y => {
    const d = byYear[y];
    if (!d?.total) return 0;
    return Math.round(((d.touchesFor||0)-(d.touchesAgainst||0))/d.total*10)/10;
  });

  const lineData = {
    labels: years,
    datasets: [{
      label:'Win %',
      data: years.map(y => byYear[y]?.total ? Math.round(byYear[y].won/byYear[y].total*100) : 0),
      borderColor: T.primary, backgroundColor: T.primary+'18',
      borderWidth:2, pointBackgroundColor:T.primary, pointRadius:4, tension:0.4, fill:true,
    },{
      label:'Poule %',
      data: years.map(y => byYear[y]?.pouleT ? Math.round(byYear[y].pouleW/byYear[y].pouleT*100) : 0),
      borderColor: T.info, backgroundColor:'transparent',
      borderWidth:1.5, pointRadius:3, borderDash:[4,3], tension:0.4,
    },{
      label:'DE %',
      data: years.map(y => byYear[y]?.deT ? Math.round(byYear[y].deW/byYear[y].deT*100) : 0),
      borderColor: T.textTertiary, backgroundColor:'transparent',
      borderWidth:1.5, pointRadius:3, borderDash:[4,3], tension:0.4,
    }],
  };

  const lineOpts = {
    responsive:true, maintainAspectRatio:false,
    plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label: ctx=>`${ctx.dataset.label}: ${ctx.parsed.y}%` } } },
    scales:{
      x:{ ticks:{color:T.textTertiary,font:{size:10}}, grid:{display:false}, border:{color:'transparent'} },
      y:{ min:0, max:100, ticks:{color:T.textTertiary,font:{size:10},callback:v=>v+'%'}, grid:{color:T.surface3+'66'}, border:{color:'transparent'} },
    },
  };

  const card = (extra={}) => ({
    background: T.surface1,
    border: `1px solid ${T.surface3}`,
    borderRadius: T.borderRadius,
    ...extra,
  });

  const fade = d => ({
    opacity: animIn?1:0,
    transform: animIn?'translateY(0)':'translateY(14px)',
    transition: `opacity .35s ease ${d}ms, transform .35s ease ${d}ms`,
  });

  const insightBg = { positive: { bg:'#052e16', border:'#16A34A', text:'#86efac' }, warning:{ bg:'#450a0a', border:'#EF4444', text:'#fca5a5' }, neutral:{ bg:'#1e3a5f', border:'#3B82F6', text:'#93c5fd' } };
  // Light mode overrides for insight cards
  const insightBgLight = { positive:{ bg:'#f0fdf4', border:'#16A34A', text:'#15803d' }, warning:{ bg:'#fef2f2', border:'#EF4444', text:'#dc2626' }, neutral:{ bg:'#eff6ff', border:'#3B82F6', text:'#1d4ed8' } };
  const iColors = (type) => T.mode==='light' ? insightBgLight[type] : insightBg[type];

  return (
    <div style={{ padding:'14px 14px 32px', display:'flex', flexDirection:'column', gap:12, background:T.black, minHeight:'100%' }}>

      {/* ── HERO CARD ── */}
      <div style={{ ...card(), ...fade(0), padding:'18px 16px', borderLeft:`3px solid ${fencer.colour||T.primary}`, position:'relative', overflow:'hidden' }}>
        <div style={{ position:'absolute', right:-16, top:-16, width:90, height:90, borderRadius:'50%', background:(fencer.colour||T.primary)+'0a', border:`1px solid ${(fencer.colour||T.primary)}18` }}/>
        <div style={{ display:'flex', alignItems:'center', gap:14 }}>
          <div style={{
            width:56, height:56, borderRadius:'50%', flexShrink:0,
            background:(fencer.colour||T.primary)+'22', border:`2px solid ${(fencer.colour||T.primary)}55`,
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:20, fontWeight:700, color:fencer.colour||T.primary,
          }}>
            {fencer.name?.split(' ').map(p=>p[0]).join('').slice(0,2)}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:18, fontWeight:700, color:T.textPrimary, letterSpacing:'-0.3px' }}>
              {fencer.name?.split(' ')[0]}
              <span style={{ color:T.textSecondary, fontWeight:400 }}> {fencer.name?.split(' ').slice(1).join(' ')}</span>
            </div>
            <div style={{ fontSize:12, color:T.primary, fontWeight:500, marginTop:3 }}>
              🤺 {fencer.club||'Allez Fencing'}
            </div>
            <div style={{ fontSize:11, color:T.textTertiary, marginTop:2 }}>
              {fencer.category} · BF {fencer.bf_licence}
              {fencer.school && ` · ${fencer.school}`}
            </div>
          </div>
          <div style={{ textAlign:'right', flexShrink:0 }}>
            <div style={{ fontSize:10, color:T.textTertiary, textTransform:'uppercase', letterSpacing:'.05em' }}>Season</div>
            <div style={{ fontSize:26, fontWeight:800, color:thisWP!==null?(delta>=0?T.success:T.danger):T.textTertiary, lineHeight:1.1, letterSpacing:'-1px' }}>
              {thisWP!==null?`${thisWP}%`:'—'}
            </div>
            {delta!==null && (
              <div style={{ fontSize:11, color:delta>=0?T.success:T.danger, fontWeight:600 }}>
                {delta>=0?'▲':'▼'} {Math.abs(delta)}pp
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── SEASON + CAREER STATS ── */}
      <div style={{ ...fade(80), display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>

        {/* 2026 Season card */}
        <div style={{ ...card(), padding:'14px' }}>
          <div style={{ fontSize:10, color:T.textTertiary, textTransform:'uppercase', letterSpacing:'.06em', marginBottom:10, fontWeight:500 }}>
            🚀 {thisYr} Season
          </div>
          <div style={{ fontSize:36, fontWeight:800, color:T.primary, lineHeight:1, letterSpacing:'-2px', marginBottom:8 }}>
            {thisWP!==null?`${thisWP}%`:'—'}
          </div>
          <div style={{ fontSize:11, color:T.textSecondary }}>Win rate</div>
          <div style={{ borderTop:`1px solid ${T.surface3}`, marginTop:10, paddingTop:10, display:'flex', flexDirection:'column', gap:5 }}>
            {[
              [`⚔️ ${byYear[thisYr]?.total||0}`, 'bouts'],
              [`📅 ${thisEvt}`, 'events'],
              [`🥇 ${thisMed}`, 'medals'],
            ].map(([val,lbl]) => (
              <div key={lbl} style={{ display:'flex', justifyContent:'space-between', fontSize:12 }}>
                <span style={{ color:T.textPrimary, fontWeight:500 }}>{val}</span>
                <span style={{ color:T.textTertiary }}>{lbl}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Career card */}
        <div style={{ ...card(), padding:'14px' }}>
          <div style={{ fontSize:10, color:T.textTertiary, textTransform:'uppercase', letterSpacing:'.06em', marginBottom:10, fontWeight:500 }}>
            📊 Career
          </div>
          <div style={{ fontSize:36, fontWeight:800, color:T.textPrimary, lineHeight:1, letterSpacing:'-2px', marginBottom:8 }}>
            {c.winPct||0}%
          </div>
          <div style={{ fontSize:11, color:T.textSecondary }}>Win rate</div>
          <div style={{ borderTop:`1px solid ${T.surface3}`, marginTop:10, paddingTop:10, display:'flex', flexDirection:'column', gap:5 }}>
            {[
              [`⚔️ ${c.bouts||0}`, 'total bouts'],
              [`🥇 ${c.medals||0}`, 'medals'],
              [`🏆 ${c.top8||0}`, 'top 8s'],
            ].map(([val,lbl]) => (
              <div key={lbl} style={{ display:'flex', justifyContent:'space-between', fontSize:12 }}>
                <span style={{ color:T.textPrimary, fontWeight:500 }}>{val}</span>
                <span style={{ color:T.textTertiary }}>{lbl}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── POULE vs DE ── */}
      <div style={{ ...card(), ...fade(140), padding:'14px 16px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
          <span style={{ fontSize:11, color:T.textTertiary, textTransform:'uppercase', letterSpacing:'.06em', fontWeight:500 }}>
            Poule vs DE
          </span>
          <span style={{
            fontSize:10, padding:'2px 8px', borderRadius:10, fontWeight:600,
            background: (c.pouleWinPct-c.deWinPct)>15 ? '#EF444422' : '#16A34A22',
            color:      (c.pouleWinPct-c.deWinPct)>15 ? T.danger     : T.success,
          }}>
            {(c.pouleWinPct||0)-(c.deWinPct||0)>0 ? `${(c.pouleWinPct||0)-(c.deWinPct||0)}pp gap` : 'Balanced'}
          </span>
        </div>
        {[
          { emoji:'📋', lbl:'Poule', val:c.pouleWinPct||0, col:T.info },
          { emoji:'⚡', lbl:'DE',    val:c.deWinPct||0,    col:T.primary },
        ].map(b => (
          <div key={b.lbl} style={{ marginBottom:10 }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
              <span style={{ fontSize:12, color:T.textSecondary, fontWeight:500 }}>{b.emoji} {b.lbl}</span>
              <span style={{ fontSize:13, fontWeight:700, color:b.col }}>{b.val}%</span>
            </div>
            <div style={{ height:8, background:T.surface2, borderRadius:4, overflow:'hidden' }}>
              <div style={{ height:8, background:b.col, borderRadius:4, width:`${b.val}%`, transition:'width .9s cubic-bezier(0.34,1.56,0.64,1)' }}/>
            </div>
          </div>
        ))}
        {(c.pouleWinPct-c.deWinPct)>10 && (
          <div style={{ fontSize:11, color:T.textTertiary, marginTop:4, fontStyle:'italic' }}>
            DE conversion is the key development area
          </div>
        )}
      </div>

      {/* ── YEAR-BY-YEAR TABLE (Magicpath style) ── */}
      <div style={{ ...card(), ...fade(180), padding:'14px 16px' }}>
        <div style={{ fontSize:11, color:T.textTertiary, textTransform:'uppercase', letterSpacing:'.06em', fontWeight:500, marginBottom:12 }}>
          Career Overview — season by season
        </div>
        <div style={{ overflowX:'auto', WebkitOverflowScrolling:'touch' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12, minWidth:480 }}>
            <thead>
              <tr style={{ borderBottom:`1px solid ${T.surface3}` }}>
                {['YEAR','⚔️ BOUTS','WIN RATE','📋 POULE W/T','%','⚡ DE W/T','%','✅ FOR','❌ AGN','🎯 NET'].map(h => (
                  <th key={h} style={{ padding:'6px 8px 8px', textAlign:h==='YEAR'?'left':'center', fontSize:9, fontWeight:600, color:T.textTertiary, textTransform:'uppercase', letterSpacing:'.04em', whiteSpace:'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {years.map((yr, i) => {
                const d = byYear[yr] || {};
                const wp   = d.total   ? Math.round(d.won/d.total*100)       : 0;
                const ppct = d.pouleT  ? Math.round(d.pouleW/d.pouleT*100)   : 0;
                const dpct = d.deT     ? Math.round(d.deW/d.deT*100)         : 0;
                const net  = (d.touchesFor||0)-(d.touchesAgainst||0);
                const isThis = yr===thisYr;
                return (
                  <tr key={yr} style={{
                    borderBottom: i<years.length-1 ? `1px solid ${T.surface3}` : 'none',
                    background: isThis ? T.primary+'0d' : 'transparent',
                  }}>
                    <td style={{ padding:'10px 8px', fontWeight:700, color:isThis?T.primary:T.textPrimary, whiteSpace:'nowrap' }}>
                      {yearEmoji(yr, byYear)} {yr}{isThis?' YTD':''}
                    </td>
                    <td style={{ padding:'10px 8px', textAlign:'center', color:T.textPrimary, fontWeight:600 }}>{d.total||0}</td>
                    <td style={{ padding:'10px 8px', textAlign:'center', fontWeight:700, color:wp>=60?T.success:wp>=45?T.warning:T.danger }}>{wp}%</td>
                    <td style={{ padding:'10px 8px', textAlign:'center', color:T.textSecondary }}>{d.pouleW||0}/{d.pouleT||0}</td>
                    <td style={{ padding:'10px 8px', textAlign:'center', color:T.info, fontWeight:600 }}>{ppct}%</td>
                    <td style={{ padding:'10px 8px', textAlign:'center', color:T.textSecondary }}>{d.deW||0}/{d.deT||0}</td>
                    <td style={{ padding:'10px 8px', textAlign:'center', color:T.primary, fontWeight:600 }}>{dpct}%</td>
                    <td style={{ padding:'10px 8px', textAlign:'center', color:T.success, fontWeight:500 }}>{d.touchesFor||0}</td>
                    <td style={{ padding:'10px 8px', textAlign:'center', color:T.danger, fontWeight:500 }}>{d.touchesAgainst||0}</td>
                    <td style={{ padding:'10px 8px', textAlign:'center', fontWeight:700, color:net>=0?T.success:T.danger }}>
                      {net>0?`+${net}`:net}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── NET TOUCHES TREND CHART ── */}
      {years.length >= 2 && (
        <div style={{ ...card(), ...fade(220), padding:'14px 16px' }}>
          <div style={{ fontSize:11, color:T.textTertiary, textTransform:'uppercase', letterSpacing:'.06em', fontWeight:500, marginBottom:4 }}>
            Win Rate Trend
          </div>
          <div style={{ fontSize:11, color:T.textTertiary, marginBottom:12 }}>
            Season-by-season performance — Win rate, Poule & DE
          </div>
          <div style={{ height:160 }}>
            <Line data={lineData} options={lineOpts} />
          </div>
          <div style={{ display:'flex', gap:16, marginTop:10 }}>
            {[['Win rate',T.primary,false],['📋 Poule',T.info,true],['⚡ DE',T.textTertiary,true]].map(([lbl,col,dashed])=>(
              <div key={lbl} style={{ display:'flex', alignItems:'center', gap:5 }}>
                <div style={{ width:16, height:2, background:dashed?'transparent':col, borderTop:dashed?`2px dashed ${col}`:'none' }}/>
                <span style={{ fontSize:10, color:T.textTertiary }}>{lbl}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── AI INSIGHTS ── */}
      {insights.length > 0 && (
        <div style={{ ...fade(260) }}>
          <div style={{ fontSize:11, color:T.textTertiary, textTransform:'uppercase', letterSpacing:'.06em', fontWeight:500, marginBottom:8 }}>
            🧠 Performance insights
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px,1fr))', gap:8 }}>
            {insights.map((ins,i) => {
              const ic = iColors(ins.type);
              return (
                <div key={i} style={{
                  background: ic.bg, border:`1px solid ${ic.border}33`,
                  borderRadius: T.borderRadius, padding:'12px',
                }}>
                  <div style={{ fontSize:22, marginBottom:6 }}>{ins.emoji}</div>
                  <div style={{ fontSize:10, fontWeight:700, color:ic.text, textTransform:'uppercase', letterSpacing:'.04em', marginBottom:3 }}>{ins.label}</div>
                  <div style={{ fontSize:13, fontWeight:700, color:ic.text, marginBottom:4, lineHeight:1.2 }}>{ins.title}</div>
                  <div style={{ fontSize:11, color:ic.text, opacity:.8, lineHeight:1.5 }}>{ins.body}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── BEST RESULTS ── */}
      {competitions?.filter(c=>c.rank&&c.rank<=8).length > 0 && (
        <div style={{ ...card(), ...fade(300), padding:'14px 16px' }}>
          <div style={{ fontSize:11, color:T.textTertiary, textTransform:'uppercase', letterSpacing:'.06em', fontWeight:500, marginBottom:12 }}>
            🏆 Best results
          </div>
          {competitions.filter(c=>c.rank&&c.rank<=8).slice(0,6).map((comp,i,arr) => {
            const medal = comp.rank===1?'🥇':comp.rank===2?'🥈':comp.rank===3?'🥉':null;
            const ordinal = ['','1st','2nd','3rd'][comp.rank]||`${comp.rank}th`;
            return (
              <div key={i} style={{
                display:'flex', alignItems:'center', gap:12, padding:'10px 0',
                borderBottom: i<arr.length-1?`1px solid ${T.surface3}`:'none',
              }}>
                <div style={{
                  width:36, height:36, borderRadius:8, flexShrink:0,
                  background: medal?T.primary+'22':T.surface2,
                  display:'flex', alignItems:'center', justifyContent:'center',
                  fontSize: medal?20:12, fontWeight:700,
                  color: medal?'unset':T.textSecondary,
                }}>
                  {medal||ordinal}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, color:T.textPrimary, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {comp.name}
                  </div>
                  <div style={{ fontSize:11, color:T.textTertiary, marginTop:2 }}>
                    {comp.date?.slice(0,7)} · {comp.field_size} fencers · {ordinal} place
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
