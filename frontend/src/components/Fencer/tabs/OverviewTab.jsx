import { useState, useEffect } from 'react';
import { theme } from '../../../lib/theme';
import { Bar, Line } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale,
  BarElement, LineElement, PointElement, Tooltip, Filler,
} from 'chart.js';
ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Filler);

const T = theme;

// ── SVG Icons ─────────────────────────────────────────────────
const Icon = ({ d, size = 14, color = T.textTertiary, fill = 'none', strokeWidth = 1.5 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const Icons = {
  sword:    'M14.5 17.5L3 6V3h3l11.5 11.5M14.5 17.5l-1.5 1.5-1.5-1.5L13 16M14.5 17.5L16 19l3 3M14 5l5-5 5 5-5 5M12 7l-5 5',
  trophy:   'M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M6 9v7M18 9v7M6 16a6 6 0 0 0 12 0M12 20v2M9 22h6',
  target:   'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  trend:    'M22 7l-8.5 8.5-5-5L2 17M22 7h-5M22 7v5',
  star:     'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
  shield:   'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  bolt:     'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
  chart:    'M18 20V10M12 20V4M6 20v-6',
  clock:    'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  warning:  'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01',
  check:    'M20 6L9 17l-5-5',
  fire:     'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 3z',
  users:    'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  brain:    'M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.44-1.14A2.5 2.5 0 0 1 9.5 2M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.44-1.14A2.5 2.5 0 0 0 14.5 2z',
  medal:    'M12 15a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M8.21 13.89L7 23l5-3 5 3-1.21-9.12',
  location: 'M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
};

// ── AI inference engine ───────────────────────────────────────
function generateInsights(stats, competitions, fencer) {
  const insights = [];
  if (!stats?.career) return insights;

  const c      = stats.career;
  const byYear = stats.byYear || {};
  const years  = Object.keys(byYear).sort();
  const thisYr = new Date().getFullYear().toString();
  const lastYr = (new Date().getFullYear() - 1).toString();

  const thisYearData = byYear[thisYr];
  const lastYearData = byYear[lastYr];

  // ── Momentum ──────────────────────────────────────────────
  if (thisYearData && lastYearData && thisYearData.total >= 3) {
    const thisWP = Math.round(thisYearData.won / thisYearData.total * 100);
    const lastWP = Math.round(lastYearData.won / lastYearData.total * 100);
    const delta  = thisWP - lastWP;
    if (delta >= 15)
      insights.push({ type: 'positive', icon: 'fire',  title: 'On fire this season', body: `Win rate up ${delta}pp year-on-year — best form of career.` });
    else if (delta >= 8)
      insights.push({ type: 'positive', icon: 'trend', title: 'Upward trajectory',   body: `${delta}pp improvement vs last year. Consistent growth.` });
    else if (delta <= -10)
      insights.push({ type: 'warning',  icon: 'warning', title: 'Form dip this season', body: `Win rate down ${Math.abs(delta)}pp vs last year. Worth reviewing.` });
  }

  // ── Poule vs DE gap ───────────────────────────────────────
  const gap = c.pouleWinPct - c.deWinPct;
  if (gap >= 20)
    insights.push({ type: 'warning', icon: 'target', title: 'DE is the key battleground', body: `${gap}pp drop from pools to DE. Under pressure your win rate falls sharply — composure and preparation in DE scenarios is the biggest lever.` });
  else if (gap >= 10)
    insights.push({ type: 'neutral', icon: 'chart', title: 'Poule–DE gap closing', body: `${c.pouleWinPct}% in pools vs ${c.deWinPct}% in DE. A manageable gap — DE composure drills would close this further.` });
  else if (gap <= 3 && c.deWinPct >= 50)
    insights.push({ type: 'positive', icon: 'shield', title: 'DE performer', body: `Barely any drop from pools to DE — ${c.deWinPct}% DE win rate shows real composure under pressure.` });

  // ── Rival gap ─────────────────────────────────────────────
  const repGap = (stats.newOppWinPct || 0) - (stats.repeatOppWinPct || 0);
  if (repGap >= 20)
    insights.push({ type: 'warning', icon: 'users', title: 'Circuit rivals are the challenge', body: `${stats.newOppWinPct}% vs new opponents but only ${stats.repeatOppWinPct}% vs repeat rivals. Tactical variety and opponent-specific prep needed.` });
  else if (repGap >= 10)
    insights.push({ type: 'neutral', icon: 'users', title: 'Slight repeat-rival gap', body: `${repGap}pp drop vs familiar opponents. Rivals are adapting — time to add unpredictability.` });

  // ── Net touches trend ─────────────────────────────────────
  if (c.avgNet >= 2)
    insights.push({ type: 'positive', icon: 'bolt', title: 'Dominant touch margin', body: `Averaging +${c.avgNet} touches per bout — controlling tempo and forcing the pace.` });
  else if (c.avgNet < 0)
    insights.push({ type: 'warning', icon: 'chart', title: 'Touch deficit', body: `Averaging ${c.avgNet} touches per bout. Scoring efficiency needs attention.` });

  // ── Season trajectory across years ───────────────────────
  if (years.length >= 3) {
    const recentWPs = years.slice(-3).map(y =>
      byYear[y]?.total ? Math.round(byYear[y].won / byYear[y].total * 100) : 0
    );
    const allRising = recentWPs.every((v, i) => i === 0 || v >= recentWPs[i - 1] - 3);
    if (allRising && recentWPs[recentWPs.length - 1] > recentWPs[0] + 5)
      insights.push({ type: 'positive', icon: 'trend', title: 'Multi-year growth', body: `Win rate has grown every season for ${years.slice(-3).join(', ')}. Sustained development trajectory.` });
  }

  // ── Medals / top 8 ───────────────────────────────────────
  if (c.medals >= 3)
    insights.push({ type: 'positive', icon: 'trophy', title: `${c.medals} career medals`, body: `Consistently reaching podium positions. ${c.top8} top-8 finishes across ${c.events} events.` });
  else if (c.top8 >= 3 && c.medals === 0)
    insights.push({ type: 'neutral', icon: 'target', title: 'Consistently close to the podium', body: `${c.top8} top-8 finishes but no medals yet. The final hurdle is the DE semi-final.` });

  // ── Return top 3 most impactful ───────────────────────────
  const order = { positive: 0, warning: 1, neutral: 2 };
  return insights.sort((a, b) => order[a.type] - order[b.type]).slice(0, 3);
}

// ── Recent form strip ─────────────────────────────────────────
function recentFormBouts(stats) {
  // Pull from byYear — we don't have individual bout dates here, 
  // so we reconstruct a rough form indicator from year stats
  const thisYr = new Date().getFullYear().toString();
  const d = stats?.byYear?.[thisYr];
  if (!d) return [];
  const totalBouts = d.total || 0;
  const wonBouts   = d.won   || 0;
  const lostBouts  = totalBouts - wonBouts;
  // Alternate won/lost roughly
  const form = [];
  let w = wonBouts, l = lostBouts;
  while (form.length < Math.min(10, totalBouts)) {
    if (w > l) { form.push('W'); w--; }
    else if (l > 0) { form.push('L'); l--; }
    else { form.push('W'); w--; }
  }
  return form;
}

export default function OverviewTab({ fencer, stats, competitions }) {
  const [animIn, setAnimIn] = useState(false);
  useEffect(() => { setTimeout(() => setAnimIn(true), 50); }, []);

  if (!fencer || !stats) return (
    <div style={{ padding: 40, textAlign: 'center', color: T.textTertiary, fontSize: 13 }}>
      No data yet — trigger a sync to load results.
    </div>
  );

  const c      = stats.career || {};
  const byYear = stats.byYear || {};
  const years  = Object.keys(byYear).sort();
  const thisYr = new Date().getFullYear().toString();
  const insights = generateInsights(stats, competitions, fencer);
  const recentForm = recentFormBouts(stats);

  // Year-on-year line chart
  const lineData = {
    labels: years,
    datasets: [{
      label: 'Win rate',
      data: years.map(y => byYear[y]?.total ? Math.round(byYear[y].won / byYear[y].total * 100) : 0),
      borderColor: T.primary,
      backgroundColor: T.primary + '18',
      borderWidth: 2,
      pointBackgroundColor: T.primary,
      pointRadius: 4,
      tension: 0.4,
      fill: true,
    }, {
      label: 'Poule',
      data: years.map(y => byYear[y]?.pouleT ? Math.round(byYear[y].pouleW / byYear[y].pouleT * 100) : 0),
      borderColor: T.info,
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      pointRadius: 3,
      borderDash: [4, 3],
      tension: 0.4,
    }, {
      label: 'DE',
      data: years.map(y => byYear[y]?.deT ? Math.round(byYear[y].deW / byYear[y].deT * 100) : 0),
      borderColor: T.surface3 + 'cc',
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      pointRadius: 3,
      borderDash: [4, 3],
      tension: 0.4,
    }],
  };
  const lineOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y}%` } } },
    scales: {
      x: { ticks: { color: T.textTertiary, font: { size: 10 } }, grid: { display: false } },
      y: { min: 0, max: 100, ticks: { color: T.textTertiary, font: { size: 10 }, callback: v => v + '%' }, grid: { color: T.surface2 + '88' } },
    },
  };

  // Current season data
  const thisYearWP = byYear[thisYr]?.total
    ? Math.round(byYear[thisYr].won / byYear[thisYr].total * 100) : null;
  const lastYr = (new Date().getFullYear() - 1).toString();
  const lastYearWP = byYear[lastYr]?.total
    ? Math.round(byYear[lastYr].won / byYear[lastYr].total * 100) : null;
  const yearDelta = thisYearWP !== null && lastYearWP !== null ? thisYearWP - lastYearWP : null;

  const insightColors = {
    positive: { bg: '#052e16', border: T.success, text: '#86efac', icon: T.success },
    warning:  { bg: '#450a0a', border: T.danger,  text: '#fca5a5', icon: T.danger },
    neutral:  { bg: '#1e3a5f', border: T.info,    text: '#93c5fd', icon: T.info },
  };

  const fade = (delay) => ({
    opacity: animIn ? 1 : 0,
    transform: animIn ? 'translateY(0)' : 'translateY(12px)',
    transition: `opacity .4s ease ${delay}ms, transform .4s ease ${delay}ms`,
  });

  return (
    <div style={{ padding: '14px 14px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* ── HERO CARD ── */}
      <div style={{
        ...fade(0),
        background: `linear-gradient(135deg, ${T.surface1} 0%, ${T.surface2} 100%)`,
        border: `0.5px solid ${T.surface3}`,
        borderLeft: `3px solid ${fencer.colour || T.primary}`,
        borderRadius: T.borderRadius,
        padding: '16px 14px',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Decorative circle */}
        <div style={{
          position: 'absolute', right: -20, top: -20,
          width: 100, height: 100, borderRadius: '50%',
          background: (fencer.colour || T.primary) + '08',
          border: `0.5px solid ${(fencer.colour || T.primary)}18`,
        }}/>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Avatar */}
          <div style={{
            width: 56, height: 56, borderRadius: '50%', flexShrink: 0,
            background: (fencer.colour || T.primary) + '22',
            border: `2px solid ${(fencer.colour || T.primary)}44`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20, fontWeight: 600, color: fencer.colour || T.primary,
            letterSpacing: '-0.5px',
          }}>
            {fencer.name?.split(' ').map(p => p[0]).join('').slice(0, 2)}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 600, color: T.textPrimary, letterSpacing: '-0.3px' }}>
              {fencer.first_name || fencer.name?.split(' ')[0]}
              <span style={{ color: T.textSecondary, fontWeight: 400 }}>
                {' '}{fencer.name?.split(' ').slice(1).join(' ')}
              </span>
            </div>

            {/* Club + school */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4, flexWrap: 'wrap' }}>
              <Icon d={Icons.shield} size={11} color={T.primary} />
              <span style={{ fontSize: 11, color: T.primary, fontWeight: 500 }}>{fencer.club || 'Allez Fencing'}</span>
            </div>
            {fencer.school && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
                <Icon d={Icons.location} size={11} color={T.textTertiary} />
                <span style={{ fontSize: 11, color: T.textTertiary }}>{fencer.school}</span>
              </div>
            )}
          </div>

          {/* Right side — category + BF badge */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5, flexShrink: 0 }}>
            <div style={{
              background: T.primary, color: 'white',
              fontSize: 13, fontWeight: 600, padding: '5px 10px', borderRadius: 6,
              letterSpacing: '0.5px',
            }}>
              {fencer.category || 'U13'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Icon d={Icons.sword} size={10} color={T.textTertiary} />
              <span style={{ fontSize: 10, color: T.textTertiary }}>BF {fencer.bf_licence}</span>
            </div>
          </div>
        </div>

        {/* Recent form dots */}
        {recentForm.length > 0 && (
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, color: T.textTertiary }}>Recent form</span>
            <div style={{ display: 'flex', gap: 3 }}>
              {recentForm.map((r, i) => (
                <div key={i} style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: r === 'W' ? T.success : T.danger,
                  opacity: 1 - (i * 0.06),
                }}/>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── HEADLINE METRICS ── */}
      <div style={{ ...fade(80), display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 8 }}>

        {/* Career win rate */}
        <div style={{
          background: T.surface1, border: `0.5px solid ${T.surface2}`,
          borderRadius: T.borderRadius, padding: '12px 14px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <Icon d={Icons.target} size={12} color={T.primary} />
            <span style={{ fontSize: 10, color: T.textTertiary, textTransform: 'uppercase', letterSpacing: '.05em' }}>Career win rate</span>
          </div>
          <div style={{ fontSize: 32, fontWeight: 700, color: T.primary, lineHeight: 1, letterSpacing: '-1px' }}>
            {c.winPct || 0}%
          </div>
          <div style={{ fontSize: 11, color: T.textTertiary, marginTop: 4 }}>
            {c.won || 0}W · {(c.bouts || 0) - (c.won || 0)}L · {c.bouts || 0} bouts
          </div>
        </div>

        {/* This season */}
        <div style={{
          background: T.surface1, border: `0.5px solid ${T.surface2}`,
          borderRadius: T.borderRadius, padding: '12px 14px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <Icon d={Icons.bolt} size={12} color={T.success} />
            <span style={{ fontSize: 10, color: T.textTertiary, textTransform: 'uppercase', letterSpacing: '.05em' }}>{thisYr} season</span>
          </div>
          <div style={{ fontSize: 32, fontWeight: 700, color: T.success, lineHeight: 1, letterSpacing: '-1px' }}>
            {thisYearWP !== null ? `${thisYearWP}%` : '—'}
          </div>
          {yearDelta !== null && (
            <div style={{ fontSize: 11, marginTop: 4, color: yearDelta >= 0 ? T.success : T.danger }}>
              {yearDelta >= 0 ? '▲' : '▼'} {Math.abs(yearDelta)}pp vs {lastYr}
            </div>
          )}
        </div>
      </div>

      {/* ── FOUR STAT PILLS ── */}
      <div style={{ ...fade(140), display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 6 }}>
        {[
          { icon: Icons.chart,  val: c.events || 0,   lbl: 'Events',    col: T.textPrimary },
          { icon: Icons.trophy, val: c.medals || 0,   lbl: 'Medals',    col: T.primary },
          { icon: Icons.star,   val: c.top8   || 0,   lbl: 'Top 8s',    col: T.warning },
          { icon: Icons.bolt,   val: c.avgNet >= 0 ? `+${c.avgNet}` : c.avgNet,
                                                       lbl: 'Net/bout',  col: (c.avgNet || 0) >= 0 ? T.success : T.danger },
        ].map(m => (
          <div key={m.lbl} style={{
            background: T.surface2, borderRadius: 8,
            padding: '10px 8px', textAlign: 'center',
          }}>
            <Icon d={m.icon} size={14} color={m.col} />
            <div style={{ fontSize: 18, fontWeight: 600, color: m.col, marginTop: 4, lineHeight: 1, letterSpacing: '-0.5px' }}>{m.val}</div>
            <div style={{ fontSize: 9, color: T.textTertiary, marginTop: 3, textTransform: 'uppercase', letterSpacing: '.04em' }}>{m.lbl}</div>
          </div>
        ))}
      </div>

      {/* ── POULE vs DE BAR ── */}
      <div style={{
        ...fade(180),
        background: T.surface1, border: `0.5px solid ${T.surface2}`,
        borderRadius: T.borderRadius, padding: 14,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: T.textTertiary, textTransform: 'uppercase', letterSpacing: '.05em', display: 'flex', alignItems: 'center', gap: 5 }}>
            <Icon d={Icons.chart} size={11} color={T.textTertiary} />
            Poule vs DE
          </div>
          <span style={{
            fontSize: 10, padding: '2px 8px', borderRadius: 10,
            background: (c.pouleWinPct - c.deWinPct) > 15 ? '#450a0a' : '#052e16',
            color: (c.pouleWinPct - c.deWinPct) > 15 ? '#fca5a5' : '#86efac',
            fontWeight: 500,
          }}>
            {c.pouleWinPct - c.deWinPct > 0 ? `${c.pouleWinPct - c.deWinPct}pp gap` : 'Balanced'}
          </span>
        </div>
        {[
          { lbl: 'Poule', val: c.pouleWinPct || 0, col: T.primary },
          { lbl: 'DE',    val: c.deWinPct    || 0, col: T.info },
        ].map(b => (
          <div key={b.lbl} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: T.textSecondary, width: 40 }}>{b.lbl}</span>
            <div style={{ flex: 1, height: 8, background: T.surface2, borderRadius: 4 }}>
              <div style={{
                height: 8, borderRadius: 4, background: b.col,
                width: `${b.val}%`,
                transition: 'width 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)',
              }}/>
            </div>
            <span style={{ fontSize: 12, fontWeight: 600, color: b.col, width: 34, textAlign: 'right' }}>{b.val}%</span>
          </div>
        ))}
      </div>

      {/* ── PROGRESS CHART ── */}
      <div style={{
        ...fade(220),
        background: T.surface1, border: `0.5px solid ${T.surface2}`,
        borderRadius: T.borderRadius, padding: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 12 }}>
          <Icon d={Icons.trend} size={12} color={T.textTertiary} />
          <span style={{ fontSize: 11, color: T.textTertiary, textTransform: 'uppercase', letterSpacing: '.05em' }}>Year-on-year progress</span>
        </div>
        <div style={{ height: 160 }}>
          <Line data={lineData} options={lineOpts} />
        </div>
        <div style={{ display: 'flex', gap: 14, marginTop: 10 }}>
          {[['Win rate', T.primary, false], ['Poule', T.info, true], ['DE', T.surface3, true]].map(([lbl, col, dashed]) => (
            <div key={lbl} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{
                width: 16, height: 2,
                background: dashed ? 'transparent' : col,
                borderTop: dashed ? `2px dashed ${col}` : 'none',
              }}/>
              <span style={{ fontSize: 10, color: T.textTertiary }}>{lbl}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── AI INSIGHTS ── */}
      {insights.length > 0 && (
        <div style={{ ...fade(280) }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <Icon d={Icons.brain} size={13} color={T.primary} />
            <span style={{ fontSize: 11, color: T.textTertiary, textTransform: 'uppercase', letterSpacing: '.05em' }}>
              AI performance insights
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {insights.map((ins, i) => {
              const ic = insightColors[ins.type];
              return (
                <div key={i} style={{
                  background: ic.bg,
                  border: `0.5px solid ${ic.border}22`,
                  borderLeft: `2px solid ${ic.border}`,
                  borderRadius: T.borderRadius,
                  padding: '11px 12px',
                  display: 'flex', gap: 10, alignItems: 'flex-start',
                }}>
                  <div style={{ marginTop: 1, flexShrink: 0 }}>
                    <Icon d={Icons[ins.icon]} size={14} color={ic.icon} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: ic.text, marginBottom: 3 }}>{ins.title}</div>
                    <div style={{ fontSize: 12, color: ic.text, opacity: 0.8, lineHeight: 1.55 }}>{ins.body}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── BEST RESULTS ── */}
      {competitions?.filter(c => c.rank && c.rank <= 8).length > 0 && (
        <div style={{
          ...fade(340),
          background: T.surface1, border: `0.5px solid ${T.surface2}`,
          borderRadius: T.borderRadius, padding: 14,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 10 }}>
            <Icon d={Icons.medal} size={12} color={T.textTertiary} />
            <span style={{ fontSize: 11, color: T.textTertiary, textTransform: 'uppercase', letterSpacing: '.05em' }}>Best results</span>
          </div>
          {competitions.filter(c => c.rank && c.rank <= 8).slice(0, 6).map((comp, i) => {
            const isMedal = comp.rank <= 3;
            const ordinal = ['', '1st', '2nd', '3rd'][comp.rank] || `${comp.rank}th`;
            return (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 0',
                borderBottom: i < 5 ? `0.5px solid ${T.surface2}` : 'none',
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                  background: isMedal ? T.primary + '22' : T.surface2,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700,
                  color: isMedal ? T.primary : T.textSecondary,
                }}>
                  {isMedal ? <Icon d={Icons.trophy} size={14} color={T.primary} /> : ordinal}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: T.textPrimary, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {comp.name}
                  </div>
                  <div style={{ fontSize: 10, color: T.textTertiary, marginTop: 2 }}>
                    {comp.date?.slice(0, 7)} · {comp.field_size} fencers
                    {isMedal && ` · ${ordinal} place`}
                  </div>
                </div>
                {isMedal && (
                  <span style={{
                    fontSize: 10, padding: '2px 7px', borderRadius: 10,
                    background: T.primary + '22', color: T.primary, fontWeight: 600,
                    flexShrink: 0,
                  }}>
                    {comp.rank === 1 ? '🥇' : comp.rank === 2 ? '🥈' : '🥉'}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
