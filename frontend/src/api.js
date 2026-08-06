import axios from 'axios';

/**
 * API client. The base URL comes from the environment:
 *  - dev:   Vite proxy forwards `/api` to the backend (no CORS pain)
 *  - prod:  same-origin `/api` via the nginx reverse proxy
 *  - custom: set VITE_API_URL in frontend/.env
 */
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
});

export function setAuthToken(token) {
  if (token) api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  else delete api.defaults.headers.common['Authorization'];
}

// If any request comes back 401 (expired/invalid token), clear the stored
// session and send the user to the login page.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      window.localStorage.removeItem('token');
      setAuthToken(null);
      if (window.location.pathname !== '/login') {
        window.location.assign('/login');
      }
    }
    return Promise.reject(error);
  }
);

export default api;
