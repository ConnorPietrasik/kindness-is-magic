/**
 * CrudTabs — presentational Active / Deleted tablist for CRUD admin pages.
 *
 * Pure presentational component — no state, no pagination logic.
 * ARIA: role="tablist" container, role="tab" buttons, aria-selected.
 */

import type { CrudTabView } from "../hooks/useCrudTabs";

interface CrudTabsProps {
  viewTab: CrudTabView;
  onChange: (tab: CrudTabView) => void;
}

export function CrudTabs({ viewTab, onChange }: CrudTabsProps) {
  return (
    <div role="tablist" className="mb-6 flex gap-4 border-b border-gray-200">
      {(["active", "deleted"] as const).map((tab) => (
        <button
          key={tab}
          role="tab"
          type="button"
          aria-selected={viewTab === tab}
          onClick={() => viewTab !== tab && onChange(tab)}
          className={`border-b-2 px-1 py-2 text-sm font-medium transition-colors ${
            viewTab === tab ? "border-violet-600 text-violet-700" : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          {tab === "active" ? "Active" : "Deleted"}
        </button>
      ))}
    </div>
  );
}
