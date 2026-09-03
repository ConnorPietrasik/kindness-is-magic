/**
 * ColumnHeader — sortable table column header with an optional per-column search input.
 *
 * The label button requests a sort on click (the parent owns the
 * asc → desc → clear cycle and renders state via *sortField*); the search
 * input renders per *searchKind* — "text" sends its value as one list param
 * named *field*, "date" sends `<field>_from` / `<field>_to` day params.
 * Columns without a *searchKind* (e.g. sort-only or presentational) get no
 * input.
 */

interface ColumnHeaderProps {
  label: string;
  /** List-param field (column key, except assigned_to → assigned_to_name). */
  field: string;
  /** Per-column search input kind; undefined → no input. */
  searchKind?: "text" | "date";
  /** Currently active sort field ("" → none); used to render the arrow. */
  sortField: string;
  /** Active per-column search values, keyed by list-param field. */
  columnSearch: Record<string, string>;
  onSort: (field: string) => void;
  onSearchChange: (key: string, value: string) => void;
}

export function ColumnHeader({ label, field, searchKind, sortField, columnSearch, onSort, onSearchChange }: ColumnHeaderProps) {
  const arrow = sortField === field ? "↑" : sortField === `-${field}` ? "↓" : "";
  const inputClass =
    "rounded border border-gray-200 px-1.5 py-0.5 text-xs outline-none transition-colors focus:border-btn-start focus:ring-1 focus:ring-btn-start/20";
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => onSort(field)}
        aria-label={`Sort by ${label}`}
        className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-gray-500 transition-colors hover:text-gray-700"
      >
        {label}
        {arrow && <span className="text-[10px]">{arrow}</span>}
      </button>
      {searchKind === "text" && (
        <input
          type="text"
          placeholder="Filter…"
          aria-label={`Filter by ${label}`}
          value={columnSearch[field] ?? ""}
          onChange={(e) => onSearchChange(field, e.target.value)}
          className={`w-full ${inputClass}`}
          autoComplete="off"
        />
      )}
      {searchKind === "date" && (
        <div className="flex items-center gap-1">
          <input
            type="date"
            aria-label={`${label} from`}
            value={columnSearch[`${field}_from`] ?? ""}
            onChange={(e) => onSearchChange(`${field}_from`, e.target.value)}
            className={`w-full min-w-0 ${inputClass}`}
            autoComplete="off"
          />
          <input
            type="date"
            aria-label={`${label} to`}
            value={columnSearch[`${field}_to`] ?? ""}
            onChange={(e) => onSearchChange(`${field}_to`, e.target.value)}
            className={`w-full min-w-0 ${inputClass}`}
            autoComplete="off"
          />
        </div>
      )}
    </div>
  );
}
