import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import LoginPage       from './components/Auth/LoginPage';
import FencerDashboard from './components/Fencer/FencerDashboard';
import CoachDashboard  from './components/Coach/CoachDashboard';

function ProtectedRoute({ children, requireCoach = false }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user)   return <Navigate to="/login" replace />;
  if (requireCoach && user.role !== 'coach') return <Navigate to="/dashboard" replace />;
  return children;
}

function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === 'coach' ? '/coach' : '/dashboard'} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/"          element={<RootRedirect />} />
          <Route path="/login"     element={<LoginPage />} />
          <Route path="/dashboard" element={
            <ProtectedRoute><FencerDashboard /></ProtectedRoute>
          } />
          <Route path="/coach" element={
            <ProtectedRoute requireCoach><CoachDashboard /></ProtectedRoute>
          } />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
