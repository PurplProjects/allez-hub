import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { theme } from '../../lib/theme';

export default function TopBar({ activeView, onViewChange }) {
  const { user, fencer, logout } = useAuth();
  const navigate = useNavigate();
  const isCoach  = user?.role === 'coach';

  const initials = user?.name
    ? user.name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()
    : '?';

  return (
    <div style={{
      background: theme.surface1,
      borderBottom: `1px solid ${theme.surface2}`,
      padding: '0 14px',
      height: 52,
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      flexShrink: 0,
      position: 'sticky',
      top: 0,
      zIndex: 100,
    }}>
      {/* Logo */}
      <div style={{
        width: 32, height: 32, background: theme.primary,
        borderRadius: 7, display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: 14, fontWeight: 500,
        color: 'white', flexShrink: 0, cursor: 'pointer',
      }} onClick={() => navigate(isCoach ? '/coach' : '/dashboard')}>
        {theme.clubShort}
      </div>

      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: theme.textPrimary }}>
          {theme.clubName}
        </div>
        <div style={{ fontSize: 10, color: theme.textTertiary }}>
          {isCoach ? 'Coach dashboard' : 'Performance Hub'}
        </div>
      </div>

      {/* View toggle — only show if coach */}
      {isCoach && (
        <div style={{ display:'flex', background:theme.surface2, borderRadius:6, padding:3, gap:2 }}>
          {[['coach','Squad'],['fencer','Fencer view']].map(([view, label]) => (
            <button
              key={view}
              onClick={() => onViewChange?.(view)}
              style={{
                padding: '5px 12px', fontSize: 12, fontWeight: 500,
                border: 'none', borderRadius: 5, cursor: 'pointer',
                background: activeView === view ? theme.primary : 'transparent',
                color: activeView === view ? 'white' : theme.textTertiary,
                transition: 'all .15s',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Avatar + logout */}
      <div style={{ position: 'relative' }}>
        <div
          style={{
            width: 30, height: 30, borderRadius: '50%',
            background: (fencer?.colour || theme.primary) + '22',
            border: `1.5px solid ${fencer?.colour || theme.primary}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 500,
            color: fencer?.colour || theme.primary,
            cursor: 'pointer', flexShrink: 0,
          }}
          title={`${user?.name} — click to sign out`}
          onClick={logout}
        >
          {initials}
        </div>
      </div>
    </div>
  );
}
