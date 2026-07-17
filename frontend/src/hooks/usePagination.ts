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

import { useCallback, useMemo, useState } from "react";
import type { PaginationParams } from "../types";

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
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePagination(options: UsePaginationOptions = {}): {
  page: number;
  pageSize: number;
  params: PaginationParams;
  pageSizeOptions: number[];
} & PaginationControls {
  const { defaultPage = 1, defaultPageSize = 20, pageSizeOptions = [10, 20, 50, 100] } = options;

  const [page, setPage] = useState(defaultPage);
  const [pageSize, setPageSizeState] = useState(defaultPageSize);

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
