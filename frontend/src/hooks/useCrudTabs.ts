/**
 * useCrudTabs — shared Active / Deleted tab state for CRUD admin pages.
 *
 * Manages the view tab ("active" | "deleted") and optionally resets
 * pagination to page 1 when the tab switches.
 */

import { useState } from "react";

export type CrudTabView = "active" | "deleted";

export interface UseCrudTabsOptions {
  pagination?: { goToPage: (page: number) => void };
}

export interface UseCrudTabsReturn {
  viewTab: CrudTabView;
  isDeletedView: boolean;
  handleTabChange: (tab: CrudTabView) => void;
}

export function useCrudTabs(options?: UseCrudTabsOptions): UseCrudTabsReturn {
  const [viewTab, setViewTab] = useState<CrudTabView>("active");

  const isDeletedView = viewTab === "deleted";

  function handleTabChange(tab: CrudTabView) {
    setViewTab(tab);
    options?.pagination?.goToPage(1);
  }

  return { viewTab, isDeletedView, handleTabChange };
}
