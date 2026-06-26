/**
 * Axios instance configured for cookie-based auth.
 *
 * - `withCredentials: true` sends HttpOnly cookies with every request.
 * - On 401, attempts a silent refresh via POST /api/auth/refresh.
 * - If refresh succeeds, all pending 401 requests are retried.
 * - If refresh fails, the interceptor rejects — the caller (AuthContext)
 *   sets user=null and React Router navigates to /login (no hard redirect).
 */

import axios from 'axios';

const api = axios.create({
  baseURL: '',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

// ---------------------------------------------------------------------------
// Token-refresh coordination (avoids thundering herd)
// ---------------------------------------------------------------------------
let isRefreshing = false;
let refreshPromise = null;

async function refreshToken() {
  if (refreshPromise) return refreshPromise;

  refreshPromise = api
    .post('/api/auth/refresh')
    .then((res) => res.data.user)
    .finally(() => { refreshPromise = null; });

  return refreshPromise;
}

// ---------------------------------------------------------------------------
// Response interceptor — retry on 401 after token refresh
// ---------------------------------------------------------------------------
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Only attempt refresh on 401, skip the refresh endpoint itself
    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      originalRequest.url !== '/api/auth/refresh'
    ) {
      originalRequest._retry = true;

      try {
        await refreshToken();
        // Refresh succeeded — retry the original request
        return api(originalRequest);
      } catch {
        // Refresh failed — reject so caller handles it (e.g. redirect to /login)
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  },
);

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------
export function fetchCurrentUser() {
  return api.get('/api/auth/me').then((res) => res.data);
}

export function loginRequest(email, password) {
  return api.post('/api/auth/login', { email, password });
}

export function logoutRequest() {
  return api.post('/api/auth/logout');
}

export function registerRequest(data) {
  return api.post('/api/auth/register', data);
}

export function forgotPasswordRequest(email) {
  return api.post('/api/auth/forgot-password', { email });
}

export function resetPasswordRequest(token, new_password) {
  return api.post('/api/auth/reset-password', { token, new_password });
}

export function changePasswordRequest(old_password, new_password) {
  return api.put('/api/auth/me/password', { old_password, new_password });
}

export default api;
