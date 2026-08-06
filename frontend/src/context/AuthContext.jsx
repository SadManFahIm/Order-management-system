import { createContext, useContext, useEffect, useState } from 'react';
import api, { setAuthToken } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState(
    () => window.localStorage.getItem('token') || null
  );

  // Validate the stored token against the server on first load, so stale or
  // forged tokens are discarded instead of granting access.
  useEffect(() => {
    let active = true;

    if (!token) {
      setUser(null);
      setAuthToken(null);
      setLoading(false);
      return undefined;
    }

    setAuthToken(token);
    api
      .get('/auth/me')
      .then((res) => {
        if (active) {
          setUser(res.data.user);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setUser(null);
          setToken(null);
          window.localStorage.removeItem('token');
          setAuthToken(null);
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [token]);

  const login = async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    setUser(res.data.user);
    setToken(res.data.token);
    window.localStorage.setItem('token', res.data.token);
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    window.localStorage.removeItem('token');
    setAuthToken(null);
  };

  const value = { user, token, loading, login, logout };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
