import { memo } from "react";
import { Button } from "./Button";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PaginationProps {
  /** Current page (1-indexed) */
  page: number;
  /** Total number of pages */
  totalPages: number;
  /** Total number of items */
  total: number;
  /** Items per page */
  pageSize: number;
  /** Available page-size options for the selector */
  pageSizeOptions?: number[];
  /** Navigate to a specific page */
  onPageChange: (page: number) => void;
  /** Change the page size (resets to page 1) */
  onPageSizeChange?: (pageSize: number) => void;
}

// ---------------------------------------------------------------------------
// Page number generation (with ellipsis)
// ---------------------------------------------------------------------------

/**
 * Generate an array of page numbers / ellipsis markers for display.
 * Shows: first page, last page, current page ± 1, with ellipsis gaps.
 *
 * Examples:
 *   totalPages=1  → [1]
 *   totalPages=5, page=3 → [1, 2, 3, 4, 5]
 *   totalPages=10, page=3 → [1, 2, 3, 4, "…", 10]
 *   totalPages=20, page=10 → [1, "…", 9, 10, 11, "…", 20]
 */
function generatePageRange(page: number, totalPages: number): (number | "…")[] {
  if (totalPages <= 1) return [];
  if (totalPages <= 7) {
    // Show all pages when 7 or fewer
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const pages: (number | "…")[] = [1];

  if (page <= 3) {
    // Near the start: 1 2 3 4 … last
    for (let i = 2; i <= 4; i++) pages.push(i);
    pages.push("…", totalPages);
  } else if (page >= totalPages - 2) {
    // Near the end: 1 … last-3 last-2 last-1 last
    pages.push("…");
    for (let i = totalPages - 3; i <= totalPages; i++) pages.push(i);
  } else {
    // In the middle: 1 … page-1 page page+1 … last
    pages.push("…", page - 1, page, page + 1, "…", totalPages);
  }

  return pages;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const Pagination = memo(function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  pageSizeOptions = [10, 20, 50, 100],
  onPageChange,
  onPageSizeChange,
}: PaginationProps) {
  if (totalPages <= 1) return null;

  const pages = generatePageRange(page, totalPages);
  const startItem = (page - 1) * pageSize + 1;
  const endItem = Math.min(page * pageSize, total);

  return (
    <div className="mt-4 flex flex-col items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 sm:flex-row sm:px-6">
      {/* Item count */}
      <span className="text-sm text-gray-500">
        Showing {startItem}–{endItem} of {total}
      </span>

      {/* Page buttons */}
      <div className="flex items-center gap-1">
        <Button
          variant="secondary"
          size="sm"
          className="h-8 px-2 text-xs"
          onClick={() => onPageChange(1)}
          disabled={page === 1}
          aria-label="First page"
        >
          «
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="h-8 px-2 text-xs"
          onClick={() => onPageChange(page - 1)}
          disabled={page === 1}
          aria-label="Previous page"
        >
          ‹
        </Button>

        {pages.map((p, idx) =>
          p === "…" ? (
            <span key={`ellipsis-${idx}`} className="px-1 text-gray-400">
              …
            </span>
          ) : (
            <button
              type="button"
              key={p}
              onClick={() => onPageChange(p as number)}
              className={`flex h-8 w-8 items-center justify-center rounded-md text-sm font-medium transition-colors ${
                page === p ? "bg-btn-start text-white" : "text-gray-700 hover:bg-gray-100"
              }`}
              aria-label={`Page ${p}`}
              aria-current={page === p ? "page" : undefined}
            >
              {p}
            </button>
          )
        )}

        <Button
          variant="secondary"
          size="sm"
          className="h-8 px-2 text-xs"
          onClick={() => onPageChange(page + 1)}
          disabled={page === totalPages}
          aria-label="Next page"
        >
          ›
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="h-8 px-2 text-xs"
          onClick={() => onPageChange(totalPages)}
          disabled={page === totalPages}
          aria-label="Last page"
        >
          »
        </Button>
      </div>

      {/* Page size selector */}
      {onPageSizeChange && (
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span>Per page:</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(parseInt(e.target.value, 10))}
            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm focus:border-btn-start focus:outline-none focus:ring-1 focus:ring-btn-start/50"
            aria-label="Items per page"
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
});
