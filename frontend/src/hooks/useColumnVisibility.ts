/** Hook for managing per-resource column visibility with localStorage persistence. */

import { useEffect, useMemo, useState } from "react";
import { COLUMN_FIELD_MAP, COLUMNS, type ColumnDef } from "../types/columns";

const STORAGE_PREFIX = "kim:columns:";
const EVENT_TYPE = "kim:column-visibility-change";

export function useColumnVisibility(resourceKey: string) {
  const defs: ColumnDef[] = COLUMNS[resourceKey] ?? [];
  const storageKey = STORAGE_PREFIX + resourceKey;

  const getDefaultKeys = () => defs.filter((c) => c.visible).map((c) => c.key);

  const [visibleColumns, setVisibleColumnsState] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as string[];
        const validKeys = new Set(defs.map((d) => d.key));
        return parsed.filter((k) => validKeys.has(k));
      }
    } catch {
      // ignore malformed data
    }
    return getDefaultKeys();
  });

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(visibleColumns));
  }, [storageKey, visibleColumns]);

  // Listen for changes from other hook instances (e.g. ColumnToggle applying changes)
  useEffect(() => {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<{ resourceKey: string; columns: string[] }>;
      if (customEvent.detail.resourceKey === resourceKey) {
        setVisibleColumnsState(customEvent.detail.columns);
      }
    };
    window.addEventListener(EVENT_TYPE, handler);
    return () => window.removeEventListener(EVENT_TYPE, handler);
  }, [resourceKey]);

  /** Internal setter that persists + dispatches a sync event for other hook instances. */
  const setVisibleColumns = (columns: string[]) => {
    localStorage.setItem(storageKey, JSON.stringify(columns));
    window.dispatchEvent(new CustomEvent(EVENT_TYPE, { detail: { resourceKey, columns } }));
    setVisibleColumnsState(columns);
  };

  const toggleColumn = (key: string) => {
    const next = visibleColumns.includes(key) ? visibleColumns.filter((k) => k !== key) : [...visibleColumns, key];
    setVisibleColumns(next);
  };

  const resetToDefaults = () => setVisibleColumns(getDefaultKeys());

  const apiColumns = useMemo(() => {
    const resolved = new Set<string>();
    for (const key of visibleColumns) {
      const fields = COLUMN_FIELD_MAP[key];
      if (fields) fields.forEach((f) => resolved.add(f));
      else resolved.add(key);
    }
    resolved.add("id"); // always needed for mutations
    // "wishes" always sent for people — needed for wish cells AND detail/edit
    if (resourceKey === "adminPeople") resolved.add("wishes");
    // "family_count" always sent for referrers — needed for "X / Y" display in family_limit column
    if (resourceKey === "adminReferrers") resolved.add("family_count");
    return Array.from(resolved);
  }, [resourceKey, visibleColumns]);

  return { visibleColumns, apiColumns, toggleColumn, resetToDefaults, setVisibleColumns, defs };
}
