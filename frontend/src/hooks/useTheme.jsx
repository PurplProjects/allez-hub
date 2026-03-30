import { createContext, useContext, useState, useEffect } from 'react';
import { lightTheme, darkTheme } from '../lib/theme';

const ThemeContext = createContext({ theme: darkTheme, toggleTheme: () => {} });

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('allez-theme') === 'light' ? lightTheme : darkTheme;
    } catch { return darkTheme; }
  });

  function toggleTheme() {
    const next = theme.mode === 'dark' ? lightTheme : darkTheme;
    setTheme(next);
    try { localStorage.setItem('allez-theme', next.mode); } catch {}
  }

  // Apply bg colour to document so scrolling past cards looks right
  useEffect(() => {
    document.body.style.background = theme.black;
    document.body.style.color = theme.textPrimary;
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
