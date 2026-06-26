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

// ---------------------------------------------------------------------------
// Admin — Referrers
// ---------------------------------------------------------------------------
export function adminListReferrers() {
  return api.get('/api/admin/referrers').then((res) => res.data);
}

export function adminGetReferrer(id) {
  return api.get(`/api/admin/referrers/${id}`).then((res) => res.data);
}

export function adminCreateReferrer(data) {
  return api.post('/api/admin/referrers', data).then((res) => res.data);
}

export function adminUpdateReferrer(id, data) {
  return api.patch(`/api/admin/referrers/${id}`, data).then((res) => res.data);
}

export function adminDeleteReferrer(id) {
  return api.delete(`/api/admin/referrers/${id}`);
}

// ---------------------------------------------------------------------------
// Admin — Families
// ---------------------------------------------------------------------------
export function adminListFamilies() {
  return api.get('/api/admin/families').then((res) => res.data);
}

export function adminGetFamily(id) {
  return api.get(`/api/admin/families/${id}`).then((res) => res.data);
}

export function adminCreateFamily(data) {
  return api.post('/api/admin/families', data).then((res) => res.data);
}

export function adminUpdateFamily(id, data) {
  return api.patch(`/api/admin/families/${id}`, data).then((res) => res.data);
}

export function adminDeleteFamily(id) {
  return api.delete(`/api/admin/families/${id}`);
}

// ---------------------------------------------------------------------------
// Admin — People
// ---------------------------------------------------------------------------
export function adminListPeople() {
  return api.get('/api/admin/people').then((res) => res.data);
}

export function adminGetPerson(id) {
  return api.get(`/api/admin/people/${id}`).then((res) => res.data);
}

export function adminCreatePerson(data) {
  return api.post('/api/admin/people', data).then((res) => res.data);
}

export function adminUpdatePerson(id, data) {
  return api.patch(`/api/admin/people/${id}`, data).then((res) => res.data);
}

export function adminDeletePerson(id) {
  return api.delete(`/api/admin/people/${id}`);
}

export default api;
