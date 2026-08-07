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
}

/** Query params for the admin users list endpoint. */
export interface AdminUsersListParams extends AdminListParams {
  role?: string;
  roles?: string;
  search?: string;
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

/** Query params for the admin invites list endpoint. */
export interface InviteListParams extends AdminListParams {
  redeemed?: boolean;
  expired?: boolean;
}

/** Query params for the admin wishes list endpoint. */
export interface AdminWishesListParams extends AdminListParams {
  family_id?: number;
  person_id?: number;
  assigned_to_id?: number;
  purchased?: string;
  search?: string;
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
