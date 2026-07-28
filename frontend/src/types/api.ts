/** API request/response wrapper shapes derived from backend/app/schemas.py */

import type { FamilySummary, PersonSummary, ReferrerInviteSummary, ReferrerSummary, UserSummary } from "./domain";

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

/** Query params sent to paginated list endpoints. */
export interface PaginationParams {
  page: number;
  page_size: number;
  include_deleted?: boolean;
}

/** Query params for the admin users list endpoint. */
export interface AdminUsersListParams extends PaginationParams {
  include_deleted: boolean;
  role?: string;
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
