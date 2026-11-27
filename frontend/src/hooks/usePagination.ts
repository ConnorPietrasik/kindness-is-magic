/**
 * usePagination — reusable hook for managing page / page-size state.
 *
 * Manages `page` and `pageSize` as local state and exposes:
 *  - `params` — the query params object to pass to API calls
 *  - navigation controls (goToPage, goToNext, etc.)
 *  - `pageSizeOptions` for the UI selector
 *
 * The hook does NOT depend on API data. Pages derive `total` / `totalPages`
 * from the list response and pass them into the `<Pagination>` component.
 *
 * Persisted views should also call `usePageClamp` (below) so a stale saved
 * page can't point past the last page once the list reports its total.
 *
 * @example
 * ```tsx
 * const pagination = usePagination();
 * const { listData } = useCrudManager({
 *   listFn: adminListReferrers,
 *   listParams: pagination.params,
 * });
 * <Pagination
 *   page={pagination.page}
 *   totalPages={listData ? Math.ceil(listData.total / pagination.pageSize) : 0}
 *   total={listData?.total ?? 0}
 *   pageSize={pagination.pageSize}
 *   onPageChange={pagination.goToPage}
 *   onPageSizeChange={pagination.setPageSize}
 * />
 * ```
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { safeGetItem, safeSetItem } from "../lib/utils";
import type { PaginationParams } from "../types";
import { listViewKey } from "./usePersistentState";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { PaginationParams };

export interface PaginationControls {
  /** Navigate to a specific page */
  goToPage: (page: number) => void;
  /** Change the page size (resets to page 1) */
  setPageSize: (pageSize: number) => void;
  /** Go to the first page */
  goToFirst: () => void;
  /** Go to the last page */
  goToLast: (totalPages: number) => void;
  /** Go to the next page */
  goToNext: (totalPages: number) => void;
  /** Go to the previous page */
  goToPrev: () => void;
  /** Reset to defaults */
  reset: () => void;
}

export interface UsePaginationOptions {
  /** Default page number (1-indexed). Default: 1 */
  defaultPage?: number;
  /** Default page size. Default: 20 */
  defaultPageSize?: number;
  /** Allowed page size options for the selector. Default: [10, 20, 50, 100] */
  pageSizeOptions?: number[];
  /**
   * Resource id for localStorage persistence of `{ page, pageSize }`
   * (key: `kim:listView:<storageKey>:page`). When omitted the hook is fully
   * in-memory (existing behavior).
   */
  storageKey?: string;
}

// ---------------------------------------------------------------------------
// Storage (opt-in via `storageKey`)
// ---------------------------------------------------------------------------

function readStoredPagination(key: string): { page?: unknown; pageSize?: unknown } {
  const raw = safeGetItem(key);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as { page?: unknown; pageSize?: unknown };
    }
  } catch {
    // Malformed JSON — treat as empty
  }
  return {};
}

function validStoredPage(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : fallback;
}

function validStoredPageSize(value: unknown, fallback: number, options: number[]): number {
  return typeof value === "number" && Number.isInteger(value) && options.includes(value) ? value : fallback;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePagination(options: UsePaginationOptions = {}): {
  page: number;
  pageSize: number;
  /** Effective default page (the option value, or 1). */
  defaultPage: number;
  /** Effective default page size (the option value, or 20). */
  defaultPageSize: number;
  params: PaginationParams;
  pageSizeOptions: number[];
} & PaginationControls {
  const { defaultPage = 1, defaultPageSize = 20, pageSizeOptions = [10, 20, 50, 100], storageKey } = options;
  const pageKey = storageKey != null ? listViewKey(storageKey, "page") : null;

  const [page, setPage] = useState(() =>
    pageKey != null ? validStoredPage(readStoredPagination(pageKey).page, defaultPage) : defaultPage
  );
  const [pageSize, setPageSizeState] = useState(() =>
    pageKey != null ? validStoredPageSize(readStoredPagination(pageKey).pageSize, defaultPageSize, pageSizeOptions) : defaultPageSize
  );

  // Persist when storage is enabled (the mount-time write is the same
  // best-effort re-persist the other preference hooks do).
  useEffect(() => {
    if (pageKey != null) safeSetItem(pageKey, JSON.stringify({ page, pageSize }));
  }, [pageKey, page, pageSize]);

  const params = useMemo((): PaginationParams => ({ page, page_size: pageSize }), [page, pageSize]);

  /* ── Navigation ─────────────────────────────────────────── */

  const goToPage = useCallback((target: number) => {
    setPage(Math.max(1, target));
  }, []);

  const setPageSize = useCallback((newSize: number) => {
    setPageSizeState(newSize);
    setPage(1);
  }, []);

  const goToFirst = useCallback(() => setPage(1), []);
  const goToLast = useCallback((_totalPages: number) => setPage(Math.max(_totalPages, 1)), []);
  const goToNext = useCallback((_totalPages: number) => setPage((p) => (p + 1 <= _totalPages ? p + 1 : p)), []);
  const goToPrev = useCallback(() => setPage((p) => Math.max(p - 1, 1)), []);

  const reset = useCallback(() => {
    setPage(defaultPage);
    setPageSizeState(defaultPageSize);
  }, [defaultPage, defaultPageSize]);

  return {
    page,
    pageSize,
    defaultPage,
    defaultPageSize,
    params,
    pageSizeOptions,
    goToPage,
    setPageSize,
    goToFirst,
    goToLast,
    goToNext,
    goToPrev,
    reset,
  };
}

// ---------------------------------------------------------------------------
// Page clamping for persisted views
// ---------------------------------------------------------------------------

/**
 * usePageClamp — pull a persisted page back inside the data's range.
 *
 * A persisted page can go stale (rows deleted, or the list shrank for any
 * other reason): the saved page then points past the last page, the list
 * renders its empty state, and the pagination bar shows an inverted
 * "Showing X–Y of Z" range. Once the list response reports a positive page
 * count, clamp the page to the last valid one (one extra fetch for the
 * stale view, only).
 *
 * Pass `getPaginationInfo(...).totalPages`: it is 0 both while loading and
 * for a legitimately empty list, so the clamp stays a no-op in both cases —
 * for an empty list the page is kept so a later filter change can restore it.
 */
export function usePageClamp(totalPages: number, page: number, goToPage: (page: number) => void): void {
  useEffect(() => {
    if (totalPages >= 1 && page > totalPages) {
      goToPage(totalPages);
    }
  }, [totalPages, page, goToPage]);
}

// ---------------------------------------------------------------------------
// Derived info helper (not a hook — pure computation)
// ---------------------------------------------------------------------------

/**
 * Compute derived pagination info from a list response and current page size.
 *
 * Use this to pass `totalPages`, `hasPrev`, `hasNext` to the `<Pagination>`
 * component without creating circular dependencies.
 */
export function getPaginationInfo(
  total: number,
  page: number,
  pageSize: number
): {
  totalPages: number;
  hasPrev: boolean;
  hasNext: boolean;
} {
  const totalPages = Math.ceil(total / pageSize) || 0;
  return {
    totalPages,
    hasPrev: page > 1,
    hasNext: page < totalPages,
  };
}
