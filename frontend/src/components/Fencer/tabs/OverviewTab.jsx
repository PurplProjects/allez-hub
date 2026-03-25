import { theme } from '../../../lib/theme';
import { Bar } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip } from 'chart.js';
ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

const pad  = { padding: 14 };
const card = { background: theme.surface1, border: `0.5px solid ${theme.surface2}`, borderRadius: theme.borderRadius, ...pad, marginBottom: 10 };
const cardTitle = { fontSize: 11, fontWeight: 500, color: theme.textTertiary, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 };

export default function OverviewTab({ fencer, stats, competitions }) {
  if (!fencer || !stats) return null;

  const c = stats.career || {};
  const years = Object.keys(stats.byYear || {}).sort();

  // Chart data
  const chartData = {
    labels: years,
    datasets: [
      { label: 'Overall', data: years.map(y => Math.round(stats.byYear[y].won / stats.byYear[y].total * 100)), backgroundColor: theme.primary },
      { label: 'Poule',   data: years.map(y => Math.round(stats.byYear[y].pouleW / (stats.byYear[y].pouleT||1) * 100)), backgroundColor: theme.surface3 },
      { label: 'DE',      data: years.map(y => Math.round(stats.byYear[y].deW / (stats.byYear[y].deT||1) * 100)), backgroundColor: '#555' },
    ],
  };
  const chartOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y}%` } } },
    scales: {
      x: { ticks: { color: theme.textTertiary }, grid: { display: false } },
      y: { min: 0, max: 100, ticks: { color: theme.textTertiary, callback: v => v + '%' }, grid: { color: theme.surface2 } },
    },
  };

  return (
    <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Hero strip */}
      <div style={{ ...card, borderLeft: `3px solid ${fencer.colour || theme.primary}`, display: 'flex', alignItems: 'center', gap: 14, marginBottom: 0 }}>
        <div style={{ width: 52, height: 52, borderRadius: '50%', background: (fencer.colour||theme.primary)+'22', color: fencer.colour||theme.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 500, flexShrink: 0 }}>
          {fencer.name?.split(' ').map(p=>p[0]).join('').slice(0,2)}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 500, color: theme.textPrimary }}>{fencer.name}</div>
          <div style={{ fontSize: 12, color: theme.textTertiary, marginTop: 2 }}>{fencer.club} · {fencer.category} · BF {fencer.bf_licence}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ background: theme.primary, color: 'white', fontSize: 13, fontWeight: 500, padding: '4px 10px', borderRadius: 6 }}>U26</div>
          <div style={{ fontSize: 10, color: theme.textTertiary, marginTop: 3 }}>BF Rating</div>
        </div>
      </div>

      {/* Metric row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8 }}>
        {[
          { val: c.events,  lbl: 'Tournaments', sub: 'total career' },
          { val: c.winPct + '%', lbl: 'Career win rate', sub: `${c.bouts} bouts`, col: theme.primary },
          { val: (stats.byYear?.[new Date().getFullYear()]?.won / (stats.byYear?.[new Date().getFullYear()]?.total||1) * 100 || 0).toFixed(0) + '%', lbl: `${new Date().getFullYear()} win rate`, sub: 'current season', col: theme.success },
        ].map(m => (
          <div key={m.lbl} style={{ background: theme.surface2, borderRadius: 6, padding: '10px 12px' }}>
            <div style={{ fontSize: 22, fontWeight: 500, color: m.col || theme.textPrimary }}>{m.val}</div>
            <div style={{ fontSize: 10, color: theme.textTertiary, marginTop: 2 }}>{m.lbl}</div>
            <div style={{ fontSize: 10, color: theme.textTertiary }}>{m.sub}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 8 }}>
        {[
          { val: c.medals, lbl: 'Medals', col: theme.primary },
          { val: (c.avgNet > 0 ? '+' : '') + c.avgNet, lbl: 'Net touches/bout', col: c.avgNet >= 0 ? theme.success : theme.danger },
        ].map(m => (
          <div key={m.lbl} style={{ background: theme.surface2, borderRadius: 6, padding: '10px 12px' }}>
            <div style={{ fontSize: 22, fontWeight: 500, color: m.col }}>{m.val}</div>
            <div style={{ fontSize: 10, color: theme.textTertiary, marginTop: 2 }}>{m.lbl}</div>
          </div>
        ))}
      </div>

      {/* Year chart */}
      <div style={card}>
        <div style={cardTitle}>Year-on-year progress</div>
        <div style={{ height: 180 }}>
          <Bar data={chartData} options={chartOpts} />
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          {[['Overall', theme.primary],['Poule', theme.surface3],['DE','#555']].map(([lbl,col]) => (
            <span key={lbl} style={{ display:'flex', alignItems:'center', gap:4, fontSize:10, color:theme.textTertiary }}>
              <span style={{ width:8, height:8, background:col, borderRadius:2, display:'inline-block' }}/>
              {lbl}
            </span>
          ))}
        </div>
      </div>

      {/* Best results */}
      <div style={card}>
        <div style={cardTitle}>Best results</div>
        {(competitions || []).filter(c => c.rank && c.rank <= 10).slice(0, 6).map((comp, i) => {
          const pct = comp.field_size ? Math.round((comp.field_size - comp.rank) / comp.field_size * 100) : null;
          return (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 0', borderBottom:`0.5px solid ${theme.surface2}` }}>
              <div style={{ fontSize:14, fontWeight:500, color:comp.rank<=3?theme.primary:theme.textPrimary, width:28 }}>{comp.rank}{comp.rank===1?'st':comp.rank===2?'nd':comp.rank===3?'rd':'th'}</div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:12, color:theme.textPrimary }}>{comp.name}</div>
                <div style={{ fontSize:10, color:theme.textTertiary }}>{comp.date?.slice(0,7)} · {comp.field_size} fencers</div>
              </div>
              {comp.rank <= 3 && <span style={{ background:theme.primary+'22', color:theme.primary, fontSize:10, padding:'2px 6px', borderRadius:10, fontWeight:500 }}>Medal</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
