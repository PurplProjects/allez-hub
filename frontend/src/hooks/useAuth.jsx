import { createContext, useContext, useState, useEffect } from 'react';
import { getMe } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,   setUser]   = useState(null);
  const [fencer, setFencer] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('allez_token');
    if (!token) { setLoading(false); return; }

    getMe()
      .then(data => { setUser(data.user); })
      .catch(() => { localStorage.removeItem('allez_token'); })
      .finally(() => setLoading(false));
  }, []);

  function login(token, userData, fencerData) {
    localStorage.setItem('allez_token', token);
    setUser(userData);
    setFencer(fencerData);
  }

  function logout() {
    localStorage.removeItem('allez_token');
    setUser(null);
    setFencer(null);
  }

  return (
    <AuthContext.Provider value={{ user, fencer, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
