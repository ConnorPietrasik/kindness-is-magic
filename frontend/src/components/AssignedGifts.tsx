/**
 * AssignedGiftsView — shared "assigned gifts" wish list.
 *
 * Used by AdminAssignedGifts (scoped to the current admin via the admin
 * endpoint's `assigned_to_id` filter) and PurchaserAssignedGifts (scoped to
 * the current purchaser by the purchaser endpoint itself). Owns the list
 * query (via useCrudManager, update-only), checkbox selection, the
 * mark-purchased and batch-mark-purchased mutations + dialogs, and the
 * inline edit form for the purchase-tracking fields (purchaser note,
 * received at). The page supplies the chrome (HeaderBar, <main>), config
 * (API functions, query keys, heading/copy), and the family cell renderer.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "../context/ToastContext";
import { useCrudManager } from "../hooks/useCrudManager";
import { useDebouncedState } from "../hooks/useDebouncedState";
import { getPaginationInfo, usePagination } from "../hooks/usePagination";
import { formatDateTime, normalizeUpdatePayload } from "../lib/utils";
import type { WishBatchMarkPurchased, WishDetail, WishPurchaseMark, WishType } from "../types";
import { BatchMarkPurchasedDialog } from "./BatchMarkPurchasedDialog";
import { Button } from "./Button";
import { Card } from "./Card";
import { DatePicker } from "./DatePicker";
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

/** Data columns in the table (checkbox + Actions are implicit) — drives the inline edit row's colSpan. */
const DATA_COLUMNS = ["ID", "Person", "Family", "Type", "Description", "Size", "Color", "Purchased"];

export function AssignedGiftsView<
  ListResponse extends { wishes: AssignedGiftRow[]; total: number } = { wishes: AssignedGiftRow[]; total: number },
>({
  title,
  emptyMessage,
  rootKey,
  detailKey,
  invalidationKeys,
  listFn,
  detailFn,
  updateFn,
  markPurchasedFn,
  batchMarkPurchasedFn,
  renderFamilyCell,
}: AssignedGiftsViewProps<ListResponse>) {
  const [purchasedFilter, setPurchasedFilter] = useState<string>("all");
  const [wishTypeFilter, setWishTypeFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [batchMarkOpen, setBatchMarkOpen] = useState(false);
  const [markPurchasedId, setMarkPurchasedId] = useState<number | null>(null);

  const pagination = usePagination({ defaultPageSize: DEFAULT_PAGE_SIZE });
  const queryClient = useQueryClient();
  const toast = useToast();

  // Debounce search so the list doesn't refetch on every keystroke
  const debouncedSearch = useDebouncedState(searchQuery, 1000, () => pagination.goToPage(1));

  // Build list params from filters
  const listParams = useMemo<AssignedGiftsListParams>(
    () => ({
      ...pagination.params,
      purchased: purchasedFilter !== "all" ? purchasedFilter : undefined,
      search: debouncedSearch || undefined,
      wish_type: wishTypeFilter || undefined,
    }),
    [pagination.params, purchasedFilter, debouncedSearch, wishTypeFilter]
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
        <Button onClick={() => setBatchMarkOpen(true)} disabled={selectedIds.size === 0 || batchMarkMut.isPending}>
          Mark Purchased ({selectedIds.size})
        </Button>
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
            <Th>ID</Th>
            <Th>Person</Th>
            <Th>Family</Th>
            <Th>Type</Th>
            <Th>Description</Th>
            <Th>Size</Th>
            <Th>Color</Th>
            <Th>Purchased</Th>
            <Th>Actions</Th>
          </TableHead>
          <TableBody>
            {wishes.map((w) => (
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
                  <Td className="whitespace-nowrap font-mono text-xs">{w.display_id ?? "—"}</Td>
                  <Td>{w.person_given_name ?? "Family"}</Td>
                  <Td>{renderFamilyCell(w)}</Td>
                  <Td>
                    <WishTypeBadge type={w.type} />
                  </Td>
                  <Td className="max-w-xs truncate">{w.description}</Td>
                  <Td>{w.size ?? "—"}</Td>
                  <Td>{w.color ?? "—"}</Td>
                  <Td>
                    {w.purchased_at ? (
                      <span className="text-xs text-green-700" title={formatDateTime(w.purchased_at)}>
                        ✓ {formatDateTime(w.purchased_at)}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </Td>
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
                    <Td colSpan={DATA_COLUMNS.length + 2} className="!py-3">
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
            ))}
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
