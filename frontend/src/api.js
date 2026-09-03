import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true, // send/receive the httpOnly refresh-token cookie
});

const TENANT_KEY = 'active_tenant_id';
let accessToken = null;
let tenantId = null;

/**
 * Sets the active workspace for all API calls. The value is sent as the
 * `X-Tenant` header so the backend scopes every request to that workspace
 * (it outranks the tenant baked into the access token at login).
 */
export function setTenantId(id) {
  tenantId = id;
  if (id) {
    api.defaults.headers.common['X-Tenant'] = String(id);
    try {
      window.localStorage.setItem(TENANT_KEY, String(id));
    } catch {
      /* storage unavailable */
    }
  } else {
    delete api.defaults.headers.common['X-Tenant'];
    try {
      window.localStorage.removeItem(TENANT_KEY);
    } catch {
      /* storage unavailable */
    }
  }
}

export function getTenantId() {
  if (tenantId) return tenantId;
  try {
    const stored = window.localStorage.getItem(TENANT_KEY);
    return stored ? Number(stored) : null;
  } catch {
    return null;
  }
}

// Restore the last-used workspace across reloads (a non-secret preference).
const restoredTenant = getTenantId();
if (restoredTenant) {
  api.defaults.headers.common['X-Tenant'] = String(restoredTenant);
}

// One-time sweep: pre-memory-only-session builds persisted the access token
// under this key. Remove any leftover so a stale credential can never be
// lifted from storage (the current token is never written here). Harmless
// when absent — surviving sessions restore through the refresh cookie.
try {
  window.localStorage.removeItem('access_token');
} catch {
  /* storage unavailable */
}

export function setAccessToken(token) {
  accessToken = token;
  if (token) {
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common['Authorization'];
  }
}

/**
 * The access token is held in MEMORY ONLY — it is never written to
 * localStorage — so a cross-site scripting hole or a malicious browser
 * extension cannot lift a live credential out of storage. Sessions survive
 * page reloads through the httpOnly refresh cookie instead: on boot
 * AuthContext probes GET /auth/me, and the 401 interceptor below rotates a
 * fresh access token whenever the cookie is still valid.
 */
export function getAccessToken() {
  return accessToken;
}

const isAuthEndpoint = (url = '') =>
  url.includes('/auth/login') ||
  url.includes('/auth/refresh') ||
  url.includes('/auth/2fa/verify-login');

// If a request fails with 401 and the request was not itself an auth call,
// try to refresh the session once (rotates the httpOnly refresh cookie), then
// retry the original request. If refresh fails, clear the session.
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { config, response } = error;
    const url = config?.url || '';
    // Authenticated intent = the request carried a Bearer token. Requests
    // WITHOUT one are the anonymous cookie bootstrap (GET /auth/me): when
    // that fails it simply means "no session", and guests (e.g. public
    // storefront visitors) must never be hard-redirected to /login.
    const hadSession = Boolean(config?.headers?.Authorization);

    if (response?.status === 401 && !isAuthEndpoint(url) && !config?._retry) {
      config._retry = true;
      try {
        const res = await api.post('/auth/refresh');
        const nextToken = res.data.accessToken;
        setAccessToken(nextToken);
        config.headers.Authorization = `Bearer ${nextToken}`;
        return api(config);
      } catch {
        // Fall through to the logout path below.
      }
    }

    if (response?.status === 401) {
      setAccessToken(null);
      if (hadSession && !isAuthEndpoint(url) && window.location.pathname !== '/login') {
        window.location.assign('/login');
      }
    }
    return Promise.reject(error);
  }
);

export default api;
