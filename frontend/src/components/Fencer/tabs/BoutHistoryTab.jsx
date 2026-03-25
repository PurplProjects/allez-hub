import { useState, useMemo } from 'react';
import { theme } from '../../../lib/theme';

const T = theme;

export default function BoutHistoryTab({ bouts = [], competitions = [] }) {
  const [year,   setYear]   = useState('all');
  const [compId, setCompId] = useState('all');
  const [type,   setType]   = useState('all');
  const [result, setResult] = useState('all');
  const [search, setSearch] = useState('');
  const [sort,   setSort]   = useState({ col:'date', dir:-1 });

  // Dynamic competition list filtered by year
  const compOptions = useMemo(() => {
    return competitions
      .filter(c => year === 'all' || c.date?.startsWith(year))
      .sort((a,b) => b.date?.localeCompare(a.date || '') || 0);
  }, [competitions, year]);

  // Filter bouts
  const filtered = useMemo(() => {
    let data = bouts.filter(b => {
      if (search && !b.opponent?.toLowerCase().includes(search.toLowerCase())) return false;
      if (year   !== 'all' && !b.date?.startsWith(year))          return false;
      if (compId !== 'all' && b.competition_id !== compId)         return false;
      if (type   !== 'all' && b.bout_type !== type)                return false;
      if (result !== 'all' && b.result !== result)                 return false;
      return true;
    });

    data.sort((a,b) => {
      let va = a[sort.col], vb = b[sort.col];
      if (typeof va === 'string') return va.localeCompare(vb || '') * sort.dir;
      return ((va||0) - (vb||0)) * sort.dir;
    });

    return data;
  }, [bouts, year, compId, type, result, search, sort]);

  // Summary stats from filtered set
  const summary = useMemo(() => {
    const won   = filtered.filter(b => b.result === 'Won').length;
    const total = filtered.length;
    const avgF  = total ? (filtered.reduce((s,b) => s+(b.score_for||0), 0)/total).toFixed(1) : '—';
    const net   = total ? ((filtered.reduce((s,b) => s+(b.score_for||0)-(b.score_against||0),0)/total)).toFixed(1) : '—';
    return { total, won, winPct: total ? Math.round(won/total*100) : 0, avgF, net };
  }, [filtered]);

  const years = [...new Set(bouts.map(b => b.date?.slice(0,4)).filter(Boolean))].sort().reverse();
  const fmtDate = d => { if (!d) return '—'; const [y,m,dy] = d.split('-'); return `${dy}/${m}/${y.slice(2)}`; };

  function toggleSort(col) {
    setSort(s => s.col === col ? { col, dir: s.dir * -1 } : { col, dir: -1 });
  }

  const selStyle = { width:'100%', padding:'8px 10px', background:T.surface2, border:`0.5px solid ${T.surface3}`, borderRadius:T.borderRadiusSm, color:T.textPrimary, fontSize:12, outline:'none' };
  const chip = (active) => ({ padding:'5px 11px', background:active?T.primary:T.surface2, border:`0.5px solid ${active?T.primary:T.surface3}`, borderRadius:20, fontSize:11, color:active?'white':T.textSecondary, cursor:'pointer', whiteSpace:'nowrap' });
  const th = (col) => ({ fontSize:10, fontWeight:500, color:sort.col===col?T.primary:T.textTertiary, textTransform:'uppercase', letterSpacing:'.04em', cursor:'pointer', userSelect:'none', padding:'8px 10px' });

  return (
    <div style={{ padding:14, display:'flex', flexDirection:'column', gap:10 }}>

      {/* Filter panel */}
      <div style={{ background:T.surface1, border:`0.5px solid ${T.surface2}`, borderRadius:T.borderRadius, padding:'12px 14px', display:'flex', flexDirection:'column', gap:10 }}>

        {/* Year + Competition */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
          <div>
            <div style={{ fontSize:10, fontWeight:500, color:T.textTertiary, textTransform:'uppercase', letterSpacing:'.05em', marginBottom:5 }}>Year</div>
            <select style={selStyle} value={year} onChange={e => { setYear(e.target.value); setCompId('all'); }}>
              <option value="all">All years</option>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize:10, fontWeight:500, color:T.textTertiary, textTransform:'uppercase', letterSpacing:'.05em', marginBottom:5 }}>Competition</div>
            <select style={selStyle} value={compId} onChange={e => setCompId(e.target.value)}>
              <option value="all">All competitions</option>
              {compOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>

        {/* Result + Type chips */}
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
            <span style={{ fontSize:10, color:T.textTertiary, width:40 }}>Result</span>
            {[['all','All'],['Won','Won'],['Lost','Lost']].map(([v,l]) => (
              <div key={v} style={chip(result===v)} onClick={() => setResult(v)}>{l}</div>
            ))}
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
            <span style={{ fontSize:10, color:T.textTertiary, width:40 }}>Type</span>
            {[['all','All bouts'],['Poule','Poule only'],['DE','DE only']].map(([v,l]) => (
              <div key={v} style={chip(type===v)} onClick={() => setType(v)}>{l}</div>
            ))}
          </div>
        </div>

        {/* Search + clear */}
        <div style={{ display:'flex', gap:8 }}>
          <div style={{ flex:1, position:'relative' }}>
            <span style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:T.textTertiary, fontSize:12 }}>⌕</span>
            <input
              style={{ ...selStyle, paddingLeft:26 }}
              placeholder="Search opponent…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <button onClick={() => { setYear('all'); setCompId('all'); setType('all'); setResult('all'); setSearch(''); }}
            style={{ padding:'8px 12px', background:'transparent', border:`0.5px solid ${T.surface3}`, borderRadius:T.borderRadiusSm, color:T.textTertiary, fontSize:12, cursor:'pointer' }}>
            Clear
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,minmax(0,1fr))', gap:8 }}>
        {[
          { val:summary.total,         lbl:'Bouts',        sub:`${summary.won}W · ${summary.total-summary.won}L`, col:T.textPrimary },
          { val:summary.winPct+'%',    lbl:'Win rate',     sub:`${summary.won} wins`, col:summary.winPct>=55?T.success:summary.winPct>=40?T.warning:T.danger },
          { val:summary.avgF,          lbl:'Avg scored',   sub:'per bout', col:T.primary },
          { val:(parseFloat(summary.net)>0?'+':'')+summary.net, lbl:'Net/bout', sub:'scored minus conceded', col:parseFloat(summary.net)>=0?T.success:T.danger },
        ].map(m => (
          <div key={m.lbl} style={{ background:T.surface1, border:`0.5px solid ${T.surface2}`, borderRadius:6, padding:10, textAlign:'center' }}>
            <div style={{ fontSize:18, fontWeight:500, color:m.col }}>{m.val}</div>
            <div style={{ fontSize:10, color:T.textTertiary, marginTop:2 }}>{m.lbl}</div>
            <div style={{ fontSize:9, color:T.textTertiary }}>{m.sub}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div style={{ background:T.surface1, border:`0.5px solid ${T.surface2}`, borderRadius:T.borderRadius, overflow:'hidden' }}>
        {/* Header */}
        <div style={{ display:'grid', gridTemplateColumns:'72px 1fr 54px 56px 50px 50px', background:T.surface2, borderBottom:`0.5px solid ${T.surface3}` }}>
          {[['date','Date'],['opponent','Opponent'],['score_for','Score'],['result','Result'],['bout_type','Type'],['margin','Margin']].map(([col,lbl]) => (
            <div key={col} style={th(col)} onClick={() => toggleSort(col)}>
              {lbl}{sort.col===col ? (sort.dir===-1?' ↓':' ↑') : ''}
            </div>
          ))}
        </div>

        {/* Rows */}
        <div style={{ maxHeight:400, overflowY:'auto' }}>
          {filtered.length === 0 ? (
            <div style={{ padding:32, textAlign:'center', color:T.textTertiary, fontSize:13 }}>No bouts match your filters</div>
          ) : filtered.map((b, i) => {
            const margin = (b.score_for||0) - (b.score_against||0);
            const mc = margin > 0 ? T.success : margin < 0 ? T.danger : T.textTertiary;
            const compName = b.competitions?.name || '';
            return (
              <div key={b.id || i} style={{ display:'grid', gridTemplateColumns:'72px 1fr 54px 56px 50px 50px', padding:'9px 10px', borderBottom:`0.5px solid ${T.surface2}`, transition:'background .1s' }}
                onMouseEnter={e => e.currentTarget.style.background = T.surface2}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <div style={{ fontSize:11, color:T.textTertiary, display:'flex', alignItems:'center' }}>{fmtDate(b.date)}</div>
                <div style={{ display:'flex', flexDirection:'column', justifyContent:'center', overflow:'hidden' }}>
                  <div style={{ fontSize:13, color:T.textPrimary, fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{b.opponent}</div>
                  <div style={{ fontSize:10, color:T.textTertiary, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{compName}</div>
                </div>
                <div style={{ fontSize:12, fontWeight:500, color:b.result==='Won'?T.success:T.danger, display:'flex', alignItems:'center' }}>{b.score_for}–{b.score_against}</div>
                <div style={{ display:'flex', alignItems:'center' }}>
                  <span style={{ fontSize:10, padding:'2px 7px', borderRadius:10, fontWeight:500, background:b.result==='Won'?'#052e16':'#450a0a', color:b.result==='Won'?'#86efac':'#fca5a5' }}>
                    {b.result}
                  </span>
                </div>
                <div style={{ display:'flex', alignItems:'center' }}>
                  <span style={{ fontSize:9, padding:'2px 6px', borderRadius:4, background:b.bout_type==='Poule'?'#1e3a5f':'#431407', color:b.bout_type==='Poule'?'#93c5fd':'#fdba74' }}>
                    {b.bout_type}
                  </span>
                </div>
                <div style={{ fontSize:12, fontWeight:500, color:mc, display:'flex', alignItems:'center' }}>
                  {margin > 0 ? `+${margin}` : margin}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ fontSize:11, color:T.textTertiary }}>
        Showing {filtered.length} of {bouts.length} bouts
      </div>
    </div>
  );
}
