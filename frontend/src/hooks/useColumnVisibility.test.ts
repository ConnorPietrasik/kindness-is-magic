import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useColumnVisibility } from "./useColumnVisibility";

afterEach(() => {
  localStorage.clear();
});

describe("useColumnVisibility", () => {
  it("returns default visible columns when localStorage is empty", () => {
    const { result } = renderHook(() => useColumnVisibility("adminReferrers"));

    expect(result.current.visibleColumns).toEqual(["name", "family_limit"]);
  });

  it("restores columns from localStorage", () => {
    localStorage.setItem("kim:columns:adminReferrers", JSON.stringify(["name", "phone_number", "created_at"]));

    const { result } = renderHook(() => useColumnVisibility("adminReferrers"));

    expect(result.current.visibleColumns).toEqual(["name", "phone_number", "created_at"]);
  });

  it("filters out invalid/stale keys from stored data", () => {
    localStorage.setItem("kim:columns:adminReferrers", JSON.stringify(["name", "nonexistent_field", "family_limit"]));

    const { result } = renderHook(() => useColumnVisibility("adminReferrers"));

    expect(result.current.visibleColumns).toEqual(["name", "family_limit"]);
  });

  it("saves to localStorage on toggle", () => {
    const { result } = renderHook(() => useColumnVisibility("adminReferrers"));

    act(() => {
      result.current.toggleColumn("phone_number");
    });

    expect(result.current.visibleColumns).toContain("phone_number");
    expect(localStorage.getItem("kim:columns:adminReferrers")).toBe(JSON.stringify(["name", "family_limit", "phone_number"]));
  });

  it("removes column on toggle when already visible", () => {
    const { result } = renderHook(() => useColumnVisibility("adminReferrers"));

    act(() => {
      result.current.toggleColumn("name");
    });

    expect(result.current.visibleColumns).not.toContain("name");
  });

  it("resolves COLUMN_FIELD_MAP aliases in apiColumns", () => {
    const { result } = renderHook(() => useColumnVisibility("adminUsers"));

    // linked_to resolves to referrer_name + family_name
    expect(result.current.apiColumns).toContain("referrer_name");
    expect(result.current.apiColumns).toContain("family_name");
    // referrer_id and family_id are not in visibleColumns by default, so not resolved
    expect(result.current.apiColumns).not.toContain("referrer_id");
    expect(result.current.apiColumns).not.toContain("family_id");
  });

  it("always includes id in apiColumns for all resources", () => {
    const resources = ["adminReferrers", "adminFamilies", "adminPeople", "adminUsers", "adminWishes", "adminInvites"];

    for (const resource of resources) {
      const { result } = renderHook(() => useColumnVisibility(resource));
      expect(result.current.apiColumns).toContain("id");
    }
  });

  it("always includes wishes in apiColumns for adminPeople only", () => {
    const { result: peopleResult } = renderHook(() => useColumnVisibility("adminPeople"));
    expect(peopleResult.current.apiColumns).toContain("wishes");

    const { result: familiesResult } = renderHook(() => useColumnVisibility("adminFamilies"));
    expect(familiesResult.current.apiColumns).not.toContain("wishes");
  });

  it("resetToDefaults restores the default set", () => {
    localStorage.setItem("kim:columns:adminReferrers", JSON.stringify(["phone_number", "created_at"]));

    const { result } = renderHook(() => useColumnVisibility("adminReferrers"));
    expect(result.current.visibleColumns).toEqual(["phone_number", "created_at"]);

    act(() => {
      result.current.resetToDefaults();
    });

    expect(result.current.visibleColumns).toEqual(["name", "family_limit"]);
  });

  it("handles malformed localStorage data gracefully", () => {
    localStorage.setItem("kim:columns:adminReferrers", "not valid json");

    const { result } = renderHook(() => useColumnVisibility("adminReferrers"));

    expect(result.current.visibleColumns).toEqual(["name", "family_limit"]);
  });

  it("exposes defs matching the column registry", () => {
    const { result } = renderHook(() => useColumnVisibility("adminReferrers"));

    expect(result.current.defs).toHaveLength(8);
    expect(result.current.defs[0]).toEqual({ key: "name", label: "Name", visible: true });
  });

  it("setVisibleColumns updates state, persists and dispatches event", () => {
    const { result } = renderHook(() => useColumnVisibility("adminReferrers"));
    const handler = vi.fn();
    window.addEventListener("kim:column-visibility-change", handler);

    act(() => {
      result.current.setVisibleColumns(["name", "phone_number"]);
    });

    expect(result.current.visibleColumns).toEqual(["name", "phone_number"]);
    expect(localStorage.getItem("kim:columns:adminReferrers")).toBe(JSON.stringify(["name", "phone_number"]));
    expect(handler).toHaveBeenCalledTimes(1);
    const callArg = handler.mock.calls[0]![0] as CustomEvent<{ resourceKey: string; columns: string[] }>;
    const detail = callArg.detail;
    expect(detail.resourceKey).toBe("adminReferrers");
    expect(detail.columns).toEqual(["name", "phone_number"]);

    window.removeEventListener("kim:column-visibility-change", handler);
  });

  it("syncs state when another instance dispatches a matching event", () => {
    // First instance (e.g. the page)
    const { result: pageResult } = renderHook(() => useColumnVisibility("adminReferrers"));
    expect(pageResult.current.visibleColumns).toEqual(["name", "family_limit"]);

    // Simulate another instance (e.g. ColumnToggle) dispatching an event
    act(() => {
      window.dispatchEvent(
        new CustomEvent("kim:column-visibility-change", {
          detail: { resourceKey: "adminReferrers", columns: ["name", "phone_number"] },
        })
      );
    });

    expect(pageResult.current.visibleColumns).toEqual(["name", "phone_number"]);
  });

  it("ignores events for other resource keys", () => {
    const { result } = renderHook(() => useColumnVisibility("adminReferrers"));

    act(() => {
      window.dispatchEvent(
        new CustomEvent("kim:column-visibility-change", {
          detail: { resourceKey: "adminFamilies", columns: ["different", "columns"] },
        })
      );
    });

    expect(result.current.visibleColumns).toEqual(["name", "family_limit"]);
  });
});
