import { createContext, useContext, useEffect, useState } from 'react';
import api, { setAccessToken, getAccessToken } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => getAccessToken());
  const [loading, setLoading] = useState(true);
  const [twoFactorPending, setTwoFactorPending] = useState(null);

  // Validate the stored access token against the server on first load.
  useEffect(() => {
    let active = true;
    const stored = getAccessToken();
    if (!stored) {
      setLoading(false);
      return undefined;
    }
    setAccessToken(stored);
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
          // The interceptor will have tried a refresh already; clear the session.
          setUser(null);
          setToken(null);
          setAccessToken(null);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const applySession = (session) => {
    setAccessToken(session.accessToken);
    setToken(session.accessToken);
    setUser(session.user);
    setTwoFactorPending(null);
  };

  const login = async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    if (res.data.requiresTwoFactor) {
      setTwoFactorPending({ token: res.data.twoFactorToken, email });
      return { requiresTwoFactor: true };
    }
    applySession(res.data);
    return { requiresTwoFactor: false };
  };

  const verifyTwoFactor = async (code) => {
    if (!twoFactorPending) throw new Error('No pending two-factor login');
    const res = await api.post('/auth/2fa/verify-login', {
      twoFactorToken: twoFactorPending.token,
      code,
    });
    applySession(res.data);
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // Session may already be gone — clear locally regardless.
    }
    setUser(null);
    setToken(null);
    setAccessToken(null);
    setTwoFactorPending(null);
  };

  const value = {
    user,
    token,
    loading,
    twoFactorPending,
    login,
    verifyTwoFactor,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
