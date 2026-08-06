import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true, // send/receive the httpOnly refresh-token cookie
});

const STORAGE_KEY = 'access_token';
let accessToken = null;

export function setAccessToken(token) {
  accessToken = token;
  if (token) {
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    try {
      window.localStorage.setItem(STORAGE_KEY, token);
    } catch {
      /* storage unavailable */
    }
  } else {
    delete api.defaults.headers.common['Authorization'];
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable */
    }
  }
}

export function getAccessToken() {
  if (accessToken) return accessToken;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
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
      if (!isAuthEndpoint(url) && window.location.pathname !== '/login') {
        window.location.assign('/login');
      }
    }
    return Promise.reject(error);
  }
);

export default api;
