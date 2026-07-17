import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getPaginationInfo, usePagination } from "./usePagination";

// ---------------------------------------------------------------------------
// Tests — usePagination
// ---------------------------------------------------------------------------

describe("usePagination", () => {
  /* ── Initial state ──────────────────────────────────────── */

  it("defaults to page 1, pageSize 20", () => {
    const { result } = renderHook(() => usePagination());

    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(20);
  });

  it("uses custom defaults when provided", () => {
    const { result } = renderHook(() => usePagination({ defaultPage: 3, defaultPageSize: 50 }));

    expect(result.current.page).toBe(3);
    expect(result.current.pageSize).toBe(50);
  });

  it("returns correct params object", () => {
    const { result } = renderHook(() => usePagination());

    expect(result.current.params).toEqual({ page: 1, page_size: 20 });
  });

  it("updates params when page changes", () => {
    const { result } = renderHook(() => usePagination());

    act(() => {
      result.current.goToPage(3);
    });

    expect(result.current.params).toEqual({ page: 3, page_size: 20 });
  });

  it("updates params when pageSize changes", () => {
    const { result } = renderHook(() => usePagination());

    act(() => {
      result.current.setPageSize(50);
    });

    expect(result.current.params).toEqual({ page: 1, page_size: 50 });
  });

  /* ── Navigation ─────────────────────────────────────────── */

  it("goToPage navigates to the target page", () => {
    const { result } = renderHook(() => usePagination());

    act(() => {
      result.current.goToPage(5);
    });

    expect(result.current.page).toBe(5);
  });

  it("goToPage clamps to minimum 1", () => {
    const { result } = renderHook(() => usePagination());

    act(() => {
      result.current.goToPage(0);
    });

    expect(result.current.page).toBe(1);

    act(() => {
      result.current.goToPage(-5);
    });

    expect(result.current.page).toBe(1);
  });

  it("goToFirst goes to page 1", () => {
    const { result } = renderHook(() => usePagination());

    act(() => {
      result.current.goToPage(5);
      result.current.goToFirst();
    });

    expect(result.current.page).toBe(1);
  });

  it("goToLast goes to the given totalPages", () => {
    const { result } = renderHook(() => usePagination());

    act(() => {
      result.current.goToLast(10);
    });

    expect(result.current.page).toBe(10);
  });

  it("goToNext advances one page when under totalPages", () => {
    const { result } = renderHook(() => usePagination());

    act(() => {
      result.current.goToNext(5);
    });

    expect(result.current.page).toBe(2);
  });

  it("goToNext does not exceed totalPages", () => {
    const { result } = renderHook(() => usePagination());

    act(() => {
      result.current.goToPage(5);
      result.current.goToNext(5);
    });

    expect(result.current.page).toBe(5);
  });

  it("goToPrev goes back one page", () => {
    const { result } = renderHook(() => usePagination());

    act(() => {
      result.current.goToPage(3);
      result.current.goToPrev();
    });

    expect(result.current.page).toBe(2);
  });

  it("goToPrev does not go below page 1", () => {
    const { result } = renderHook(() => usePagination());

    act(() => {
      result.current.goToPrev();
    });

    expect(result.current.page).toBe(1);
  });

  it("setPageSize changes size and resets to page 1", () => {
    const { result } = renderHook(() => usePagination());

    act(() => {
      result.current.goToPage(3);
      result.current.setPageSize(50);
    });

    expect(result.current.pageSize).toBe(50);
    expect(result.current.page).toBe(1);
  });

  it("reset returns to defaults", () => {
    const { result } = renderHook(() => usePagination({ defaultPage: 1, defaultPageSize: 20 }));

    act(() => {
      result.current.goToPage(5);
      result.current.setPageSize(50);
      result.current.reset();
    });

    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(20);
  });

  /* ── pageSizeOptions ────────────────────────────────────── */

  it("exposes default pageSizeOptions", () => {
    const { result } = renderHook(() => usePagination());

    expect(result.current.pageSizeOptions).toEqual([10, 20, 50, 100]);
  });

  it("uses custom pageSizeOptions when provided", () => {
    const { result } = renderHook(() => usePagination({ pageSizeOptions: [5, 25, 75] }));

    expect(result.current.pageSizeOptions).toEqual([5, 25, 75]);
  });
});

// ---------------------------------------------------------------------------
// Tests — getPaginationInfo (pure function)
// ---------------------------------------------------------------------------

describe("getPaginationInfo", () => {
  it("computes totalPages correctly", () => {
    const info = getPaginationInfo(95, 1, 20);
    expect(info.totalPages).toBe(5); // ceil(95 / 20) = 5
  });

  it("computes totalPages with exact division", () => {
    const info = getPaginationInfo(80, 1, 20);
    expect(info.totalPages).toBe(4);
  });

  it("returns totalPages 0 when total is 0", () => {
    const info = getPaginationInfo(0, 1, 20);
    expect(info.totalPages).toBe(0);
  });

  it("hasPrev is false on page 1", () => {
    const info = getPaginationInfo(100, 1, 20);
    expect(info.hasPrev).toBe(false);
  });

  it("hasPrev is true after page 1", () => {
    const info = getPaginationInfo(100, 3, 20);
    expect(info.hasPrev).toBe(true);
  });

  it("hasNext is false on the last page", () => {
    const info = getPaginationInfo(40, 2, 20); // 2 pages
    expect(info.hasNext).toBe(false);
  });

  it("hasNext is true before the last page", () => {
    const info = getPaginationInfo(100, 1, 20); // 5 pages
    expect(info.hasNext).toBe(true);
  });

  it("hasNext is false when there is only one page", () => {
    const info = getPaginationInfo(15, 1, 20); // 1 page
    expect(info.hasNext).toBe(false);
  });

  it("handles single item", () => {
    const info = getPaginationInfo(1, 1, 20);
    expect(info.totalPages).toBe(1);
    expect(info.hasPrev).toBe(false);
    expect(info.hasNext).toBe(false);
  });
});
