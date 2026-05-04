import { useMemo } from 'react';
import { useTheme } from '../../hooks/useTheme';

// ── Classification ───────────────────────────────────────────
function classifyBout(scoreFor, scoreAgainst, boutType) {
  const margin = Math.abs(scoreFor - scoreAgainst);
  const won    = scoreFor > scoreAgainst;
  const isDE   = boutType?.startsWith('DE');

  if (isDE) {
    if (won) {
      if (margin >= 7) return 'bigWin';
      if (margin >= 4) return 'win';
      if (margin >= 2) return 'narrowWin';
      return 'tightWin';
    } else {
      if (margin >= 7) return 'bigLoss';
      if (margin >= 4) return 'loss';
      if (margin >= 2) return 'narrowLoss';
      return 'tightLoss';
    }
  } else {
    if (won) {
      if (margin >= 4) return 'bigWin';
      if (margin >= 2) return 'win';
      return 'closeWin';
    } else {
      if (margin >= 4) return 'bigLoss';
      if (margin >= 2) return 'loss';
      return 'closeLoss';
    }
  }
}

const POOL_CATS = ['bigWin','win','closeWin','closeLoss','loss','bigLoss'];
const DE_CATS   = ['bigWin','win','narrowWin','tightWin','tightLoss','narrowLoss','loss','bigLoss'];

const POOL_COLORS = {
  bigWin:   '#15803d', win:      '#4ade80', closeWin:  '#bbf7d0',
  closeLoss:'#fecaca', loss:     '#f87171', bigLoss:   '#b91c1c',
};
const DE_COLORS = {
  bigWin:    '#1d4ed8', win:      '#60a5fa', narrowWin: '#bfdbfe', tightWin:  '#fef08a',
  tightLoss: '#fecaca', narrowLoss:'#f87171', loss:      '#ef4444', bigLoss:   '#991b1b',
};

const POOL_LABELS = { bigWin:'Big W (4–5pt)', win:'Win (2–3pt)', closeWin:'Close W (1pt)', closeLoss:'Close L (1pt)', loss:'Loss (2–3pt)', bigLoss:'Big L (4–5pt)' };
const DE_LABELS   = { bigWin:'Big W (7+pt)', win:'Win (4–6pt)', narrowWin:'Narrow W (2–3pt)', tightWin:'Tight W (1pt)', tightLoss:'Tight L (1pt)', narrowLoss:'Narrow L (2–3pt)', loss:'Loss (4–6pt)', bigLoss:'Big L (7+pt)' };

const LIGHT_TEXT_CATS = new Set(['closeWin','closeLoss','tightWin','tightLoss','narrowWin','narrowLoss']);

function empty(isDE) {
  return isDE
    ? { bigWin:0, win:0, narrowWin:0, tightWin:0, tightLoss:0, narrowLoss:0, loss:0, bigLoss:0 }
    : { bigWin:0, win:0, closeWin:0, closeLoss:0, loss:0, bigLoss:0 };
}

function countWins(d, isDE) {
  return isDE
    ? d.bigWin + d.win + d.narrowWin + d.tightWin
    : d.bigWin + d.win + d.closeWin;
}

function countAll(d) { return Object.values(d).reduce((s, v) => s + v, 0); }

function pct(v, t) { return t ? Math.round(v / t * 100) : 0; }

// ── Stacked bar ───────────────────────────────────────────────
function StackedBar({ data, isDE, height = 20 }) {
  const cats   = isDE ? DE_CATS   : POOL_CATS;
  const colors = isDE ? DE_COLORS : POOL_COLORS;
  const total  = countAll(data);
  if (!total) return (
    <div style={{ height, background: '#F3F4F6', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ fontSize: 10, color: '#9CA3AF' }}>No data</span>
    </div>
  );
  return (
    <div style={{ height, display: 'flex', borderRadius: 4, overflow: 'hidden' }}>
      {cats.map(cat => {
        const v = data[cat] || 0;
        if (!v) return null;
        const p = pct(v, total);
        const textCol = LIGHT_TEXT_CATS.has(cat) ? '#374151' : 'white';
        return (
          <div key={cat} title={`${POOL_LABELS[cat] || DE_LABELS[cat]}: ${v}`}
            style={{ width: `${p}%`, background: colors[cat], display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 500, color: textCol, overflow: 'hidden', flexShrink: 0 }}>
            {p > 8 ? `${p}%` : ''}
          </div>
        );
      })}
    </div>
  );
}

// ── Legend ────────────────────────────────────────────────────
function Legend({ isDE }) {
  const items = isDE
    ? [['#1d4ed8','Big W (7+)'],['#60a5fa','Win (4–6)'],['#bfdbfe','Narrow (2–3)'],['#fef08a','Tight (1)'],['#fecaca','Tight L'],['#f87171','Narrow L'],['#ef4444','Loss'],['#991b1b','Big L']]
    : [['#15803d','Big W (4–5)'],['#4ade80','Win (2–3)'],['#bbf7d0','Close W (1)'],['#fecaca','Close L (1)'],['#f87171','Loss (2–3)'],['#b91c1c','Big L (4–5)']];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', marginBottom: 10 }}>
      {items.map(([col, lbl]) => (
        <div key={lbl} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#6B7280' }}>
          <div style={{ width: 8, height: 8, borderRadius: 2, background: col, flexShrink: 0 }}/>
          {lbl}
        </div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────
export default function BoutBreakdown({ bouts = [] }) {
  const { theme: T } = useTheme();

  // Group bouts by year
  const byYear = useMemo(() => {
    const years = {};
    bouts.forEach(b => {
      if (b.score_for == null || b.score_against == null) return;
      const year = b.date?.slice(0, 4) || 'Unknown';
      if (!years[year]) years[year] = { pool: empty(false), de: empty(true) };
      const cat   = classifyBout(b.score_for, b.score_against, b.bout_type);
      const isDE  = b.bout_type?.startsWith('DE');
      if (isDE) years[year].de[cat]   = (years[year].de[cat]   || 0) + 1;
      else      years[year].pool[cat] = (years[year].pool[cat] || 0) + 1;
    });
    return years;
  }, [bouts]);

  // Overall totals
  const overall = useMemo(() => {
    const pool = empty(false), de = empty(true);
    Object.values(byYear).forEach(y => {
      Object.keys(pool).forEach(k => pool[k] += y.pool[k] || 0);
      Object.keys(de).forEach(k => de[k]     += y.de[k]   || 0);
    });
    return { pool, de };
  }, [byYear]);

  const years = Object.keys(byYear).filter(y => y !== 'Unknown').sort();

  if (!bouts.length) return null;

  const card  = { background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 12, padding: 16, marginBottom: 12 };
  const panel = { background: '#F9FAFB', borderRadius: 8, padding: 12 };
  const lbl   = { fontSize: 10, color: '#9CA3AF', marginBottom: 5 };

  // Table row helper
  function TableRow({ label, isYear, poolData, deData, isLast }) {
    const pTotal = countAll(poolData);
    const dTotal = countAll(deData);
    const pWins  = countWins(poolData, false);
    const dWins  = countWins(deData,   true);
    const rowBg  = isLast ? '#F3F4F6' : 'transparent';
    const fw     = isLast ? 500 : 400;
    const tdStyle = { padding: '7px 8px', fontSize: 12, borderBottom: isLast ? 'none' : '1px solid #F3F4F6', background: rowBg, fontWeight: fw };

    return (
      <>
        <tr>
          <td style={{ ...tdStyle, color: '#111827', verticalAlign: 'middle' }} rowSpan={2}>{label}</td>
          <td style={{ ...tdStyle, color: '#15803d' }}>
            <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 8, background: '#f0fdf4', color: '#15803d', fontWeight: 500 }}>Poule</span>
          </td>
          <td style={{ ...tdStyle, color: '#15803d', fontWeight: 500 }}>{poolData.bigWin}</td>
          <td style={{ ...tdStyle, color: '#4ade80' }}>{poolData.win}</td>
          <td style={{ ...tdStyle, color: '#86efac' }}>{poolData.closeWin}</td>
          <td style={{ ...tdStyle, color: '#f87171' }}>{poolData.closeLoss}</td>
          <td style={{ ...tdStyle, color: '#ef4444' }}>{poolData.loss}</td>
          <td style={{ ...tdStyle, color: '#b91c1c' }}>{poolData.bigLoss}</td>
          <td style={{ ...tdStyle, color: '#6B7280' }}>{pTotal}</td>
          <td style={tdStyle}>
            <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 8, background: '#f0fdf4', color: '#15803d', fontWeight: 500 }}>{pct(pWins, pTotal)}%</span>
          </td>
        </tr>
        <tr>
          <td style={{ ...tdStyle, borderBottom: isLast ? 'none' : '1px solid #E5E7EB' }}>
            <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 8, background: '#eff6ff', color: '#1d4ed8', fontWeight: 500 }}>DE</span>
          </td>
          <td style={{ ...tdStyle, color: '#1d4ed8', fontWeight: 500, borderBottom: isLast ? 'none' : '1px solid #E5E7EB' }}>{deData.bigWin}</td>
          <td style={{ ...tdStyle, color: '#3b82f6', borderBottom: isLast ? 'none' : '1px solid #E5E7EB' }}>{deData.win}</td>
          <td style={{ ...tdStyle, color: '#93c5fd', borderBottom: isLast ? 'none' : '1px solid #E5E7EB' }}>{deData.narrowWin + deData.tightWin}</td>
          <td style={{ ...tdStyle, color: '#fca5a5', borderBottom: isLast ? 'none' : '1px solid #E5E7EB' }}>{deData.tightLoss}</td>
          <td style={{ ...tdStyle, color: '#ef4444', borderBottom: isLast ? 'none' : '1px solid #E5E7EB' }}>{deData.narrowLoss + deData.loss}</td>
          <td style={{ ...tdStyle, color: '#991b1b', borderBottom: isLast ? 'none' : '1px solid #E5E7EB' }}>{deData.bigLoss}</td>
          <td style={{ ...tdStyle, color: '#6B7280', borderBottom: isLast ? 'none' : '1px solid #E5E7EB' }}>{dTotal}</td>
          <td style={{ ...tdStyle, borderBottom: isLast ? 'none' : '1px solid #E5E7EB' }}>
            <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 8, background: '#eff6ff', color: '#1d4ed8', fontWeight: 500 }}>{pct(dWins, dTotal)}%</span>
          </td>
        </tr>
      </>
    );
  }

  return (
    <div style={card}>
      <div style={{ fontSize: 11, fontWeight: 500, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 14 }}>
        Bout breakdown
      </div>

      {/* Stacked bars */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        {/* Pool panel */}
        <div style={panel}>
          <div style={{ fontSize: 13, fontWeight: 500, color: '#111827', marginBottom: 8 }}>Poule bouts</div>
          <Legend isDE={false} />
          {years.map(yr => (
            <div key={yr}>
              <div style={lbl}>{yr}</div>
              <div style={{ marginBottom: 6 }}>
                <StackedBar data={byYear[yr].pool} isDE={false} />
              </div>
            </div>
          ))}
          <div style={{ borderTop: '1px solid #E5E7EB', paddingTop: 8, marginTop: 4 }}>
            <div style={lbl}>Overall</div>
            <StackedBar data={overall.pool} isDE={false} height={26} />
          </div>
        </div>

        {/* DE panel */}
        <div style={panel}>
          <div style={{ fontSize: 13, fontWeight: 500, color: '#111827', marginBottom: 8 }}>DE bouts</div>
          <Legend isDE={true} />
          {years.map(yr => (
            <div key={yr}>
              <div style={lbl}>{yr}</div>
              <div style={{ marginBottom: 6 }}>
                <StackedBar data={byYear[yr].de} isDE={true} />
              </div>
            </div>
          ))}
          <div style={{ borderTop: '1px solid #E5E7EB', paddingTop: 8, marginTop: 4 }}>
            <div style={lbl}>Overall</div>
            <StackedBar data={overall.de} isDE={true} height={26} />
          </div>
        </div>
      </div>

      {/* Year-by-year table */}
      <div style={{ fontSize: 11, fontWeight: 500, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>
        Year-by-year detail
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #E5E7EB' }}>
              {['Year','Type','Big W','W','Close W','Close L','Loss','Big L','Total','Win%'].map(h => (
                <th key={h} style={{ padding: '7px 8px', textAlign: 'left', fontSize: 10, fontWeight: 500, color: '#9CA3AF', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {years.map((yr, i) => (
              <TableRow key={yr} label={yr} poolData={byYear[yr].pool} deData={byYear[yr].de} isLast={false} />
            ))}
            <TableRow label="Overall" poolData={overall.pool} deData={overall.de} isLast={true} />
          </tbody>
        </table>
      </div>
    </div>
  );
}
