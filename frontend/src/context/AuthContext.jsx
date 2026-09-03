import { createContext, useContext, useEffect, useState } from 'react';
import api, { setAccessToken, getAccessToken, setTenantId, getTenantId } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [twoFactorPending, setTwoFactorPending] = useState(null);
  const [tenants, setTenants] = useState([]);
  const [activeTenantId, setActiveTenantId] = useState(() => getTenantId());

  // Establish the session on first load. The access token is intentionally
  // memory-only (never localStorage), so every reload starts with no token
  // and this probe decides the outcome through the 401 interceptor:
  //   - valid refresh cookie  → the interceptor rotates an access token and
  //     retries GET /auth/me → the session is restored silently.
  //   - no cookie / revoked   → the probe fails quietly and the app renders
  //     logged-out (anonymous storefront visitors are never redirected).
  useEffect(() => {
    let active = true;
    api
      .get('/auth/me')
      .then((res) => {
        if (!active) return;
        setUser(res.data.user);
        // The interceptor already attached the rotated access token.
        setToken(getAccessToken());
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setUser(null);
        setToken(null);
        setAccessToken(null);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Load the user's workspace memberships once the session is known.
  useEffect(() => {
    if (!user) return undefined;
    let active = true;
    api
      .get('/auth/tenants')
      .then((res) => {
        if (!active) return;
        const list = Array.isArray(res.data) ? res.data : [];
        setTenants(list);
        // Ensure the active workspace is one the user can actually access.
        if (!list.some((t) => Number(t.id) === Number(activeTenantId))) {
          const first = list[0];
          if (first) {
            setActiveTenantId(first.id);
            setTenantId(first.id);
          } else {
            setTenantId(null);
          }
        } else {
          setTenantId(activeTenantId);
        }
      })
      .catch(() => {
        /* non-fatal: pages will surface tenant errors */
      });
    return () => {
      active = false;
    };
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const switchTenant = (id) => {
    setTenantId(id);
    setActiveTenantId(id);
    // Scoped data is fetched on page mount — refresh so the new workspace's
    // data loads immediately.
    window.location.reload();
  };

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
    return {
      requiresTwoFactor: false,
      // Admin-forced reset: route to the change-password flow first.
      mustChangePassword: Boolean(res.data.mustChangePassword),
    };
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
    setTenants([]);
    setActiveTenantId(null);
    setTenantId(null);
  };

  const value = {
    user,
    token,
    loading,
    twoFactorPending,
    tenants,
    activeTenantId,
    switchTenant,
    login,
    verifyTwoFactor,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
