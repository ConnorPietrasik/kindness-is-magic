import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCrudTabs } from "./useCrudTabs";
import { listViewKey } from "./usePersistentState";

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

  /* ── localStorage persistence (storageKey) ───────────── */

  afterEach(() => {
    localStorage.clear();
  });

  it("does not touch localStorage without a storageKey", () => {
    const { result } = renderHook(() => useCrudTabs());

    act(() => {
      result.current.handleTabChange("deleted");
    });

    expect(localStorage.length).toBe(0);
  });

  it("hydrates the tab from storage", () => {
    localStorage.setItem(listViewKey("test", "tab"), JSON.stringify("deleted"));

    const { result } = renderHook(() => useCrudTabs({ storageKey: "test" }));

    expect(result.current.viewTab).toBe("deleted");
    expect(result.current.isDeletedView).toBe(true);
  });

  it("falls back to 'active' for invalid stored values", () => {
    localStorage.setItem(listViewKey("test", "tab"), JSON.stringify("bogus"));

    const { result } = renderHook(() => useCrudTabs({ storageKey: "test" }));

    expect(result.current.viewTab).toBe("active");
  });

  it("persists tab switches to storage", () => {
    const { result } = renderHook(() => useCrudTabs({ storageKey: "test" }));

    act(() => {
      result.current.handleTabChange("deleted");
    });

    expect(JSON.parse(localStorage.getItem(listViewKey("test", "tab"))!)).toBe("deleted");
  });
});
