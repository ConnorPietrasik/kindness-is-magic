/**
 * Axios instance configured for cookie-based auth.
 *
 * - `withCredentials: true` sends HttpOnly cookies with every request.
 * - On 401, attempts a silent refresh via POST /api/auth/refresh.
 * - If refresh succeeds, all pending 401 requests are retried.
 * - If refresh fails, the interceptor rejects — the caller (AuthContext)
 *   sets user=null and React Router navigates to /login (no hard redirect).
 */

import type { AxiosError, AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from "axios";
import axios from "axios";
import type {
  AdminUserCreate,
  AdminUsersListParams,
  AdminUserUpdate,
  FamilyDetail,
  FamilyListResponse,
  FamilyPayload,
  FamilySelfRegisterPayload,
  FamilySelfRegisterResponse,
  FamilyWishListResponse,
  InviteListResponse,
  PaginationParams,
  PendingFamilySummary,
  PersonDetail,
  PersonListResponse,
  PersonPayload,
  ReferrerDetail,
  ReferrerFamilyInviteResponse,
  ReferrerInviteCreatePayload,
  ReferrerInviteResponse,
  ReferrerInviteSummary,
  ReferrerListResponse,
  ReferrerPayload,
  ReferrerSelfRegisterPayload,
  ReferrerSelfRegisterResponse,
  User,
  UserDetail,
  UserListResponse,
  UserPasswordReset,
} from "../types";
import { normalizePayload } from "./utils";

const api: AxiosInstance = axios.create({
  baseURL: "",
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

// ---------------------------------------------------------------------------
// Token-refresh coordination (avoids thundering herd)
// ---------------------------------------------------------------------------
let refreshPromise: Promise<{ user: User }> | null = null;

async function refreshToken(): Promise<{ user: User }> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = api
    .post("/api/auth/refresh")
    .then((res) => res.data as { user: User })
    .finally(() => {
      refreshPromise = null;
    });

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
    if (error.response?.status === 401 && originalRequest && !originalRequest._retry && originalRequest.url !== "/api/auth/refresh") {
      originalRequest._retry = true;

      try {
        await refreshToken();
        // Refresh succeeded — retry the original request
        return api(originalRequest);
      } catch {
        // Refresh failed — clear auth state and notify listeners
        setAuthQueryData(null);
        window.dispatchEvent(FAILED_REFRESH_EVENT);
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  }
);

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/**
 * Set the auth query data. Called by the 401 interceptor when refresh fails
 * so AuthContext can clear its cached user and navigate to /login.
 *
 * AuthProvider registers the actual implementation via a ref. Until then,
 * this is a no-op (page load before AuthProvider mounts is unlikely in SPA).
 */
let _setAuthQueryData: ((data: null) => void) | null = null;
export function setAuthQueryData(data: null): void {
  _setAuthQueryData?.(data);
}
export function _registerSetAuthQueryData(fn: (data: null) => void): void {
  _setAuthQueryData = fn;
}

/**
 * Dispatched when the refresh-token flow fails (both access + refresh expired).
 * AuthContext listens for this to clear user and navigate to /login.
 */
const FAILED_REFRESH_EVENT = new CustomEvent("onFailedRefresh");

export function fetchCurrentUser(): Promise<User | null> {
  return api
    .get("/api/auth/me")
    .then((res) => res.data as User)
    .catch((err) => {
      if (err?.response?.status === 401) return null;
      throw err;
    });
}

/** Returns full AxiosResponse — caller destructures `{ data }`. */
export function loginRequest(email: string, password: string): Promise<AxiosResponse> {
  return api.post("/api/auth/login", { email, password });
}

export function logoutRequest(): Promise<void> {
  return api.post("/api/auth/logout").then(() => undefined);
}

export function forgotPasswordRequest(email: string): Promise<unknown> {
  return api.post("/api/auth/forgot-password", { email }).then((res) => res.data);
}

export function resetPasswordRequest(token: string, new_password: string): Promise<unknown> {
  return api.post("/api/auth/reset-password", { token, new_password }).then((res) => res.data);
}

export function changePasswordRequest(old_password: string, new_password: string): Promise<unknown> {
  return api.put("/api/auth/me/password", { old_password, new_password }).then((res) => res.data);
}

/** Update the current user's display name. Send `""` to clear it. */
export function updateMyProfile(displayName: string): Promise<User> {
  return api.patch("/api/auth/me", { display_name: displayName }).then((res) => res.data);
}

// ---------------------------------------------------------------------------
// Auth — Referrer Invite
// ---------------------------------------------------------------------------

/** Admin creates an invite token for a referrer to self-register. */
export function createReferrerInvite(data: ReferrerInviteCreatePayload): Promise<ReferrerInviteResponse> {
  return api.post("/api/auth/invite-referrer", data).then((res) => res.data);
}

/** Public: redeem an invite code to register as a referrer (auto-logs in). */
export function registerReferrerViaInvite(data: ReferrerSelfRegisterPayload): Promise<ReferrerSelfRegisterResponse> {
  return api.post("/api/auth/register-referrer", data).then((res) => res.data);
}

/** Public: redeem an invite code to register as a family (auto-logs in). */
export function registerFamilyViaInvite(data: FamilySelfRegisterPayload): Promise<FamilySelfRegisterResponse> {
  return api.post("/api/auth/register-family", data).then((res) => res.data);
}

// ---------------------------------------------------------------------------
// Admin — Referrers
// ---------------------------------------------------------------------------
export function adminListReferrers(params?: PaginationParams): Promise<ReferrerListResponse> {
  if (params) return api.get("/api/admin/referrers", { params }).then((res) => res.data);
  return api.get("/api/admin/referrers").then((res) => res.data);
}

export function adminGetReferrer(id: number): Promise<ReferrerDetail> {
  return api.get(`/api/admin/referrers/${id}`).then((res) => res.data);
}

export function adminCreateReferrer(data: ReferrerPayload): Promise<ReferrerDetail> {
  return api.post("/api/admin/referrers", normalizePayload(data)).then((res) => res.data);
}

export function adminUpdateReferrer(id: number, data: ReferrerPayload): Promise<ReferrerDetail> {
  return api.patch(`/api/admin/referrers/${id}`, data).then((res) => res.data);
}

export function adminDeleteReferrer(id: number): Promise<void> {
  return api.delete(`/api/admin/referrers/${id}`).then(() => undefined);
}

export function adminRestoreReferrer(id: number): Promise<ReferrerDetail> {
  return api.post(`/api/admin/referrers/${id}/restore`).then((res) => res.data);
}

export function adminApproveReferrer(id: number): Promise<ReferrerDetail> {
  return api.post(`/api/admin/referrers/${id}/approve`).then((res) => res.data);
}

export function adminRejectReferrer(id: number): Promise<ReferrerDetail> {
  return api.post(`/api/admin/referrers/${id}/reject`).then((res) => res.data);
}

/** Fetch soft-deleted referrers (separate /deleted endpoint). */
export function adminListDeletedReferrers(params?: PaginationParams): Promise<ReferrerListResponse> {
  if (params) return api.get("/api/admin/referrers/deleted", { params }).then((res) => res.data);
  return api.get("/api/admin/referrers/deleted").then((res) => res.data);
}

// ---------------------------------------------------------------------------
// Admin — Families
// ---------------------------------------------------------------------------
export function adminListFamilies(params?: PaginationParams): Promise<FamilyListResponse> {
  if (params) return api.get("/api/admin/families", { params }).then((res) => res.data);
  return api.get("/api/admin/families").then((res) => res.data);
}

export function adminGetFamily(id: number): Promise<FamilyDetail> {
  return api.get(`/api/admin/families/${id}`).then((res) => res.data);
}

export function adminCreateFamily(data: FamilyPayload): Promise<FamilyDetail> {
  return api.post("/api/admin/families", normalizePayload(data)).then((res) => res.data);
}

export function adminUpdateFamily(id: number, data: FamilyPayload): Promise<FamilyDetail> {
  return api.patch(`/api/admin/families/${id}`, data).then((res) => res.data);
}

export function adminDeleteFamily(id: number): Promise<void> {
  return api.delete(`/api/admin/families/${id}`).then(() => undefined);
}

export function adminRestoreFamily(id: number): Promise<FamilyDetail> {
  return api.post(`/api/admin/families/${id}/restore`).then((res) => res.data);
}

export function adminListReferrerFamilies(rid: number, params?: PaginationParams): Promise<FamilyListResponse> {
  if (params) return api.get("/api/admin/families", { params: { ...params, referrer_id: rid } }).then((res) => res.data);
  return api.get("/api/admin/families", { params: { referrer_id: rid } }).then((res) => res.data);
}

/** Fetch soft-deleted families (separate /deleted endpoint). */
export function adminListDeletedFamilies(params?: PaginationParams & { referrer_id?: number | null }): Promise<FamilyListResponse> {
  if (params) return api.get("/api/admin/families/deleted", { params }).then((res) => res.data);
  return api.get("/api/admin/families/deleted").then((res) => res.data);
}

// ---------------------------------------------------------------------------
// Admin — People
// ---------------------------------------------------------------------------
export function adminListPeople(params?: PaginationParams): Promise<PersonListResponse> {
  if (params) return api.get("/api/admin/people", { params }).then((res) => res.data);
  return api.get("/api/admin/people").then((res) => res.data);
}

export function adminGetPerson(id: number): Promise<PersonDetail> {
  return api.get(`/api/admin/people/${id}`).then((res) => res.data);
}

export function adminCreatePerson(data: PersonPayload): Promise<PersonDetail> {
  return api.post("/api/admin/people", normalizePayload(data)).then((res) => res.data);
}

export function adminUpdatePerson(id: number, data: PersonPayload): Promise<PersonDetail> {
  return api.patch(`/api/admin/people/${id}`, data).then((res) => res.data);
}

export function adminDeletePerson(id: number): Promise<void> {
  return api.delete(`/api/admin/people/${id}`).then(() => undefined);
}

export function adminRestorePerson(id: number): Promise<PersonDetail> {
  return api.post(`/api/admin/people/${id}/restore`).then((res) => res.data);
}

export function adminListFamilyPeople(fid: number, params?: PaginationParams): Promise<PersonListResponse> {
  if (params) return api.get("/api/admin/people", { params: { ...params, family_id: fid } }).then((res) => res.data);
  return api.get("/api/admin/people", { params: { family_id: fid } }).then((res) => res.data);
}

/** Fetch soft-deleted people (separate /deleted endpoint). */
export function adminListDeletedPeople(params?: PaginationParams & { family_id?: number | null }): Promise<PersonListResponse> {
  if (params) return api.get("/api/admin/people/deleted", { params }).then((res) => res.data);
  return api.get("/api/admin/people/deleted").then((res) => res.data);
}

// ---------------------------------------------------------------------------
// Admin — Invite Tokens
// ---------------------------------------------------------------------------

export interface InviteListParams extends PaginationParams {
  redeemed?: boolean;
  expired?: boolean;
}

export function adminListInvites(params?: InviteListParams): Promise<InviteListResponse> {
  if (params) return api.get("/api/admin/invites", { params }).then((res) => res.data);
  return api.get("/api/admin/invites").then((res) => res.data);
}

export function adminGetInvite(id: number): Promise<ReferrerInviteSummary> {
  return api.get(`/api/admin/invites/${id}`).then((res) => res.data);
}

export function adminRevokeInvite(id: number): Promise<ReferrerInviteSummary> {
  return api.post(`/api/admin/invites/${id}/revoke`).then((res) => res.data);
}

// ---------------------------------------------------------------------------
// Admin — CSV Import
// ---------------------------------------------------------------------------
export function adminGetCsvSample(): Promise<string> {
  return api.get("/api/admin/csv-sample").then((res) => res.data);
}

export function adminImportCsv(fileOrText: File | string): Promise<unknown> {
  // Accept a File object or a plain string
  if (fileOrText instanceof File) {
    return api
      .post("/api/admin/import-csv", fileOrText, {
        headers: { "Content-Type": "text/csv" },
      })
      .then((res) => res.data);
  }
  // plain string
  return api
    .post("/api/admin/import-csv", fileOrText, {
      headers: { "Content-Type": "text/csv" },
    })
    .then((res) => res.data);
}

// ---------------------------------------------------------------------------
// Admin — Users
// ---------------------------------------------------------------------------
export function adminListUsers(params?: AdminUsersListParams): Promise<UserListResponse> {
  if (params) return api.get("/api/admin/users", { params }).then((res) => res.data);
  return api.get("/api/admin/users").then((res) => res.data);
}

export function adminGetUser(id: number): Promise<UserDetail> {
  return api.get(`/api/admin/users/${id}`).then((res) => res.data);
}

export function adminCreateUser(data: AdminUserCreate): Promise<UserDetail> {
  return api.post("/api/admin/users", data).then((res) => res.data);
}

export function adminUpdateUser(id: number, data: AdminUserUpdate): Promise<UserDetail> {
  return api.patch(`/api/admin/users/${id}`, data).then((res) => res.data);
}

export function adminResetUserPassword(id: number, data: UserPasswordReset): Promise<UserDetail> {
  return api.post(`/api/admin/users/${id}/reset-password`, data).then((res) => res.data);
}

export function adminDeleteUser(id: number): Promise<void> {
  return api.delete(`/api/admin/users/${id}`).then(() => undefined);
}

export function adminRestoreUser(id: number): Promise<UserDetail> {
  return api.post(`/api/admin/users/${id}/restore`).then((res) => res.data);
}

/** Fetch soft-deleted users (separate /deleted endpoint). */
export function adminListDeletedUsers(params?: AdminUsersListParams): Promise<UserListResponse> {
  if (params) return api.get("/api/admin/users/deleted", { params }).then((res) => res.data);
  return api.get("/api/admin/users/deleted").then((res) => res.data);
}

// ---------------------------------------------------------------------------
// Referrer — Self
// ---------------------------------------------------------------------------
export function getReferrerMe(): Promise<ReferrerDetail> {
  return api.get("/api/referrer/me").then((res) => res.data);
}

export function patchReferrerMe(data: ReferrerPayload): Promise<ReferrerDetail> {
  return api.patch("/api/referrer/me", data).then((res) => res.data);
}

// ---------------------------------------------------------------------------
// Referrer — Families
// ---------------------------------------------------------------------------
export function listReferrerFamilies(): Promise<FamilyListResponse> {
  return api.get("/api/referrer/families").then((res) => res.data);
}

export function getReferrerFamily(id: number): Promise<FamilyDetail> {
  return api.get(`/api/referrer/families/${id}`).then((res) => res.data);
}

export function createReferrerFamily(data: FamilyPayload): Promise<FamilyDetail> {
  return api.post("/api/referrer/families", normalizePayload(data)).then((res) => res.data);
}

export function updateReferrerFamily(id: number, data: FamilyPayload): Promise<FamilyDetail> {
  return api.patch(`/api/referrer/families/${id}`, data).then((res) => res.data);
}

export function deleteReferrerFamily(id: number): Promise<void> {
  return api.delete(`/api/referrer/families/${id}`).then(() => undefined);
}

// ---------------------------------------------------------------------------
// Referrer — People within a family
// ---------------------------------------------------------------------------
export function listReferrerFamilyPeople(fid: number): Promise<PersonListResponse> {
  return api.get(`/api/referrer/families/${fid}/people`).then((res) => res.data);
}

export function createReferrerFamilyPerson(fid: number, data: PersonPayload): Promise<PersonDetail> {
  return api.post(`/api/referrer/families/${fid}/people`, normalizePayload(data)).then((res) => res.data);
}

// ---------------------------------------------------------------------------
// Referrer — Pending Families (invite approvals)
// ---------------------------------------------------------------------------
export function listPendingFamilies(): Promise<PendingFamilySummary[]> {
  return api.get("/api/referrer/pending-families").then((res) => res.data);
}

export function approveFamily(id: number): Promise<FamilyDetail> {
  return api.post(`/api/referrer/families/${id}/approve`).then((res) => res.data);
}

export function rejectFamily(id: number): Promise<FamilyDetail> {
  return api.post(`/api/referrer/families/${id}/reject`).then((res) => res.data);
}

/** Referrer sends a family invite email to a given address. */
export function sendReferrerFamilyInvite(email: string): Promise<ReferrerFamilyInviteResponse> {
  return api.post("/api/referrer/send-family-invite", { email }).then((res) => res.data);
}

// ---------------------------------------------------------------------------
// Public — Family Wish List
// ---------------------------------------------------------------------------

/** Public: fetch the wish list for a family by ID (no auth required). */
export function getFamilyWishList(familyId: number): Promise<FamilyWishListResponse> {
  return api.get(`/api/families/${familyId}/wish-list`).then((res) => res.data);
}

// ---------------------------------------------------------------------------
// Family — Self
// ---------------------------------------------------------------------------
export function getFamilyMe(): Promise<FamilyDetail> {
  return api.get("/api/family/me").then((res) => res.data);
}

export function patchFamilyMe(data: FamilyPayload): Promise<FamilyDetail> {
  return api.patch("/api/family/me", data).then((res) => res.data);
}

// ---------------------------------------------------------------------------
// Family — People
// ---------------------------------------------------------------------------
export function listFamilyPeople(): Promise<PersonListResponse> {
  return api.get("/api/family/people").then((res) => res.data);
}

export function createFamilyPerson(data: PersonPayload): Promise<PersonDetail> {
  return api.post("/api/family/people", normalizePayload(data)).then((res) => res.data);
}

// ---------------------------------------------------------------------------
// Shared — Individual person (multi-role ownership)
// ---------------------------------------------------------------------------
export function getPerson(id: number): Promise<PersonDetail> {
  return api.get(`/api/people/${id}`).then((res) => res.data);
}

export function updatePerson(id: number, data: PersonPayload): Promise<PersonDetail> {
  return api.patch(`/api/people/${id}`, data).then((res) => res.data);
}

export function deletePerson(id: number): Promise<void> {
  return api.delete(`/api/people/${id}`).then(() => undefined);
}

export default api;
