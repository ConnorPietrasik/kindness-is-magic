/**
 * usePersistentState — generic localStorage-backed object state.
 *
 * Same conventions as useColumnVisibility / useDashboardTiles:
 *  - `kim:<namespace>:<resource>` keys
 *  - `safeGetItem` / `safeSetItem` — never throw (blocked storage, quota)
 *  - lazy init from storage, write-on-change effect
 *
 * The stored value is a JSON object. On read it is merged over `defaults`:
 * unknown keys are dropped, missing keys fall back to defaults, and any
 * failure (missing entry, malformed JSON, non-object) yields pure defaults.
 *
 * An optional `sanitize` narrows parsed values before the merge — pages use
 * it to clamp enum-like fields (sort values, dropdown filters) to allowed
 * values so a stale/invalid stored value can never reach the API.
 *
 * @example
 * ```ts
 * const DEFAULTS = { search: "", sort: null };
 * const [view, setView] = usePersistentState(listViewKey("adminFamilies", "filters"), DEFAULTS, (raw) => {
 *   const r = raw as Record<string, unknown>;
 *   return { search: typeof r.search === "string" ? r.search : undefined, sort: ... };
 * });
 * ```
 */

import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { safeGetItem, safeSetItem } from "../lib/utils";

/** Builds a list-view storage key: `kim:listView:<resource>:<concern>`. */
export function listViewKey(resource: string, concern: "page" | "tab" | "filters"): string {
  return `kim:listView:${resource}:${concern}`;
}

/** Narrow a parsed stored object to a partial of the view (drop/fix bad values). */
export type ViewSanitizer<T extends object> = (raw: unknown) => Partial<T>;

export function usePersistentState<T extends object>(
  key: string,
  defaults: T,
  sanitize?: ViewSanitizer<T>
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    const stored = safeGetItem(key);
    if (!stored) return defaults;
    try {
      const parsed: unknown = JSON.parse(stored);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return defaults;
      const sanitized = sanitize ? sanitize(parsed) : (parsed as Partial<T>);
      // Merge over defaults: only known keys survive, missing ones keep defaults.
      // Object.keys (own keys only) — a stored `constructor`/`__proto__` key
      // must not pass just because it exists on the prototype chain, and
      // assigning `__proto__` would invoke the prototype setter.
      const merged: Record<string, unknown> = { ...(defaults as Record<string, unknown>) };
      const ownKeys = Object.keys(merged);
      for (const [k, v] of Object.entries(sanitized)) {
        if (ownKeys.includes(k) && v !== undefined) merged[k] = v;
      }
      return merged as T;
    } catch {
      // Malformed JSON — fall back to defaults
      return defaults;
    }
  });

  useEffect(() => {
    safeSetItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue];
}
