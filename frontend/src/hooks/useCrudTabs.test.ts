import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useCrudTabs } from "./useCrudTabs";

describe("useCrudTabs", () => {
  /* ── Initial state ──────────────────────────────────────── */

  it("defaults viewTab to 'active'", () => {
    const { result } = renderHook(() => useCrudTabs());

    expect(result.current.viewTab).toBe("active");
    expect(result.current.isDeletedView).toBe(false);
  });

  /* ── Tab switching ──────────────────────────────────────── */

  it("switches to 'deleted' tab", () => {
    const { result } = renderHook(() => useCrudTabs());

    act(() => {
      result.current.handleTabChange("deleted");
    });

    expect(result.current.viewTab).toBe("deleted");
    expect(result.current.isDeletedView).toBe(true);
  });

  it("switches back to 'active' tab", () => {
    const { result } = renderHook(() => useCrudTabs());

    act(() => {
      result.current.handleTabChange("deleted");
      result.current.handleTabChange("active");
    });

    expect(result.current.viewTab).toBe("active");
    expect(result.current.isDeletedView).toBe(false);
  });

  /* ── Pagination reset ───────────────────────────────────── */

  it("calls pagination.goToPage(1) when tab changes and pagination is provided", () => {
    const goToPage = vi.fn();
    const { result } = renderHook(() => useCrudTabs({ pagination: { goToPage } }));

    act(() => {
      result.current.handleTabChange("deleted");
    });

    expect(goToPage).toHaveBeenCalledWith(1);
  });

  it("does not throw when pagination is not provided", () => {
    const { result } = renderHook(() => useCrudTabs());

    expect(() => {
      act(() => {
        result.current.handleTabChange("deleted");
      });
    }).not.toThrow();
  });

  it("calls goToPage(1) on each tab switch", () => {
    const goToPage = vi.fn();
    const { result } = renderHook(() => useCrudTabs({ pagination: { goToPage } }));

    act(() => {
      result.current.handleTabChange("deleted");
    });
    act(() => {
      result.current.handleTabChange("active");
    });

    expect(goToPage).toHaveBeenCalledTimes(2);
    expect(goToPage).toHaveBeenNthCalledWith(1, 1);
    expect(goToPage).toHaveBeenNthCalledWith(2, 1);
  });
});
