/**
 * Axios instance configured for cookie-based auth.
 *
 * - `withCredentials: true` sends HttpOnly cookies with every request.
 * - On 401, attempts a silent refresh via POST /api/auth/refresh.
 * - If refresh succeeds, all pending 401 requests are retried.
 * - If refresh fails, the interceptor rejects — the caller (AuthContext)
 *   sets user=null and React Router navigates to /login (no hard redirect).
 */

import type { AxiosInstance, AxiosResponse, AxiosError, InternalAxiosRequestConfig } from 'axios';
import type {
  User,
  ReferrerListResponse,
  ReferrerDetail,
  FamilyListResponse,
  FamilyDetail,
  PersonListResponse,
  PersonSummary,
  PersonDetail,
} from '../types';

import axios from 'axios';

const api: AxiosInstance = axios.create({
  baseURL: '',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

// ---------------------------------------------------------------------------
// Token-refresh coordination (avoids thundering herd)
// ---------------------------------------------------------------------------
let refreshPromise: Promise<{ user: User }> | null = null;

async function refreshToken(): Promise<{ user: User }> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = api
    .post('/api/auth/refresh')
    .then((res) => res.data as { user: User })
    .finally(() => { refreshPromise = null; });

  return refreshPromise;
}

// Extend InternalAxiosRequestConfig to carry our _retry flag
interface ExtendedRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

// ---------------------------------------------------------------------------
// Response interceptor — retry on 401 after token refresh
// ---------------------------------------------------------------------------
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as ExtendedRequestConfig | undefined;

    // Only attempt refresh on 401, skip the refresh endpoint itself
    if (
      error.response?.status === 401 &&
      originalRequest &&
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
export function fetchCurrentUser(): Promise<User> {
  return api.get('/api/auth/me').then((res) => res.data);
}

/** Returns full AxiosResponse — caller destructures `{ data }`. */
export function loginRequest(email: string, password: string): Promise<AxiosResponse> {
  return api.post('/api/auth/login', { email, password });
}

export function logoutRequest(): Promise<void> {
  return api.post('/api/auth/logout').then(() => undefined);
}

/** Returns full AxiosResponse — caller destructures `{ data }`. */
export function registerRequest(data: Record<string, unknown>): Promise<AxiosResponse> {
  return api.post('/api/auth/register', data);
}

export function forgotPasswordRequest(email: string): Promise<unknown> {
  return api.post('/api/auth/forgot-password', { email }).then((res) => res.data);
}

export function resetPasswordRequest(token: string, new_password: string): Promise<unknown> {
  return api.post('/api/auth/reset-password', { token, new_password }).then((res) => res.data);
}

export function changePasswordRequest(old_password: string, new_password: string): Promise<unknown> {
  return api.put('/api/auth/me/password', { old_password, new_password }).then((res) => res.data);
}

// ---------------------------------------------------------------------------
// Admin — Referrers
// ---------------------------------------------------------------------------
export function adminListReferrers(): Promise<ReferrerListResponse> {
  return api.get('/api/admin/referrers').then((res) => res.data);
}

export function adminGetReferrer(id: number): Promise<ReferrerDetail> {
  return api.get(`/api/admin/referrers/${id}`).then((res) => res.data);
}

export function adminCreateReferrer(data: Record<string, unknown>): Promise<ReferrerDetail> {
  return api.post('/api/admin/referrers', data).then((res) => res.data);
}

export function adminUpdateReferrer(id: number, data: Record<string, unknown>): Promise<ReferrerDetail> {
  return api.patch(`/api/admin/referrers/${id}`, data).then((res) => res.data);
}

export function adminDeleteReferrer(id: number): Promise<void> {
  return api.delete(`/api/admin/referrers/${id}`).then(() => undefined);
}

// ---------------------------------------------------------------------------
// Admin — Families
// ---------------------------------------------------------------------------
export function adminListFamilies(): Promise<FamilyListResponse> {
  return api.get('/api/admin/families').then((res) => res.data);
}

export function adminGetFamily(id: number): Promise<FamilyDetail> {
  return api.get(`/api/admin/families/${id}`).then((res) => res.data);
}

export function adminCreateFamily(data: Record<string, unknown>): Promise<FamilyDetail> {
  return api.post('/api/admin/families', data).then((res) => res.data);
}

export function adminUpdateFamily(id: number, data: Record<string, unknown>): Promise<FamilyDetail> {
  return api.patch(`/api/admin/families/${id}`, data).then((res) => res.data);
}

export function adminDeleteFamily(id: number): Promise<void> {
  return api.delete(`/api/admin/families/${id}`).then(() => undefined);
}

// ---------------------------------------------------------------------------
// Admin — People
// ---------------------------------------------------------------------------
export function adminListPeople(): Promise<PersonListResponse> {
  return api.get('/api/admin/people').then((res) => res.data);
}

export function adminGetPerson(id: number): Promise<PersonDetail> {
  return api.get(`/api/admin/people/${id}`).then((res) => res.data);
}

export function adminCreatePerson(data: Record<string, unknown>): Promise<PersonDetail> {
  return api.post('/api/admin/people', data).then((res) => res.data);
}

export function adminUpdatePerson(id: number, data: Record<string, unknown>): Promise<PersonDetail> {
  return api.patch(`/api/admin/people/${id}`, data).then((res) => res.data);
}

export function adminDeletePerson(id: number): Promise<void> {
  return api.delete(`/api/admin/people/${id}`).then(() => undefined);
}

export function adminListFamilyPeople(fid: number): Promise<PersonSummary[]> {
  return api.get(`/api/admin/families/${fid}/people`).then((res) => res.data);
}

// ---------------------------------------------------------------------------
// Admin — CSV Import
// ---------------------------------------------------------------------------
export function adminGetCsvSample(): Promise<string> {
  return api.get('/api/admin/csv-sample').then((res) => res.data);
}

export function adminImportCsv(fileOrText: File | string): Promise<unknown> {
  // Accept a File object or a plain string
  if (fileOrText instanceof File) {
    return api.post('/api/admin/import-csv', fileOrText, {
      headers: { 'Content-Type': 'text/csv' },
    }).then((res) => res.data);
  }
  // plain string
  return api.post('/api/admin/import-csv', fileOrText, {
    headers: { 'Content-Type': 'text/csv' },
  }).then((res) => res.data);
}

// ---------------------------------------------------------------------------
// Referrer — Self
// ---------------------------------------------------------------------------
export function getReferrerMe(): Promise<ReferrerDetail> {
  return api.get('/api/referrer/me').then((res) => res.data);
}

export function patchReferrerMe(data: Record<string, unknown>): Promise<ReferrerDetail> {
  return api.patch('/api/referrer/me', data).then((res) => res.data);
}

// ---------------------------------------------------------------------------
// Referrer — Families
// ---------------------------------------------------------------------------
export function listReferrerFamilies(): Promise<FamilyDetail[]> {
  return api.get('/api/referrer/families').then((res) => res.data);
}

export function getReferrerFamily(id: number): Promise<FamilyDetail> {
  return api.get(`/api/referrer/families/${id}`).then((res) => res.data);
}

export function createReferrerFamily(data: Record<string, unknown>): Promise<FamilyDetail> {
  return api.post('/api/referrer/families', data).then((res) => res.data);
}

export function updateReferrerFamily(id: number, data: Record<string, unknown>): Promise<FamilyDetail> {
  return api.patch(`/api/referrer/families/${id}`, data).then((res) => res.data);
}

export function deleteReferrerFamily(id: number): Promise<void> {
  return api.delete(`/api/referrer/families/${id}`).then(() => undefined);
}

// ---------------------------------------------------------------------------
// Referrer — People within a family
// ---------------------------------------------------------------------------
export function listReferrerFamilyPeople(fid: number): Promise<PersonDetail[]> {
  return api.get(`/api/referrer/families/${fid}/people`).then((res) => res.data);
}

export function createReferrerFamilyPerson(fid: number, data: Record<string, unknown>): Promise<PersonDetail> {
  return api.post(`/api/referrer/families/${fid}/people`, data).then((res) => res.data);
}

// ---------------------------------------------------------------------------
// Family — Self
// ---------------------------------------------------------------------------
export function getFamilyMe(): Promise<FamilyDetail> {
  return api.get('/api/family/me').then((res) => res.data);
}

export function patchFamilyMe(data: Record<string, unknown>): Promise<FamilyDetail> {
  return api.patch('/api/family/me', data).then((res) => res.data);
}

// ---------------------------------------------------------------------------
// Family — People
// ---------------------------------------------------------------------------
export function listFamilyPeople(): Promise<PersonDetail[]> {
  return api.get('/api/family/people').then((res) => res.data);
}

export function createFamilyPerson(data: Record<string, unknown>): Promise<PersonDetail> {
  return api.post('/api/family/people', data).then((res) => res.data);
}

// ---------------------------------------------------------------------------
// Shared — Individual person (multi-role ownership)
// ---------------------------------------------------------------------------
export function getPerson(id: number): Promise<PersonDetail> {
  return api.get(`/api/people/${id}`).then((res) => res.data);
}

export function updatePerson(id: number, data: Record<string, unknown>): Promise<PersonDetail> {
  return api.patch(`/api/people/${id}`, data).then((res) => res.data);
}

export function deletePerson(id: number): Promise<void> {
  return api.delete(`/api/people/${id}`).then(() => undefined);
}

export default api;
