/** API request/response wrapper shapes derived from backend/app/schemas.py */

import type { FamilySummary, PersonSummary, ReferrerSummary } from "./domain";

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

/** Query params sent to paginated list endpoints. */
export interface PaginationParams {
  page: number;
  page_size: number;
  include_deleted?: boolean;
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
