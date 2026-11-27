import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { listViewKey, usePersistentState } from "./usePersistentState";

const KEY = "kim:listView:testPage:filters";

afterEach(() => {
  localStorage.clear();
});

describe("listViewKey", () => {
  it("builds namespaced keys", () => {
    expect(listViewKey("adminFamilies", "page")).toBe("kim:listView:adminFamilies:page");
    expect(listViewKey("adminFamilies", "tab")).toBe("kim:listView:adminFamilies:tab");
    expect(listViewKey("adminFamilies", "filters")).toBe("kim:listView:adminFamilies:filters");
  });
});

describe("usePersistentState", () => {
  const DEFAULTS = { search: "", sort: null as string | null, min: "" as string };

  /* ── Init ─────────────────────────────────────────────── */

  it("returns defaults when nothing is stored", () => {
    const { result } = renderHook(() => usePersistentState(KEY, DEFAULTS));

    expect(result.current[0]).toEqual(DEFAULTS);
  });

  it("hydrates from stored values, merging over defaults", () => {
    localStorage.setItem(KEY, JSON.stringify({ search: "milk" }));

    const { result } = renderHook(() => usePersistentState(KEY, DEFAULTS));

    expect(result.current[0]).toEqual({ search: "milk", sort: null, min: "" });
  });

  it("drops unknown keys from stored data", () => {
    localStorage.setItem(KEY, JSON.stringify({ search: "milk", bogus: 42 }));

    const { result } = renderHook(() => usePersistentState(KEY, DEFAULTS));

    // Known key survives with its stored value; the unknown key is dropped.
    expect(result.current[0]).toEqual({ search: "milk", sort: null, min: "" });
  });

  it("falls back to defaults on malformed JSON", () => {
    localStorage.setItem(KEY, "{not json");

    const { result } = renderHook(() => usePersistentState(KEY, DEFAULTS));

    expect(result.current[0]).toEqual(DEFAULTS);
  });

  it("falls back to defaults when the stored value is not an object", () => {
    localStorage.setItem(KEY, JSON.stringify([1, 2, 3]));

    const { result } = renderHook(() => usePersistentState(KEY, DEFAULTS));

    expect(result.current[0]).toEqual(DEFAULTS);
  });

  it("drops stored keys that only exist on Object.prototype (no sanitizer)", () => {
    // Raw JSON: __proto__/constructor parse as OWN properties, but they must
    // not merge in — `__proto__` assignment would invoke the prototype setter.
    localStorage.setItem(KEY, '{"search":"safe","constructor":"hijack","__proto__":{"search":"hijacked"}}');

    const { result } = renderHook(() => usePersistentState(KEY, DEFAULTS));

    expect(result.current[0]).toEqual({ search: "safe", sort: null, min: "" });
    // The state object's prototype is untouched
    expect(Object.getPrototypeOf(result.current[0])).toBe(Object.prototype);
  });

  it("applies the sanitizer to narrow stored values", () => {
    const sanitize = (raw: unknown) => {
      const r = raw as Record<string, unknown>;
      return {
        sort: r.sort === "asc" || r.sort === "desc" ? r.sort : undefined,
        min: typeof r.min === "string" ? r.min : undefined,
      };
    };
    localStorage.setItem(KEY, JSON.stringify({ sort: "bogus", min: 7 }));

    const { result } = renderHook(() => usePersistentState(KEY, { sort: "" as string, min: "" as string }, sanitize));

    expect(result.current[0]).toEqual({ sort: "", min: "" });
  });
});

describe("usePersistentState — writes", () => {
  const DEFAULTS = { search: "", count: 0 };

  afterEach(() => {
    localStorage.clear();
  });

  it("persists on change", () => {
    const { result } = renderHook(() => usePersistentState(KEY, DEFAULTS));

    act(() => {
      result.current[1]((prev) => ({ ...prev, search: "toys", count: 3 }));
    });

    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ search: "toys", count: 3 });
  });

  it("persists functional updates against the latest value", () => {
    const { result } = renderHook(() => usePersistentState(KEY, DEFAULTS));

    act(() => {
      result.current[1]((prev) => ({ ...prev, count: prev.count + 1 }));
      result.current[1]((prev) => ({ ...prev, count: prev.count + 1 }));
    });

    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ search: "", count: 2 });
  });

  it("writes the current value back on mount (best-effort re-persist)", () => {
    localStorage.setItem(KEY, JSON.stringify({ search: "saved" }));

    renderHook(() => usePersistentState(KEY, DEFAULTS));

    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ search: "saved", count: 0 });
  });
});
