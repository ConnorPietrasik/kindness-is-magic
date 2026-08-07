/** Hook for managing per-resource table width preference with localStorage persistence. */

import { useEffect, useState } from "react";

const STORAGE_PREFIX = "kim:tableWidth:";
const EVENT_TYPE = "kim:table-width-change";

export type TableWidthMode = "fit" | "compact" | "wide" | "full";

const WIDTH_MODES: { key: TableWidthMode; label: string }[] = [
  { key: "fit", label: "Fit" },
  { key: "compact", label: "Compact" },
  { key: "wide", label: "Wide" },
  { key: "full", label: "Full" },
];

const WIDTH_CLASS_MAP: Record<TableWidthMode, string> = {
  fit: "max-w-fit",
  compact: "max-w-[960px]",
  wide: "max-w-7xl",
  full: "",
};

function getWidthClass(mode: TableWidthMode): string {
  return WIDTH_CLASS_MAP[mode] ?? WIDTH_CLASS_MAP.full;
}

export function useTableWidth(resourceKey: string) {
  const storageKey = STORAGE_PREFIX + resourceKey;

  const [widthMode, setWidthModeState] = useState<TableWidthMode>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored && stored in WIDTH_CLASS_MAP) {
        return stored as TableWidthMode;
      }
    } catch {
      // ignore malformed data
    }
    return "compact";
  });

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem(storageKey, widthMode);
  }, [storageKey, widthMode]);

  // Listen for changes from other hook instances (e.g. ColumnToggle applying changes)
  useEffect(() => {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<{ resourceKey: string; mode: TableWidthMode }>;
      if (customEvent.detail.resourceKey === resourceKey) {
        setWidthModeState(customEvent.detail.mode);
      }
    };
    window.addEventListener(EVENT_TYPE, handler);
    return () => window.removeEventListener(EVENT_TYPE, handler);
  }, [resourceKey]);

  const setWidthMode = (mode: TableWidthMode) => {
    localStorage.setItem(storageKey, mode);
    window.dispatchEvent(new CustomEvent(EVENT_TYPE, { detail: { resourceKey, mode } }));
    setWidthModeState(mode);
  };

  return { widthMode, widthClass: getWidthClass(widthMode), setWidthMode, widthModes: WIDTH_MODES };
}
