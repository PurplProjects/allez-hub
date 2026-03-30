import { useTheme } from '../../hooks/useTheme';

export default function SectionTabs({ tabs, active, onChange }) {
  const { theme: T } = useTheme();
  return (
    <div style={{
      background:    T.surface1,
      borderBottom:  `1px solid ${T.surface3}`,
      display:       'flex',
      overflowX:     'auto',
      flexShrink:    0,
      padding:       '0 8px',
      scrollbarWidth:'none',
      boxShadow:     T.mode === 'light' ? '0 1px 3px rgba(0,0,0,0.04)' : 'none',
    }}>
      {tabs.map(tab => (
        <div key={tab.id} onClick={() => onChange(tab.id)} style={{
          padding:      '12px 14px',
          fontSize:     13,
          fontWeight:   active === tab.id ? 600 : 500,
          color:        active === tab.id ? T.primary : T.textTertiary,
          cursor:       'pointer',
          borderBottom: `2px solid ${active === tab.id ? T.primary : 'transparent'}`,
          whiteSpace:   'nowrap',
          transition:   'all .15s',
        }}>
          {tab.label}
        </div>
      ))}
    </div>
  );
}
