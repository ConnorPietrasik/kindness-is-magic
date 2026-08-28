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
  AdminEmailsListParams,
  AdminFamiliesListParams,
  AdminPeopleListParams,
  AdminReferrersListParams,
  AdminUserCreate,
  AdminUsersListParams,
  AdminUserUpdate,
  AdminWishesListParams,
  AdminWishUpdate,
  CommitmentType,
  DeliveryFamilySummary,
  DonorSelfRegisterPayload,
  DonorSelfRegisterResponse,
  DonorWishPurchaseMark,
  EmailListResponse,
  FamilyClaimDetail,
  FamilyClaimSummary,
  FamilyClaimUpdate,
  FamilyDetail,
  FamilyDropdownItem,
  FamilyListResponse,
  FamilyPayload,
  FamilyReviewQueueItem,
  FamilySelfPayload,
  FamilySelfRegisterPayload,
  FamilySelfRegisterResponse,
  FamilySelfServiceDetail,
  FamilyWishListResponse,
  InviteListParams,
  InviteListResponse,
  PackingSlipItem,
  PaginationParams,
  PendingFamilySummary,
  PersonDetail,
  PersonListResponse,
  PersonPayload,
  PublicFamilyListResponse,
  PurchaserWishListResponse,
  PurchaserWishUpdate,
  ReferrerDetail,
  ReferrerDropdownItem,
  ReferrerFamilyInviteResponse,
  ReferrerInviteCreatePayload,
  ReferrerInviteEmailItem,
  ReferrerInviteResponse,
  ReferrerInviteSummary,
  ReferrerListResponse,
  ReferrerPayload,
  ReferrerSelfRegisterPayload,
  ReferrerSelfRegisterResponse,
  User,
  UserDetail,
  UserDropdownItem,
  UserListResponse,
  UserPasswordReset,
  WishBatchAssign,
  WishDetail,
  WishListResponse,
  WishPurchaseMark,
  WishSummary,
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
export function adminListReferrers(params?: AdminReferrersListParams): Promise<ReferrerListResponse> {
  const p = params ? { ...params, columns: params.columns?.join(",") } : undefined;
  return apiGet("/api/admin/referrers", p);
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

/** Admin resets the referrer's sent family invite emails (clears the invite cap + 7-day dedup; rows remain in the log as "reset"). */
export function adminResetReferrerSentEmails(id: number): Promise<ReferrerDetail> {
  return apiPost(`/api/admin/referrers/${id}/reset-sent-emails`);
}

/** Fetch soft-deleted referrers (separate /deleted endpoint). */
export function adminListDeletedReferrers(params?: AdminReferrersListParams): Promise<ReferrerListResponse> {
  const p = params ? { ...params, columns: params.columns?.join(",") } : undefined;
  return apiGet("/api/admin/referrers/deleted", p);
}

/** Fetch minimal referrer list for dropdown selects (no pagination). */
export function adminGetReferrersDropdown(): Promise<ReferrerDropdownItem[]> {
  return apiGet("/api/admin/referrers/dropdown");
}

// ---------------------------------------------------------------------------
// Admin — Families
// ---------------------------------------------------------------------------
export function adminListFamilies(params?: AdminFamiliesListParams): Promise<FamilyListResponse> {
  const p = params ? { ...params, columns: params.columns?.join(",") } : undefined;
  return apiGet("/api/admin/families", p);
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

export function adminListReferrerFamilies(rid: number, params?: AdminFamiliesListParams): Promise<FamilyListResponse> {
  const p: Record<string, unknown> = { referrer_id: rid };
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined) p[k] = k === "columns" && Array.isArray(v) ? v.join(",") : v;
    });
  }
  return apiGet("/api/admin/families", p);
}

/** Fetch soft-deleted families (separate /deleted endpoint). */
export function adminListDeletedFamilies(params?: AdminFamiliesListParams & { referrer_id?: number | null }): Promise<FamilyListResponse> {
  const p = params ? { ...params, columns: params.columns?.join(",") } : undefined;
  return apiGet("/api/admin/families/deleted", p);
}

/** Fetch minimal family list for dropdown selects (no pagination). */
export function adminGetFamiliesDropdown(): Promise<FamilyDropdownItem[]> {
  return apiGet("/api/admin/families/dropdown");
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
export function adminListPeople(params?: AdminPeopleListParams): Promise<PersonListResponse> {
  const p = params ? { ...params, columns: params.columns?.join(",") } : undefined;
  return apiGet("/api/admin/people", p);
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

export function adminListFamilyPeople(fid: number, params?: AdminPeopleListParams): Promise<PersonListResponse> {
  const p: Record<string, unknown> = { family_id: fid };
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined) p[k] = k === "columns" && Array.isArray(v) ? v.join(",") : v;
    });
  }
  return apiGet("/api/admin/people", p);
}

/** Fetch soft-deleted people (separate /deleted endpoint). */
export function adminListDeletedPeople(params?: AdminPeopleListParams & { family_id?: number | null }): Promise<PersonListResponse> {
  const p = params ? { ...params, columns: params.columns?.join(",") } : undefined;
  return apiGet("/api/admin/people/deleted", p);
}

// ---------------------------------------------------------------------------
// Admin — Invite Tokens
// ---------------------------------------------------------------------------

export function adminListInvites(params?: InviteListParams): Promise<InviteListResponse> {
  const p = params ? { ...params, columns: params.columns?.join(",") } : undefined;
  return apiGet("/api/admin/invites", p);
}

export function adminGetInvite(id: number): Promise<ReferrerInviteSummary> {
  return apiGet(`/api/admin/invites/${id}`);
}

export function adminRevokeInvite(id: number): Promise<ReferrerInviteSummary> {
  return apiPost(`/api/admin/invites/${id}/revoke`);
}

// ---------------------------------------------------------------------------
// Admin — Sent Email Log
// ---------------------------------------------------------------------------

export function adminListSentEmails(params?: AdminEmailsListParams): Promise<EmailListResponse> {
  const p = params ? { ...params, columns: params.columns?.join(",") } : undefined;
  return apiGet("/api/admin/emails", p);
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
  const p = params ? { ...params, columns: params.columns?.join(",") } : undefined;
  return apiGet("/api/admin/users", p);
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
  const p = params ? { ...params, columns: params.columns?.join(",") } : undefined;
  return apiGet("/api/admin/users/deleted", p);
}

/** Fetch minimal user list for dropdown selects (no pagination). Optional role filter. */
export function adminGetUsersDropdown(roles?: string): Promise<UserDropdownItem[]> {
  return roles ? apiGet("/api/admin/users/dropdown", { roles }) : apiGet("/api/admin/users/dropdown");
}

// ---------------------------------------------------------------------------
// Admin — Wishes
// ---------------------------------------------------------------------------
export function adminListWishes(params?: AdminWishesListParams): Promise<WishListResponse> {
  const p = params ? { ...params, columns: params.columns?.join(",") } : undefined;
  return apiGet("/api/admin/wishes", p);
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
// Referrer — Pending Families (verification queue)
// ---------------------------------------------------------------------------
export function listPendingFamilies(): Promise<PendingFamilySummary[]> {
  return apiGet("/api/referrer/pending-families");
}

export function verifyFamily(id: number): Promise<FamilyDetail> {
  return apiPost(`/api/referrer/families/${id}/verify`);
}

export function rejectFamily(id: number): Promise<FamilyDetail> {
  return apiPost(`/api/referrer/families/${id}/reject`);
}

/** Referrer sends a family invite email to a given address. */
export function sendReferrerFamilyInvite(email: string): Promise<ReferrerFamilyInviteResponse> {
  return apiPost("/api/referrer/send-family-invite", { email });
}

/** Referrer's own family invite email history (all statuses, newest first). */
export function listReferrerInviteEmails(): Promise<ReferrerInviteEmailItem[]> {
  return apiGet("/api/referrer/invite-emails");
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
// Public — Families (donor browse)
// ---------------------------------------------------------------------------

export interface PublicFamiliesListParams {
  page?: number;
  page_size?: number;
  min_person_count?: number;
  max_person_count?: number;
  min_age?: number;
  max_age?: number;
  sort?: string;
}

/** Public: list all fully-approved families for donor browsing (no auth required). */
export function listPublicFamilies(params?: PublicFamiliesListParams): Promise<PublicFamilyListResponse> {
  return apiGet("/api/families", params);
}

// ---------------------------------------------------------------------------
// Public — Family Wish List
// ---------------------------------------------------------------------------

/** Public: fetch the wish list for a family by ID (no auth required). */
export function getFamilyWishList(familyId: number): Promise<FamilyWishListResponse> {
  return apiGet(`/api/families/${familyId}/wish-list`);
}

/** Claim a family (authenticated claim-capable user). */
export function claimFamily(familyId: number, commitmentType: CommitmentType): Promise<FamilyClaimSummary> {
  return apiPost(`/api/families/${familyId}/claim`, { commitment_type: commitmentType });
}

// ---------------------------------------------------------------------------
// Donor — Self-Registration
// ---------------------------------------------------------------------------

/** Public: open donor self-registration (auto-logs in). */
export function registerDonor(data: DonorSelfRegisterPayload): Promise<DonorSelfRegisterResponse> {
  return apiPost("/api/auth/register-donor", data);
}

// ---------------------------------------------------------------------------
// Donor — Profile
// ---------------------------------------------------------------------------

export interface DonorClaimsListParams {
  fulfilled?: boolean;
}

/** Get current user profile (claim-capable roles). */
export function donorGetMe(): Promise<User> {
  return apiGet("/api/donor/me");
}

// ---------------------------------------------------------------------------
// Donor — Claims
// ---------------------------------------------------------------------------

/** List current user's claims. */
export function donorListClaims(params?: DonorClaimsListParams): Promise<FamilyClaimSummary[]> {
  return apiGet("/api/donor/claims", params);
}

/** Get claim detail with wish list. */
export function donorGetClaim(claimId: number): Promise<FamilyClaimDetail> {
  return apiGet(`/api/donor/claims/${claimId}`);
}

/** Update claim (commitment_type, notes). */
export function donorUpdateClaim(claimId: number, payload: FamilyClaimUpdate): Promise<FamilyClaimSummary> {
  return apiPatch(`/api/donor/claims/${claimId}`, payload);
}

/** Cancel (soft-delete) a claim. */
export function donorCancelClaim(claimId: number): Promise<void> {
  return apiDelete(`/api/donor/claims/${claimId}`);
}

/** Mark a wish as purchased (donor — no received_at). */
export function donorMarkWishPurchased(claimId: number, wishId: number, payload: DonorWishPurchaseMark): Promise<WishSummary> {
  return apiPost(`/api/donor/claims/${claimId}/wishes/${wishId}/mark-purchased`, payload);
}

/** Admin: fulfill a claim. */
export function donorFulfillClaim(claimId: number): Promise<FamilyClaimSummary> {
  return apiPost(`/api/donor/claims/${claimId}/fulfill`);
}

// ---------------------------------------------------------------------------
// Family — Self
// ---------------------------------------------------------------------------
export function getFamilyMe(): Promise<FamilySelfServiceDetail> {
  return apiGet("/api/family/me");
}

export function patchFamilyMe(data: FamilySelfPayload): Promise<FamilySelfServiceDetail> {
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
export function requestFamilyReview(): Promise<FamilySelfServiceDetail> {
  return apiPost("/api/family/me/request-review");
}

export function cancelFamilyReview(): Promise<FamilySelfServiceDetail> {
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

// ---------------------------------------------------------------------------
// Purchaser — Assigned Wishes
// ---------------------------------------------------------------------------

export interface PurchaserWishesListParams extends PaginationParams {
  purchased?: string;
}

/** List wishes assigned to the current purchaser. */
export function purchaserListWishes(params?: PurchaserWishesListParams): Promise<PurchaserWishListResponse> {
  return apiGet("/api/purchaser/wishes", params);
}

/** Get detail of a single wish assigned to the current purchaser. */
export function purchaserGetWish(wishId: number): Promise<WishDetail> {
  return apiGet(`/api/purchaser/wishes/${wishId}`);
}

/** Mark a wish as purchased (sets purchased_at=now + optional fields). */
export function purchaserMarkPurchased(wishId: number, payload: WishPurchaseMark): Promise<WishDetail> {
  return apiPost(`/api/purchaser/wishes/${wishId}/mark-purchased`, payload);
}

/** Partial update of purchaser_note and/or received_at on an assigned wish. */
export function purchaserUpdateWish(wishId: number, payload: Partial<PurchaserWishUpdate>): Promise<WishDetail> {
  return apiPatch(`/api/purchaser/wishes/${wishId}`, payload);
}

// ---------------------------------------------------------------------------
// Delivery — Assigned Families
// ---------------------------------------------------------------------------

/** List families assigned to the current delivery person. */
export function deliveryListFamilies(): Promise<DeliveryFamilySummary[]> {
  return apiGet("/api/delivery/families");
}

/** Get packing slips for families assigned to the current delivery person. */
export function deliveryGetPackingSlips(): Promise<PackingSlipItem[]> {
  return apiGet("/api/delivery/packing-slips");
}

export default api;
