/**
 * useCrudTabs — shared Active / Deleted tab state for CRUD admin pages.
 *
 * Manages the view tab ("active" | "deleted") and optionally resets
 * pagination to page 1 when the tab switches.
 */

import { useEffect, useState } from "react";
import { safeGetItem, safeSetItem } from "../lib/utils";
import { listViewKey } from "./usePersistentState";

export type CrudTabView = "active" | "deleted";

export interface UseCrudTabsOptions {
  pagination?: { goToPage: (page: number) => void };
  /**
   * Resource id for localStorage persistence of the view tab
   * (key: `kim:listView:<storageKey>:tab`). When omitted the tab is fully
   * in-memory (existing behavior).
   */
  storageKey?: string;
}

export interface UseCrudTabsReturn {
  viewTab: CrudTabView;
  isDeletedView: boolean;
  handleTabChange: (tab: CrudTabView) => void;
}

export function useCrudTabs(options?: UseCrudTabsOptions): UseCrudTabsReturn {
  const { pagination, storageKey } = options ?? {};
  const tabKey = storageKey != null ? listViewKey(storageKey, "tab") : null;

  const [viewTab, setViewTab] = useState<CrudTabView>(() => {
    if (tabKey == null) return "active";
    const stored = safeGetItem(tabKey);
    if (!stored) return "active";
    try {
      const parsed: unknown = JSON.parse(stored);
      return parsed === "deleted" || parsed === "active" ? parsed : "active";
    } catch {
      return "active";
    }
  });

  useEffect(() => {
    if (tabKey != null) safeSetItem(tabKey, JSON.stringify(viewTab));
  }, [tabKey, viewTab]);

  const isDeletedView = viewTab === "deleted";

  function handleTabChange(tab: CrudTabView) {
    setViewTab(tab);
    pagination?.goToPage(1);
  }

  return { viewTab, isDeletedView, handleTabChange };
}
