/** API request/response wrapper shapes derived from backend/app/schemas.py */

import type {
  FamilyDetail,
  PersonDetail,
  PurchaserWishSummary,
  ReferrerDetail,
  ReferrerInviteSummary,
  UserDetail,
  WishListSummary,
} from "./domain";

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

/** Query params sent to paginated list endpoints. */
export interface PaginationParams {
  page: number;
  page_size: number;
}

/** Query params for admin list endpoints that support column visibility. */
export interface AdminListParams extends PaginationParams {
  columns?: string[]; // resolved backend field names (sent as comma-separated)
  sort?: string;
}

/** Query params for the admin users list endpoint. */
export interface AdminUsersListParams extends AdminListParams {
  role?: string;
  roles?: string;
  search?: string;
}

/** Query params for the admin referrers list endpoint. */
export interface AdminReferrersListParams extends AdminListParams {
  search?: string;
  approval_status?: string;
}

/** Query params for the admin families list endpoint. */
export interface AdminFamiliesListParams extends AdminListParams {
  search?: string;
  search_name?: string;
  search_contact?: string;
  search_phone?: string;
  search_wish?: string;
  approval_status?: string;
  wish_lock_level?: string;
}

/** Query params for the admin people list endpoint. */
export interface AdminPeopleListParams extends AdminListParams {
  family_id?: number;
  search?: string;
  search_name?: string;
  search_title?: string;
  search_note?: string;
  search_wish?: string;
}

/** Query params for the admin invites list endpoint (updated with search + sort). */
export interface InviteListParams extends AdminListParams {
  redeemed?: boolean;
  expired?: boolean;
  search?: string;
}

/** Query params for the admin wishes list endpoint (updated with wish_type + sort). */
export interface AdminWishesListParams extends AdminListParams {
  family_id?: number;
  person_id?: number;
  assigned_to_id?: number;
  purchased?: string;
  search?: string;
  wish_type?: string;
}

// ---------------------------------------------------------------------------
// Paginated list responses
// ---------------------------------------------------------------------------

/** Mirrors ReferrerListResponse. */
export interface ReferrerListResponse {
  referrers: ReferrerDetail[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

/** Mirrors FamilyListResponse. */
export interface FamilyListResponse {
  families: FamilyDetail[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

/** Mirrors PersonListResponse. */
export interface PersonListResponse {
  people: PersonDetail[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

/** Mirrors UserListResponse. */
export interface UserListResponse {
  users: UserDetail[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

/** Mirrors InviteListResponse. */
export interface InviteListResponse {
  invites: ReferrerInviteSummary[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

/** Mirrors WishListResponse — paginated admin wish list. */
export interface WishListResponse {
  wishes: WishListSummary[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

/** Mirrors PurchaserWishListResponse — paginated purchaser wish list. */
export interface PurchaserWishListResponse {
  wishes: PurchaserWishSummary[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

// ---------------------------------------------------------------------------
// Dropdown items — minimal payloads for select/option lists
// ---------------------------------------------------------------------------

/** Minimal user entry for dropdown selects. */
export interface UserDropdownItem {
  id: number;
  display_name: string;
}

/** Minimal referrer entry for dropdown selects. */
export interface ReferrerDropdownItem {
  id: number;
  name: string;
}

/** Minimal family entry for dropdown selects. */
export interface FamilyDropdownItem {
  id: number;
  family_name: string;
}
