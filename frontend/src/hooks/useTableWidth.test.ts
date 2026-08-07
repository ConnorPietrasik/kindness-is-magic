import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTableWidth } from "./useTableWidth";

afterEach(() => {
  localStorage.clear();
});

describe("useTableWidth", () => {
  it("defaults to compact width when localStorage is empty", () => {
    const { result } = renderHook(() => useTableWidth("adminReferrers"));

    expect(result.current.widthMode).toBe("compact");
    expect(result.current.widthClass).toBe("max-w-[960px]");
  });

  it("restores width mode from localStorage", () => {
    localStorage.setItem("kim:tableWidth:adminReferrers", "wide");

    const { result } = renderHook(() => useTableWidth("adminReferrers"));

    expect(result.current.widthMode).toBe("wide");
    expect(result.current.widthClass).toBe("max-w-7xl");
  });

  it("defaults to compact for invalid stored values", () => {
    localStorage.setItem("kim:tableWidth:adminReferrers", "invalid");

    const { result } = renderHook(() => useTableWidth("adminReferrers"));

    expect(result.current.widthMode).toBe("compact");
  });

  it("setWidthMode updates state, persists and dispatches event", () => {
    const { result } = renderHook(() => useTableWidth("adminReferrers"));
    const handler = vi.fn();
    window.addEventListener("kim:table-width-change", handler);

    act(() => {
      result.current.setWidthMode("fit");
    });

    expect(result.current.widthMode).toBe("fit");
    expect(result.current.widthClass).toBe("max-w-fit");
    expect(localStorage.getItem("kim:tableWidth:adminReferrers")).toBe("fit");
    expect(handler).toHaveBeenCalledTimes(1);
    const callArg = handler.mock.calls[0]![0] as CustomEvent<{ resourceKey: string; mode: string }>;
    expect(callArg.detail.resourceKey).toBe("adminReferrers");
    expect(callArg.detail.mode).toBe("fit");

    window.removeEventListener("kim:table-width-change", handler);
  });

  it("syncs state when another instance dispatches a matching event", () => {
    const { result } = renderHook(() => useTableWidth("adminReferrers"));
    expect(result.current.widthMode).toBe("compact");

    act(() => {
      window.dispatchEvent(
        new CustomEvent("kim:table-width-change", {
          detail: { resourceKey: "adminReferrers", mode: "full" },
        })
      );
    });

    expect(result.current.widthMode).toBe("full");
    expect(result.current.widthClass).toBe("");
  });

  it("ignores events for other resource keys", () => {
    const { result } = renderHook(() => useTableWidth("adminReferrers"));

    act(() => {
      window.dispatchEvent(
        new CustomEvent("kim:table-width-change", {
          detail: { resourceKey: "adminFamilies", mode: "wide" },
        })
      );
    });

    expect(result.current.widthMode).toBe("compact");
  });

  it("exposes all width modes", () => {
    const { result } = renderHook(() => useTableWidth("adminReferrers"));

    expect(result.current.widthModes).toHaveLength(4);
    expect(result.current.widthModes.map((m) => m.key)).toEqual(["fit", "compact", "wide", "full"]);
  });

  it("maps width modes to correct classes", () => {
    const { result } = renderHook(() => useTableWidth("adminReferrers"));

    act(() => result.current.setWidthMode("fit"));
    expect(result.current.widthClass).toBe("max-w-fit");

    act(() => result.current.setWidthMode("compact"));
    expect(result.current.widthClass).toBe("max-w-[960px]");

    act(() => result.current.setWidthMode("wide"));
    expect(result.current.widthClass).toBe("max-w-7xl");

    act(() => result.current.setWidthMode("full"));
    expect(result.current.widthClass).toBe("");
  });
});
