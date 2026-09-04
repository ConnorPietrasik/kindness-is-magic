/** API request/response wrapper shapes derived from backend/app/schemas.py */

import type {
  EmailKind,
  EmailStatus,
  FamilyDetail,
  PersonDetail,
  PurchaserWishSummary,
  ReferrerDetail,
  ReferrerInviteSummary,
  SentEmailSummary,
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
  roles?: string; // comma-separated role names, e.g. "admin,purchaser"
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
  verification_status?: string;
  wish_lock_level?: string;
  min_person_count?: number;
  max_person_count?: number;
}

/** Query params for the admin people list endpoint. */
export interface AdminPeopleListParams extends AdminListParams {
  family_id?: number;
  search?: string;
  search_name?: string;
  search_role?: string;
  search_note?: string;
  search_wish?: string;
  min_age?: number;
  max_age?: number;
}

/** Query params for the admin invites list endpoint (updated with search + sort). */
export interface InviteListParams extends AdminListParams {
  redeemed?: boolean;
  expired?: boolean;
  search?: string;
}

/** Query params for the admin wishes list endpoint (updated with wish_type + sort).
 *
 * Per-column search params are named after the list item field (text fields,
 * plus `<field>_from` / `<field>_to` for the date columns); they AND together
 * and with the global `search` box. Free-text fields match as substrings;
 * closed-vocabulary fields (person_role, person_age, family_verification_status)
 * match as whole values (case-insensitive).
 */
export interface AdminWishesListParams extends AdminListParams {
  family_id?: number;
  person_id?: number;
  assigned_to_id?: number;
  purchased?: string;
  search?: string;
  wish_type?: string;
  // Per-column text search
  description?: string;
  size?: string;
  color?: string;
  person_given_name?: string;
  person_role?: string;
  person_age?: string;
  person_note?: string;
  family_name?: string;
  family_contact_name?: string;
  family_phone_number?: string;
  family_address?: string;
  family_verification_status?: string;
  family_bio?: string;
  referrer_name?: string;
  referrer_phone_number?: string;
  assigned_to_name?: string;
  purchased_where?: string;
  purchaser_note?: string;
  // Per-column date ranges (YYYY-MM-DD, inclusive UTC day boundaries)
  purchased_at_from?: string;
  purchased_at_to?: string;
  received_at_from?: string;
  received_at_to?: string;
  created_at_from?: string;
  created_at_to?: string;
  family_pickup_window_from?: string;
  family_pickup_window_to?: string;
}

/** Query params for the admin sent-email log endpoint. */
export interface AdminEmailsListParams extends AdminListParams {
  search?: string;
  kind?: EmailKind;
  status?: EmailStatus;
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

/** Mirrors EmailListResponse — paginated admin sent-email log. */
export interface EmailListResponse {
  emails: SentEmailSummary[];
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
