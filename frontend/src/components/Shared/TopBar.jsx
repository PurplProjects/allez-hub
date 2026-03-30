import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../hooks/useTheme';
import { clubInfo } from '../../lib/theme';

export default function TopBar({ activeView, onViewChange }) {
  const { user, fencer, logout } = useAuth();
  const { theme: T, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const isCoach  = user?.role === 'coach';

  const initials = user?.name
    ? user.name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()
    : '?';

  return (
    <div style={{
      background:    T.surface1,
      borderBottom:  `1px solid ${T.surface3}`,
      padding:       '0 14px',
      height:        52,
      display:       'flex',
      alignItems:    'center',
      gap:           12,
      flexShrink:    0,
      position:      'sticky',
      top:           0,
      zIndex:        100,
      boxShadow:     T.mode === 'light' ? '0 1px 4px rgba(0,0,0,0.06)' : 'none',
    }}>

      {/* Logo */}
      <div style={{
        width: 32, height: 32, background: T.primary,
        borderRadius: 7, display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: 14, fontWeight: 600,
        color: 'white', flexShrink: 0, cursor: 'pointer',
      }} onClick={() => navigate(isCoach ? '/coach' : '/dashboard')}>
        {clubInfo.clubShort}
      </div>

      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: T.textPrimary }}>
          {clubInfo.clubName}
        </div>
        <div style={{ fontSize: 10, color: T.textTertiary }}>
          {isCoach ? 'Coach dashboard' : 'Performance Hub'}
        </div>
      </div>

      {/* Coach squad/fencer toggle */}
      {isCoach && (
        <div style={{ display:'flex', background: T.surface2, borderRadius: 6, padding: 3, gap: 2 }}>
          {[['coach','🏅 Squad'],['fencer','🤺 Fencer']].map(([view, label]) => (
            <button key={view} onClick={() => onViewChange?.(view)} style={{
              padding: '5px 11px', fontSize: 12, fontWeight: 500,
              border: 'none', borderRadius: 5, cursor: 'pointer',
              background: activeView === view ? T.primary : 'transparent',
              color:      activeView === view ? 'white'   : T.textTertiary,
              transition: 'all .15s',
            }}>
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Light/dark toggle */}
      <button onClick={toggleTheme} style={{
        width: 32, height: 32, borderRadius: 7,
        background: T.surface2, border: `1px solid ${T.surface3}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', fontSize: 15, flexShrink: 0,
        transition: 'background .2s',
      }} title={`Switch to ${T.mode === 'dark' ? 'light' : 'dark'} mode`}>
        {T.mode === 'dark' ? '☀️' : '🌙'}
      </button>

      {/* Avatar + logout */}
      <div
        style={{
          width: 30, height: 30, borderRadius: '50%',
          background: (fencer?.colour || T.primary) + '22',
          border: `1.5px solid ${fencer?.colour || T.primary}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 500,
          color: fencer?.colour || T.primary,
          cursor: 'pointer', flexShrink: 0,
        }}
        title={`${user?.name} — click to sign out`}
        onClick={logout}
      >
        {initials}
      </div>
    </div>
  );
}
