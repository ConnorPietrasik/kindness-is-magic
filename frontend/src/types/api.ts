/** API request/response wrapper shapes derived from backend/app/schemas.py */

import type {
  FamilySummary,
  PersonSummary,
  PurchaserWishSummary,
  ReferrerInviteSummary,
  ReferrerSummary,
  UserSummary,
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

/** Query params for the admin users list endpoint. */
export interface AdminUsersListParams extends PaginationParams {
  role?: string;
  roles?: string;
  search?: string;
}

// ---------------------------------------------------------------------------
// Paginated list responses
// ---------------------------------------------------------------------------

/** Mirrors ReferrerListResponse. */
export interface ReferrerListResponse {
  referrers: ReferrerSummary[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

/** Mirrors FamilyListResponse. */
export interface FamilyListResponse {
  families: FamilySummary[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

/** Mirrors PersonListResponse. */
export interface PersonListResponse {
  people: PersonSummary[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

/** Mirrors UserListResponse. */
export interface UserListResponse {
  users: UserSummary[];
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

/** Query params for the admin wishes list endpoint. */
export interface AdminWishesListParams extends PaginationParams {
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
