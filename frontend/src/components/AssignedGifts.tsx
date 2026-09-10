/**
 * AssignedGiftsView — shared "assigned gifts" wish list.
 *
 * Used by AdminAssignedGifts (scoped to the current admin via the admin
 * endpoint's `assigned_to_id` filter) and PurchaserAssignedGifts (scoped to
 * the current purchaser by the purchaser endpoint itself). Owns the list
 * query (via useCrudManager, update-only), checkbox selection, the
 * mark-purchased and batch-mark-purchased mutations + dialogs, and the
 * inline edit form for the purchase-tracking fields (purchaser note,
 * received at). The page supplies the chrome (HeaderBar, <main> — including
 * the useTableWidth width class, which syncs with the view's ColumnToggle
 * via window events), config (API functions, query keys, heading/copy, the
 * column resource key, the family column), and the family cell renderer.
 *
 * Spreadsheet columns mirror the admin Manage Wishes pattern: per-column
 * filter inputs in the headers, click-to-sort (asc → desc → clear),
 * drag/arrow-key column rearranging with per-user persistence, and the
 * column-visibility gear. Each page persists under its own resource key.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "../context/ToastContext";
import { useColumnOrder } from "../hooks/useColumnOrder";
import { useColumnVisibility } from "../hooks/useColumnVisibility";
import { useCrudManager } from "../hooks/useCrudManager";
import { useDebouncedState } from "../hooks/useDebouncedState";
import { getPaginationInfo, usePagination } from "../hooks/usePagination";
import { formatDateTime, normalizeUpdatePayload } from "../lib/utils";
import type { WishBatchMarkPurchased, WishDetail, WishPurchaseMark, WishType } from "../types";
import type { ColumnDef } from "../types/columns";
import { BatchMarkPurchasedDialog } from "./BatchMarkPurchasedDialog";
import { Button } from "./Button";
import { Card } from "./Card";
import { ColumnHeader } from "./ColumnHeader";
import { ColumnToggle } from "./ColumnToggle";
import { DatePicker } from "./DatePicker";
import { DraggableTh } from "./DraggableTh";
import { MarkPurchasedDialog, type MarkPurchasedDialogWish } from "./MarkPurchasedDialog";
import { MutationErrors } from "./MutationErrors";
import { OptionalLabel } from "./OptionalLabel";
import { Pagination } from "./Pagination";
import { PageSpinner, Spinner } from "./Spinner";
import { Table, TableBody, TableHead, Td, Th, Tr } from "./Table";
import { WishTypeBadge } from "./WishTypeBadge";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/**
 * Minimal wish shape required by the assigned-gifts table and dialogs
 * (satisfied by both WishListSummary and PurchaserWishSummary).
 */
export interface AssignedGiftRow extends MarkPurchasedDialogWish {
  id: number;
  display_id: string | null;
  type: WishType;
  description: string;
  size: string | null;
  color: string | null;
}

/** List params built by this component (filters only — scoping is up to the page's listFn). */
export interface AssignedGiftsListParams {
  page: number;
  page_size: number;
  purchased?: string;
  search?: string;
  wish_type?: string;
  sort?: string;
  // Per-column text search
  description?: string;
  size?: string;
  color?: string;
  person_given_name?: string;
  family_name?: string;
  purchased_where?: string;
  purchaser_note?: string;
  // Per-column date ranges (YYYY-MM-DD, inclusive UTC day boundaries)
  purchased_at_from?: string;
  purchased_at_to?: string;
  received_at_from?: string;
  received_at_to?: string;
}

/** Internal form state — only the purchase-tracking fields this view edits. */
export interface AssignedGiftsEditFormState {
  purchaser_note: string;
  received_at: string;
}

export interface AssignedGiftsViewProps<
  ListResponse extends { wishes: AssignedGiftRow[]; total: number } = { wishes: AssignedGiftRow[]; total: number },
> {
  /** Page heading. */
  title: string;
  /** Empty-state text. */
  emptyMessage: string;
  /** Query key for the list (from `queryKeys.ts`). */
  rootKey: readonly string[];
  /** Query key factory for a single wish detail. */
  detailKey: (id: number) => readonly unknown[];
  /** Query keys to invalidate after mutations. */
  invalidationKeys: (string | readonly string[])[];
  /**
   * Fetch the list. The page wraps its API function to add scoping
   * (e.g. admin: `{ ...params, assigned_to_id: user.id }`).
   */
  listFn: (params: AssignedGiftsListParams) => Promise<ListResponse>;
  /**
   * Column registry key for visibility/order/width persistence —
   * "adminAssignedGifts" or "purchaserAssignedGifts" (separate entries: the
   * family column key differs per page).
   */
  columnResourceKey: "adminAssignedGifts" | "purchaserAssignedGifts";
  /**
   * Family column config. Admin: key "family_name", text filter + sort.
   * Purchaser: key "family_display_id", no filter, no sort (presentational
   * only — purchaser responses carry no family PII).
   */
  familyColumn: { key: string; sortable: boolean };
  /** Fetch a single wish by id (for the inline edit form). */
  detailFn: (id: number) => Promise<WishDetail>;
  /** Update the purchase-tracking fields on a wish. */
  updateFn: (id: number, data: Partial<AssignedGiftsEditFormState>) => Promise<WishDetail>;
  /** Mark a single wish as purchased. */
  markPurchasedFn: (id: number, data: WishPurchaseMark) => Promise<WishDetail>;
  /** Batch-mark selected wishes as purchased. */
  batchMarkPurchasedFn: (payload: WishBatchMarkPurchased) => Promise<{ marked_count: number }>;
  /**
   * Family cell (admin: link to the admin family people page;
   * purchaser: link to the public wishlist when admin-locked).
   */
  renderFamilyCell: (wish: ListResponse["wishes"][number]) => React.ReactNode;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

const DEFAULT_PAGE_SIZE = 50;

/**
 * Per-column search for the assigned-gifts table: column key → input kind.
 * Keys absent from the map get no search input ("type" is sortable only, the
 * purchaser family column is presentational only); "display_id" is neither
 * searchable nor sortable. Text inputs filter via the list-param field of
 * the same name; date columns send `<field>_from` / `<field>_to`.
 */
const ASSIGNED_GIFTS_COLUMN_SEARCH: Record<string, "text" | "date"> = {
  person_given_name: "text",
  family_name: "text",
  description: "text",
  size: "text",
  color: "text",
  purchased_at: "date",
  purchased_where: "text",
  received_at: "date",
  purchaser_note: "text",
};

export function AssignedGiftsView<
  ListResponse extends { wishes: AssignedGiftRow[]; total: number } = { wishes: AssignedGiftRow[]; total: number },
>({
  title,
  emptyMessage,
  rootKey,
  detailKey,
  invalidationKeys,
  listFn,
  columnResourceKey,
  familyColumn,
  detailFn,
  updateFn,
  markPurchasedFn,
  batchMarkPurchasedFn,
  renderFamilyCell,
}: AssignedGiftsViewProps<ListResponse>) {
  const [purchasedFilter, setPurchasedFilter] = useState<string>("all");
  const [wishTypeFilter, setWishTypeFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<string>("");
  // Per-column search: one record keyed by list-param field (date inputs use
  // `<field>_from` / `<field>_to`); empty entries are omitted from list params.
  const [columnSearch, setColumnSearch] = useState<Record<string, string>>({});
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [batchMarkOpen, setBatchMarkOpen] = useState(false);
  const [markPurchasedId, setMarkPurchasedId] = useState<number | null>(null);

  const pagination = usePagination({ defaultPageSize: DEFAULT_PAGE_SIZE });
  const queryClient = useQueryClient();
  const toast = useToast();

  // Debounce search so the list doesn't refetch on every keystroke
  const debouncedSearch = useDebouncedState(searchQuery, 1000, () => pagination.goToPage(1));
  const debouncedColumnSearch = useDebouncedState(columnSearch, 1000, () => pagination.goToPage(1));

  const updateColumnSearch = useCallback((key: string, value: string) => {
    setColumnSearch((prev) => ({ ...prev, [key]: value }));
  }, []);

  // Sort: clicking a column header cycles asc → desc → clear (grouped-by-family default)
  const handleSortClick = (field: string) => {
    setSortField((prev) => {
      if (prev === field) return `-${field}`;
      if (prev === `-${field}`) return "";
      return field;
    });
    pagination.goToPage(1);
  };

  // Column visibility + user column order (each page persists under its own key)
  const { visibleColumns, defs } = useColumnVisibility(columnResourceKey);
  const { orderedKeys, reorder, moveBy, resetOrder, isDefaultOrder } = useColumnOrder(columnResourceKey, visibleColumns);

  // Visible columns in the user's custom order — that order is the sheet
  // layout, and the body cells render in it too.
  const displayColumns = useMemo(() => orderedKeys.filter((k) => visibleColumns.includes(k)), [orderedKeys, visibleColumns]);
  const defByKey = useMemo(() => {
    const map: Record<string, ColumnDef> = {};
    for (const d of defs) map[d.key] = d;
    return map;
  }, [defs]);

  // Drop filters for columns that are no longer visible, so a hidden column
  // can't keep filtering the list with no input left to clear it.
  useEffect(() => {
    setColumnSearch((prev) => {
      const visibleKeys = new Set<string>();
      for (const d of defs) {
        if (!visibleColumns.includes(d.key)) continue;
        const kind = ASSIGNED_GIFTS_COLUMN_SEARCH[d.key];
        if (kind === "text") visibleKeys.add(d.key);
        else if (kind === "date") {
          visibleKeys.add(`${d.key}_from`);
          visibleKeys.add(`${d.key}_to`);
        }
      }
      const kept = Object.fromEntries(Object.entries(prev).filter(([key]) => visibleKeys.has(key)));
      return Object.keys(kept).length === Object.keys(prev).length ? prev : kept;
    });
  }, [visibleColumns, defs]);

  // Per-column search params — non-empty entries only (empty → omitted)
  const columnSearchParams = useMemo(() => {
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(debouncedColumnSearch)) {
      if (value) params[key] = value;
    }
    return params;
  }, [debouncedColumnSearch]);

  // Build list params from filters
  const listParams = useMemo<AssignedGiftsListParams>(
    () => ({
      ...pagination.params,
      ...columnSearchParams,
      purchased: purchasedFilter !== "all" ? purchasedFilter : undefined,
      search: debouncedSearch || undefined,
      wish_type: wishTypeFilter || undefined,
      sort: sortField || undefined,
    }),
    [pagination.params, columnSearchParams, purchasedFilter, debouncedSearch, wishTypeFilter, sortField]
  );

  // CRUD manager — list/detail/update only (no create/delete for wishes)
  const { listData, listLoading, detail, detailLoading, updateMut, editingId, openEdit, cancelForm } = useCrudManager<
    ListResponse,
    WishDetail,
    Partial<AssignedGiftsEditFormState>,
    AssignedGiftsListParams
  >({
    rootKey,
    // useCrudManager's listFn param is optional; this view always passes
    // concrete listParams, so the fallback is unreachable.
    listFn: (params) => listFn(params ?? { page: 1, page_size: DEFAULT_PAGE_SIZE }),
    listParams,
    detailFn,
    updateFn,
    invalidationKeys,
    entityName: "Wish",
  });

  // Mark-purchased mutation
  const markPurchasedMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: WishPurchaseMark }) => markPurchasedFn(id, data),
    onSuccess: () => {
      invalidationKeys.forEach((key) => queryClient.invalidateQueries({ queryKey: Array.isArray(key) ? key : [key] }));
      if (markPurchasedId != null) {
        queryClient.invalidateQueries({ queryKey: detailKey(markPurchasedId) });
      }
      setMarkPurchasedId(null);
      toast.success("Wish marked as purchased");
    },
  });

  // Batch mark-purchased mutation
  const batchMarkMut = useMutation({
    mutationFn: (payload: WishBatchMarkPurchased) => batchMarkPurchasedFn(payload),
    onSuccess: (data) => {
      invalidationKeys.forEach((key) => queryClient.invalidateQueries({ queryKey: Array.isArray(key) ? key : [key] }));
      setSelectedIds(new Set());
      setBatchMarkOpen(false);
      toast.success(`${data.marked_count} wish${data.marked_count > 1 ? "es" : ""} marked as purchased`);
    },
  });

  // Update handler — build typed payload from form state
  function handleUpdateWish(formData: AssignedGiftsEditFormState) {
    if (editingId == null || detail == null) return;
    // Cleared fields keep "" — the backend's sentinel for clearing.
    const payload = normalizeUpdatePayload(formData, detail);
    updateMut.mutate({ id: editingId, data: payload });
  }

  const wishes = listData?.wishes ?? [];

  // Checkbox selection helpers
  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const allSelected = wishes.every((w) => prev.has(w.id));
      if (allSelected) {
        return new Set<number>();
      }
      return new Set(wishes.map((w) => w.id));
    });
  }, [wishes]);

  const toggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Reset selection on page/filter change
  // biome-ignore lint/correctness/useExhaustiveDependencies: listParams drives re-fetch; selection must reset when it changes
  useEffect(() => {
    setSelectedIds(new Set());
  }, [listParams]);

  const pageInfo = useMemo(
    () => getPaginationInfo(listData?.total ?? 0, pagination.page, pagination.pageSize),
    [listData?.total, pagination.page, pagination.pageSize]
  );

  // Reset page on filter change
  const resetPage = () => {
    pagination.goToPage(1);
  };

  if (listLoading) return <PageSpinner />;

  return (
    <>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-xl font-bold text-violet-950">{title}</h2>
        <div className="flex items-center gap-3">
          {!isDefaultOrder && (
            <Button variant="secondary" onClick={resetOrder}>
              Reset order
            </Button>
          )}
          <ColumnToggle resourceKey={columnResourceKey} />
          <Button onClick={() => setBatchMarkOpen(true)} disabled={selectedIds.size === 0 || batchMarkMut.isPending}>
            Mark Purchased ({selectedIds.size})
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <select
          aria-label="Purchased filter"
          value={purchasedFilter}
          onChange={(e) => {
            setPurchasedFilter(e.target.value);
            resetPage();
          }}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
        >
          <option value="all">All statuses</option>
          <option value="false">Unpurchased</option>
          <option value="true">Purchased</option>
        </select>

        <select
          aria-label="Wish type filter"
          value={wishTypeFilter}
          onChange={(e) => {
            setWishTypeFilter(e.target.value);
            resetPage();
          }}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
        >
          <option value="">All types</option>
          <option value="adult">Adult</option>
          <option value="practical">Practical</option>
          <option value="fun">Fun</option>
          <option value="family">Family</option>
        </select>

        <input
          type="text"
          placeholder="Search wishes…"
          aria-label="Search wishes"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
          }}
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
          autoComplete="off"
        />
      </div>

      {/* Table */}
      {wishes.length === 0 ? (
        <Card>
          <p className="py-8 text-center text-gray-400">{emptyMessage}</p>
        </Card>
      ) : (
        <Table>
          <TableHead>
            <Th>
              <input
                type="checkbox"
                checked={wishes.length > 0 && wishes.every((w) => selectedIds.has(w.id))}
                onChange={toggleSelectAll}
                className="h-4 w-4 rounded border-gray-300 text-btn-start focus:ring-btn-start"
                aria-label="Select all wishes on this page"
              />
            </Th>
            {displayColumns.map((key) => (
              <DraggableTh key={key} unit={[key]} onReorder={reorder} onMoveBy={moveBy}>
                {key === "display_id" ? (
                  <span>ID</span>
                ) : key === familyColumn.key && !familyColumn.sortable ? (
                  <span>{defByKey[key]?.label ?? key}</span>
                ) : (
                  <ColumnHeader
                    label={defByKey[key]?.label ?? key}
                    field={key}
                    searchKind={ASSIGNED_GIFTS_COLUMN_SEARCH[key]}
                    sortField={sortField}
                    columnSearch={columnSearch}
                    onSort={handleSortClick}
                    onSearchChange={updateColumnSearch}
                  />
                )}
              </DraggableTh>
            ))}
            <Th>Actions</Th>
          </TableHead>
          <TableBody>
            {wishes.map((w) => {
              // Body cells in the user's column order — the family cell is
              // keyed per page (admin: family_name, purchaser: family_display_id).
              const wishCells: Record<string, React.ReactNode> = {
                display_id: <Td className="whitespace-nowrap font-mono text-xs">{w.display_id ?? "—"}</Td>,
                person_given_name: <Td>{w.person_given_name ?? "Family"}</Td>,
                [familyColumn.key]: <Td>{renderFamilyCell(w)}</Td>,
                type: (
                  <Td>
                    <WishTypeBadge type={w.type} />
                  </Td>
                ),
                description: <Td className="max-w-xs truncate">{w.description}</Td>,
                size: <Td>{w.size ?? "—"}</Td>,
                color: <Td>{w.color ?? "—"}</Td>,
                purchased_at: (
                  <Td>
                    {w.purchased_at ? (
                      <span className="text-xs text-green-700" title={formatDateTime(w.purchased_at)}>
                        ✓ {formatDateTime(w.purchased_at)}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </Td>
                ),
                purchased_where: <Td className="max-w-xs text-xs truncate">{w.purchased_where || "—"}</Td>,
                received_at: (
                  <Td className="text-xs text-gray-500">{w.received_at ? new Date(w.received_at).toLocaleDateString() : "—"}</Td>
                ),
                purchaser_note: <Td className="max-w-xs text-xs truncate">{w.purchaser_note || "—"}</Td>,
              };
              return (
                <React.Fragment key={w.id}>
                  <Tr>
                    <Td>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(w.id)}
                        onChange={() => toggleSelect(w.id)}
                        className="h-4 w-4 rounded border-gray-300 text-btn-start focus:ring-btn-start"
                        aria-label={`Select wish for ${w.person_given_name ?? "Family"}`}
                      />
                    </Td>
                    {displayColumns.map((key) => (
                      <React.Fragment key={key}>{wishCells[key]}</React.Fragment>
                    ))}
                    <Td>
                      <div className="flex gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          className="px-3 py-1.5 text-xs"
                          onClick={() => (editingId === w.id ? cancelForm() : openEdit(w.id))}
                        >
                          {editingId === w.id ? "Done" : "Edit"}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="px-3 py-1.5 text-xs"
                          onClick={() => setMarkPurchasedId(w.id)}
                          disabled={w.purchased_at != null || markPurchasedMut.isPending}
                        >
                          Mark Purchased
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                  {editingId === w.id && (
                    <Tr key={`${w.id}-edit`}>
                      <Td colSpan={displayColumns.length + 2} className="!py-3">
                        <div className="rounded-xl bg-gray-50 p-4">
                          {detailLoading ? (
                            <div className="flex items-center justify-center gap-3 py-6 text-btn-start">
                              <Spinner size="sm" />
                              <span className="text-sm font-medium">Loading…</span>
                            </div>
                          ) : detail ? (
                            <AssignedGiftsEditForm
                              wish={detail}
                              onSave={handleUpdateWish}
                              onCancel={cancelForm}
                              loading={updateMut.isPending}
                            />
                          ) : null}
                        </div>
                      </Td>
                    </Tr>
                  )}
                </React.Fragment>
              );
            })}
          </TableBody>
        </Table>
      )}

      {/* Pagination */}
      <Pagination
        page={pagination.page}
        totalPages={pageInfo.totalPages}
        total={listData?.total ?? 0}
        pageSize={pagination.pageSize}
        onPageChange={pagination.goToPage}
        onPageSizeChange={pagination.setPageSize}
      />

      {/* Mark-purchased dialog — the list row already carries all fields */}
      <MarkPurchasedDialog
        open={markPurchasedId !== null}
        wish={wishes.find((w) => w.id === markPurchasedId) ?? null}
        onSubmit={(data) => {
          if (markPurchasedId != null) {
            markPurchasedMut.mutate({ id: markPurchasedId, data });
          }
        }}
        onCancel={() => setMarkPurchasedId(null)}
        loading={markPurchasedMut.isPending}
      />

      {/* Batch mark-purchased dialog */}
      <BatchMarkPurchasedDialog
        open={batchMarkOpen}
        wishIds={Array.from(selectedIds)}
        onSubmit={(data) => batchMarkMut.mutate(data)}
        onCancel={() => setBatchMarkOpen(false)}
        loading={batchMarkMut.isPending}
      />

      {/* Errors */}
      <MutationErrors mutations={[updateMut, markPurchasedMut, batchMarkMut]} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* AssignedGiftsEditForm — inline edit for purchaser_note + received_at */
/* ------------------------------------------------------------------ */

interface AssignedGiftsEditFormProps {
  wish: WishDetail;
  onSave: (data: AssignedGiftsEditFormState) => void;
  onCancel: () => void;
  loading: boolean;
}

function AssignedGiftsEditForm({ wish, onSave, onCancel, loading }: AssignedGiftsEditFormProps) {
  const [form, setForm] = useState<AssignedGiftsEditFormState>(() => ({
    purchaser_note: wish.purchaser_note ?? "",
    received_at: wish.received_at ?? "",
  }));

  useEffect(() => {
    setForm({
      purchaser_note: wish.purchaser_note ?? "",
      received_at: wish.received_at ?? "",
    });
  }, [wish]);

  const update = (key: string, val: unknown) => setForm((p) => ({ ...p, [key]: val }));

  return (
    <Card className="mb-6 border border-gray-200">
      <h3 className="mb-4 text-lg font-semibold text-violet-950">Edit — Gift for {wish.person_given_name ?? "Family"}</h3>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(form);
        }}
      >
        <div className="space-y-4">
          <DatePicker label="Received At" isOptional value={form.received_at} onChange={(val) => update("received_at", val)} />

          <div>
            <OptionalLabel text="Purchaser Note" />
            <textarea
              value={form.purchaser_note}
              onChange={(e) => update("purchaser_note", e.target.value)}
              maxLength={400}
              rows={3}
              autoComplete="off"
              className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
            />
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <Button type="submit" loading={loading}>
            {loading ? "Saving…" : "Update"}
          </Button>
          <Button variant="secondary" type="button" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
