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
  AdminWishesListParams,
  AdminWishUpdate,
  FamilyDetail,
  FamilyListResponse,
  FamilyPayload,
  FamilyReviewQueueItem,
  FamilySelfRegisterPayload,
  FamilySelfRegisterResponse,
  FamilyWishListResponse,
  InviteListResponse,
  PackingSlipItem,
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
  WishBatchAssign,
  WishDetail,
  WishListResponse,
  WishPurchaseMark,
} from "../types";
import { normalizePayload } from "./utils";

const api: AxiosInstance = axios.create({
  baseURL: "",
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

// ---------------------------------------------------------------------------
// Typed request helpers — auto-extract `res.data`
// ---------------------------------------------------------------------------

function apiGet<T>(url: string, params?: unknown): Promise<T> {
  if (params) return api.get<T>(url, { params }).then((res) => res.data);
  return api.get<T>(url).then((res) => res.data);
}

function apiPost<T>(url: string, data?: unknown): Promise<T> {
  if (data !== undefined) return api.post<T>(url, data).then((res) => res.data);
  return api.post<T>(url).then((res) => res.data);
}

function apiPatch<T>(url: string, data: unknown): Promise<T> {
  return api.patch<T>(url, data).then((res) => res.data);
}

function apiPut<T>(url: string, data: unknown): Promise<T> {
  return api.put<T>(url, data).then((res) => res.data);
}

function apiDelete(url: string): Promise<void> {
  return api.delete(url).then(() => undefined);
}

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

    // Only attempt refresh on 401, skip the refresh endpoint and the auth check.
    // A 401 on /api/auth/me simply means "not logged in" — nothing to refresh.
    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      originalRequest.url !== "/api/auth/refresh" &&
      originalRequest.url !== "/api/auth/me"
    ) {
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
  return apiPost("/api/auth/forgot-password", { email });
}

export function resetPasswordRequest(token: string, new_password: string): Promise<unknown> {
  return apiPost("/api/auth/reset-password", { token, new_password });
}

export function changePasswordRequest(old_password: string, new_password: string): Promise<unknown> {
  return apiPut("/api/auth/me/password", { old_password, new_password });
}

/** Update the current user's display name. Send `""` to clear it. */
export function updateMyProfile(displayName: string): Promise<User> {
  return apiPatch("/api/auth/me", { display_name: displayName });
}

// ---------------------------------------------------------------------------
// Auth — Referrer Invite
// ---------------------------------------------------------------------------

/** Admin creates an invite token for a referrer to self-register. */
export function createReferrerInvite(data: ReferrerInviteCreatePayload): Promise<ReferrerInviteResponse> {
  return apiPost("/api/auth/invite-referrer", data);
}

/** Public: redeem an invite code to register as a referrer (auto-logs in). */
export function registerReferrerViaInvite(data: ReferrerSelfRegisterPayload): Promise<ReferrerSelfRegisterResponse> {
  return apiPost("/api/auth/register-referrer", data);
}

/** Public: redeem an invite code to register as a family (auto-logs in). */
export function registerFamilyViaInvite(data: FamilySelfRegisterPayload): Promise<FamilySelfRegisterResponse> {
  return apiPost("/api/auth/register-family", data);
}

// ---------------------------------------------------------------------------
// Admin — Referrers
// ---------------------------------------------------------------------------
export function adminListReferrers(params?: PaginationParams): Promise<ReferrerListResponse> {
  return apiGet("/api/admin/referrers", params);
}

export function adminGetReferrer(id: number): Promise<ReferrerDetail> {
  return apiGet(`/api/admin/referrers/${id}`);
}

export function adminCreateReferrer(data: ReferrerPayload): Promise<ReferrerDetail> {
  return apiPost("/api/admin/referrers", normalizePayload(data));
}

export function adminUpdateReferrer(id: number, data: ReferrerPayload): Promise<ReferrerDetail> {
  return apiPatch(`/api/admin/referrers/${id}`, data);
}

export function adminDeleteReferrer(id: number): Promise<void> {
  return apiDelete(`/api/admin/referrers/${id}`);
}

export function adminRestoreReferrer(id: number): Promise<ReferrerDetail> {
  return apiPost(`/api/admin/referrers/${id}/restore`);
}

export function adminApproveReferrer(id: number): Promise<ReferrerDetail> {
  return apiPost(`/api/admin/referrers/${id}/approve`);
}

export function adminRejectReferrer(id: number): Promise<ReferrerDetail> {
  return apiPost(`/api/admin/referrers/${id}/reject`);
}

/** Fetch soft-deleted referrers (separate /deleted endpoint). */
export function adminListDeletedReferrers(params?: PaginationParams): Promise<ReferrerListResponse> {
  return apiGet("/api/admin/referrers/deleted", params);
}

// ---------------------------------------------------------------------------
// Admin — Families
// ---------------------------------------------------------------------------
export function adminListFamilies(params?: PaginationParams): Promise<FamilyListResponse> {
  return apiGet("/api/admin/families", params);
}

export function adminGetFamily(id: number): Promise<FamilyDetail> {
  return apiGet(`/api/admin/families/${id}`);
}

export function adminCreateFamily(data: FamilyPayload): Promise<FamilyDetail> {
  return apiPost("/api/admin/families", normalizePayload(data));
}

export function adminUpdateFamily(id: number, data: FamilyPayload): Promise<FamilyDetail> {
  return apiPatch(`/api/admin/families/${id}`, data);
}

export function adminDeleteFamily(id: number): Promise<void> {
  return apiDelete(`/api/admin/families/${id}`);
}

export function adminRestoreFamily(id: number): Promise<FamilyDetail> {
  return apiPost(`/api/admin/families/${id}/restore`);
}

export function adminListReferrerFamilies(rid: number, params?: PaginationParams): Promise<FamilyListResponse> {
  return apiGet("/api/admin/families", { ...params, referrer_id: rid });
}

/** Fetch soft-deleted families (separate /deleted endpoint). */
export function adminListDeletedFamilies(params?: PaginationParams & { referrer_id?: number | null }): Promise<FamilyListResponse> {
  return apiGet("/api/admin/families/deleted", params);
}

// ---------------------------------------------------------------------------
// Admin — Wish Review Queue
// ---------------------------------------------------------------------------
export function listAdminReviewQueue(): Promise<FamilyReviewQueueItem[]> {
  return apiGet("/api/admin/families/review-queue");
}

export function adminApproveWishes(id: number): Promise<FamilyDetail> {
  return apiPost(`/api/admin/families/${id}/approve-wishes`);
}

export function adminRejectWishes(id: number, reason: string): Promise<FamilyDetail> {
  return apiPost(`/api/admin/families/${id}/reject-wishes`, { reason });
}

/** Reset a family's wish state back to family-editable (clears lock + review flags). */
export function adminResetWishState(id: number): Promise<FamilyDetail> {
  return apiPost(`/api/admin/families/${id}/reset-wish-state`);
}

/** Fetch packing slips for admin-locked (fully approved) families. */
export function adminGetPackingSlips(familyIds?: number[]): Promise<PackingSlipItem[]> {
  const params = familyIds && familyIds.length > 0 ? { family_ids: familyIds.join(",") } : undefined;
  return apiGet("/api/admin/families/packing-slips", params);
}

// ---------------------------------------------------------------------------
// Admin — People
// ---------------------------------------------------------------------------
export function adminListPeople(params?: PaginationParams): Promise<PersonListResponse> {
  return apiGet("/api/admin/people", params);
}

export function adminGetPerson(id: number): Promise<PersonDetail> {
  return apiGet(`/api/admin/people/${id}`);
}

export function adminCreatePerson(data: PersonPayload): Promise<PersonDetail> {
  return apiPost("/api/admin/people", normalizePayload(data));
}

export function adminUpdatePerson(id: number, data: PersonPayload): Promise<PersonDetail> {
  return apiPatch(`/api/admin/people/${id}`, data);
}

export function adminDeletePerson(id: number): Promise<void> {
  return apiDelete(`/api/admin/people/${id}`);
}

export function adminRestorePerson(id: number): Promise<PersonDetail> {
  return apiPost(`/api/admin/people/${id}/restore`);
}

export function adminListFamilyPeople(fid: number, params?: PaginationParams): Promise<PersonListResponse> {
  return apiGet("/api/admin/people", { ...params, family_id: fid });
}

/** Fetch soft-deleted people (separate /deleted endpoint). */
export function adminListDeletedPeople(params?: PaginationParams & { family_id?: number | null }): Promise<PersonListResponse> {
  return apiGet("/api/admin/people/deleted", params);
}

// ---------------------------------------------------------------------------
// Admin — Invite Tokens
// ---------------------------------------------------------------------------

export interface InviteListParams extends PaginationParams {
  redeemed?: boolean;
  expired?: boolean;
}

export function adminListInvites(params?: InviteListParams): Promise<InviteListResponse> {
  return apiGet("/api/admin/invites", params);
}

export function adminGetInvite(id: number): Promise<ReferrerInviteSummary> {
  return apiGet(`/api/admin/invites/${id}`);
}

export function adminRevokeInvite(id: number): Promise<ReferrerInviteSummary> {
  return apiPost(`/api/admin/invites/${id}/revoke`);
}

// ---------------------------------------------------------------------------
// Admin — CSV Import
// ---------------------------------------------------------------------------
export function adminGetCsvSample(): Promise<string> {
  return apiGet("/api/admin/csv-sample");
}

export function adminImportCsv(fileOrText: File | string): Promise<unknown> {
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
  return apiGet("/api/admin/users", params);
}

export function adminGetUser(id: number): Promise<UserDetail> {
  return apiGet(`/api/admin/users/${id}`);
}

export function adminCreateUser(data: AdminUserCreate): Promise<UserDetail> {
  return apiPost("/api/admin/users", data);
}

export function adminUpdateUser(id: number, data: AdminUserUpdate): Promise<UserDetail> {
  return apiPatch(`/api/admin/users/${id}`, data);
}

export function adminResetUserPassword(id: number, data: UserPasswordReset): Promise<UserDetail> {
  return apiPost(`/api/admin/users/${id}/reset-password`, data);
}

export function adminDeleteUser(id: number): Promise<void> {
  return apiDelete(`/api/admin/users/${id}`);
}

export function adminRestoreUser(id: number): Promise<UserDetail> {
  return apiPost(`/api/admin/users/${id}/restore`);
}

/** Fetch soft-deleted users (separate /deleted endpoint). */
export function adminListDeletedUsers(params?: AdminUsersListParams): Promise<UserListResponse> {
  return apiGet("/api/admin/users/deleted", params);
}

// ---------------------------------------------------------------------------
// Admin — Wishes
// ---------------------------------------------------------------------------
export function adminListWishes(params?: AdminWishesListParams): Promise<WishListResponse> {
  return apiGet("/api/admin/wishes", params);
}

export function adminGetWish(wishId: number): Promise<WishDetail> {
  return apiGet(`/api/admin/wishes/${wishId}`);
}

export function adminUpdateWish(wishId: number, payload: Partial<AdminWishUpdate>): Promise<WishDetail> {
  return apiPatch(`/api/admin/wishes/${wishId}`, payload);
}

export function adminMarkPurchased(wishId: number, payload: WishPurchaseMark): Promise<WishDetail> {
  return apiPost(`/api/admin/wishes/${wishId}/mark-purchased`, payload);
}

export function adminBatchAssignWishes(payload: WishBatchAssign): Promise<{ assigned_count: number }> {
  return apiPost("/api/admin/wishes/batch-assign", payload);
}

// ---------------------------------------------------------------------------
// Referrer — Self
// ---------------------------------------------------------------------------
export function getReferrerMe(): Promise<ReferrerDetail> {
  return apiGet("/api/referrer/me");
}

export function patchReferrerMe(data: ReferrerPayload): Promise<ReferrerDetail> {
  return apiPatch("/api/referrer/me", data);
}

// ---------------------------------------------------------------------------
// Referrer — Families
// ---------------------------------------------------------------------------
export function listReferrerFamilies(): Promise<FamilyListResponse> {
  return apiGet("/api/referrer/families");
}

export function getReferrerFamily(id: number): Promise<FamilyDetail> {
  return apiGet(`/api/referrer/families/${id}`);
}

export function createReferrerFamily(data: FamilyPayload): Promise<FamilyDetail> {
  return apiPost("/api/referrer/families", normalizePayload(data));
}

export function updateReferrerFamily(id: number, data: FamilyPayload): Promise<FamilyDetail> {
  return apiPatch(`/api/referrer/families/${id}`, data);
}

export function deleteReferrerFamily(id: number): Promise<void> {
  return apiDelete(`/api/referrer/families/${id}`);
}

// ---------------------------------------------------------------------------
// Referrer — People within a family
// ---------------------------------------------------------------------------
export function listReferrerFamilyPeople(fid: number): Promise<PersonListResponse> {
  return apiGet(`/api/referrer/families/${fid}/people`);
}

export function createReferrerFamilyPerson(fid: number, data: PersonPayload): Promise<PersonDetail> {
  return apiPost(`/api/referrer/families/${fid}/people`, normalizePayload(data));
}

// ---------------------------------------------------------------------------
// Referrer — Pending Families (invite approvals)
// ---------------------------------------------------------------------------
export function listPendingFamilies(): Promise<PendingFamilySummary[]> {
  return apiGet("/api/referrer/pending-families");
}

export function approveFamily(id: number): Promise<FamilyDetail> {
  return apiPost(`/api/referrer/families/${id}/approve`);
}

export function rejectFamily(id: number): Promise<FamilyDetail> {
  return apiPost(`/api/referrer/families/${id}/reject`);
}

/** Referrer sends a family invite email to a given address. */
export function sendReferrerFamilyInvite(email: string): Promise<ReferrerFamilyInviteResponse> {
  return apiPost("/api/referrer/send-family-invite", { email });
}

// ---------------------------------------------------------------------------
// Referrer — Wish Review Queue
// ---------------------------------------------------------------------------
export function listReferrerReviewQueue(): Promise<FamilyReviewQueueItem[]> {
  return apiGet("/api/referrer/review-queue");
}

export function referrerApproveWishes(id: number): Promise<FamilyDetail> {
  return apiPost(`/api/referrer/families/${id}/approve-wishes`);
}

export function referrerRejectWishes(id: number, reason: string): Promise<FamilyDetail> {
  return apiPost(`/api/referrer/families/${id}/reject-wishes`, { reason });
}

// ---------------------------------------------------------------------------
// Public — Family Wish List
// ---------------------------------------------------------------------------

/** Public: fetch the wish list for a family by ID (no auth required). */
export function getFamilyWishList(familyId: number): Promise<FamilyWishListResponse> {
  return apiGet(`/api/families/${familyId}/wish-list`);
}

// ---------------------------------------------------------------------------
// Family — Self
// ---------------------------------------------------------------------------
export function getFamilyMe(): Promise<FamilyDetail> {
  return apiGet("/api/family/me");
}

export function patchFamilyMe(data: FamilyPayload): Promise<FamilyDetail> {
  return apiPatch("/api/family/me", data);
}

// ---------------------------------------------------------------------------
// Family — People
// ---------------------------------------------------------------------------
export function listFamilyPeople(): Promise<PersonListResponse> {
  return apiGet("/api/family/people");
}

export function createFamilyPerson(data: PersonPayload): Promise<PersonDetail> {
  return apiPost("/api/family/people", normalizePayload(data));
}

// ---------------------------------------------------------------------------
// Family — Wish Review Request / Cancel
// ---------------------------------------------------------------------------
export function requestFamilyReview(): Promise<FamilyDetail> {
  return apiPost("/api/family/me/request-review");
}

export function cancelFamilyReview(): Promise<FamilyDetail> {
  return apiPost("/api/family/me/cancel-review");
}

// ---------------------------------------------------------------------------
// Shared — Individual person (multi-role ownership)
// ---------------------------------------------------------------------------
export function getPerson(id: number): Promise<PersonDetail> {
  return apiGet(`/api/people/${id}`);
}

export function updatePerson(id: number, data: PersonPayload): Promise<PersonDetail> {
  return apiPatch(`/api/people/${id}`, data);
}

export function deletePerson(id: number): Promise<void> {
  return apiDelete(`/api/people/${id}`);
}

export default api;
