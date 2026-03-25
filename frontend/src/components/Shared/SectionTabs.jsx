import { theme } from '../../lib/theme';

export default function SectionTabs({ tabs, active, onChange }) {
  return (
    <div style={{
      background: theme.surface1,
      borderBottom: `1px solid ${theme.surface2}`,
      display: 'flex',
      overflowX: 'auto',
      flexShrink: 0,
      padding: '0 8px',
      scrollbarWidth: 'none',
    }}>
      {tabs.map(tab => (
        <div
          key={tab.id}
          onClick={() => onChange(tab.id)}
          style={{
            padding: '12px 14px',
            fontSize: 13,
            fontWeight: 500,
            color: active === tab.id ? theme.primary : theme.textTertiary,
            cursor: 'pointer',
            borderBottom: `2px solid ${active === tab.id ? theme.primary : 'transparent'}`,
            whiteSpace: 'nowrap',
            transition: 'all .15s',
          }}
        >
          {tab.label}
        </div>
      ))}
    </div>
  );
}
