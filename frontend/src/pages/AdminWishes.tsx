/**
 * Admin — Manage Wishes
 *
 * Flat paginated list of all wishes with filters, inline edit, mark-purchased
 * dialog, and batch-assign with checkbox selection.
 *
 * Wishes are created/deleted via person CRUD — this page only handles
 * list, detail, update, mark-purchased, and batch-assign.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ActionsDropdown } from "../components/ActionsDropdown";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ColumnToggle } from "../components/ColumnToggle";
import { DatePicker } from "../components/DatePicker";
import { FormField } from "../components/FormField";
import { BackLink, HeaderBar } from "../components/HeaderBar";
import { MarkPurchasedDialog } from "../components/MarkPurchasedDialog";
import { MutationErrors } from "../components/MutationErrors";
import { OptionalLabel } from "../components/OptionalLabel";
import { Pagination } from "../components/Pagination";
import { PageSpinner, Spinner } from "../components/Spinner";
import { Table, TableBody, TableHead, Td, Th, Tr } from "../components/Table";
import { useToast } from "../context/ToastContext";
import { useColumnVisibility } from "../hooks/useColumnVisibility";
import { useCrudManager } from "../hooks/useCrudManager";
import { getPaginationInfo, usePagination } from "../hooks/usePagination";
import { useTableWidth } from "../hooks/useTableWidth";
import {
  adminBatchAssignWishes,
  adminGetFamiliesDropdown,
  adminGetUsersDropdown,
  adminGetWish,
  adminListWishes,
  adminMarkPurchased,
  adminUpdateWish,
} from "../lib/api";
import { adminFamiliesDropdown, adminPackingSlips, adminUsersDropdown, adminWishDetail, adminWishes } from "../lib/queryKeys";
import { ROUTES, route } from "../lib/routes";
import { formatDateTime, normalizeUpdatePayload } from "../lib/utils";
import type {
  AdminWishesListParams,
  AdminWishUpdate,
  FamilyDropdownItem,
  UserDropdownItem,
  WishBatchAssign,
  WishDetail,
  WishListResponse,
  WishPurchaseMark,
  WishType,
} from "../types";

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function AdminWishes() {
  const [familyFilter, setFamilyFilter] = useState<number | null>(null);
  const [assignedToFilter, setAssignedToFilter] = useState<number | null>(null);
  const [purchasedFilter, setPurchasedFilter] = useState<string>("all");
  const [wishTypeFilter, setWishTypeFilter] = useState<string>("");
  const [sortField, setSortField] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [markPurchasedId, setMarkPurchasedId] = useState<number | null>(null);
  const [batchAssignOpen, setBatchAssignOpen] = useState(false);
  const [assignUserId, setAssignUserId] = useState<number | null>(null);

  const pagination = usePagination();
  const queryClient = useQueryClient();
  const toast = useToast();

  // Debounce search so the list doesn't refetch on every keystroke
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      pagination.goToPage(1);
    }, 1000);
    return () => clearTimeout(timer);
  }, [searchQuery, pagination]);

  // Column visibility
  const { visibleColumns, apiColumns } = useColumnVisibility("adminWishes");
  const { widthClass } = useTableWidth("adminWishes");

  // Build list params from filters
  const listParams = useMemo<AdminWishesListParams>(
    () => ({
      ...pagination.params,
      columns: apiColumns,
      family_id: familyFilter ?? undefined,
      person_id: undefined,
      assigned_to_id: assignedToFilter ?? undefined,
      purchased: purchasedFilter !== "all" ? purchasedFilter : undefined,
      search: debouncedSearch || undefined,
      wish_type: wishTypeFilter || undefined,
      sort: sortField || undefined,
    }),
    [pagination.params, apiColumns, familyFilter, assignedToFilter, purchasedFilter, debouncedSearch, wishTypeFilter, sortField]
  );

  // CRUD manager — no create/delete (wishes managed via person CRUD)
  const { listData, listLoading, detail, detailLoading, updateMut, editingId, openEdit, cancelForm } = useCrudManager<
    WishListResponse,
    WishDetail,
    Partial<AdminWishUpdate>,
    AdminWishesListParams
  >({
    rootKey: adminWishes,
    listFn: adminListWishes,
    listParams,
    detailFn: adminGetWish,
    createFn: undefined,
    updateFn: adminUpdateWish,
    deleteFn: undefined,
    invalidationKeys: [adminWishes, adminPackingSlips],
    entityName: "Wish",
  });

  // Fetch families for dropdown
  const { data: families } = useQuery({
    queryKey: adminFamiliesDropdown,
    queryFn: () => adminGetFamiliesDropdown(),
  });

  // Fetch users for dropdown (assigned-to / batch-assign) — admins + purchasers
  const { data: users } = useQuery({
    queryKey: adminUsersDropdown,
    queryFn: () => adminGetUsersDropdown("admin,purchaser"),
  });

  // Mark-purchased mutation
  const markPurchasedMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: WishPurchaseMark }) => adminMarkPurchased(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminWishes });
      queryClient.invalidateQueries({ queryKey: adminPackingSlips });
      if (markPurchasedId != null) {
        queryClient.invalidateQueries({ queryKey: adminWishDetail(markPurchasedId) });
      }
      setMarkPurchasedId(null);
      toast.success("Wish marked as purchased");
    },
  });

  // Batch-assign mutation
  const batchAssignMut = useMutation({
    mutationFn: (payload: WishBatchAssign) => adminBatchAssignWishes(payload),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: adminWishes });
      queryClient.invalidateQueries({ queryKey: adminPackingSlips });
      setSelectedIds(new Set());
      setBatchAssignOpen(false);
      setAssignUserId(null);
      toast.success(`${data.assigned_count} wish${data.assigned_count > 1 ? "es" : ""} assigned`);
    },
  });

  // Update handler — build typed payload from form state
  function handleUpdateWish(formData: WishFormState) {
    if (editingId == null || detail == null) return;
    const payload: Record<string, unknown> = normalizeUpdatePayload(formData, detail);
    // Backend sentinels: 0 → NULL for FK, "" → NULL for optional strings
    if ("assigned_to_id" in payload && payload.assigned_to_id === null) {
      payload.assigned_to_id = 0;
    }
    if ("received_at" in payload && payload.received_at === "") {
      payload.received_at = ""; // explicit empty string = clear sentinel
    }
    if ("purchaser_note" in payload && payload.purchaser_note === "") {
      payload.purchaser_note = ""; // explicit empty string = clear sentinel
    }
    updateMut.mutate({ id: editingId, data: payload as Partial<AdminWishUpdate> });
  }

  // Checkbox selection helpers
  const wishes = listData?.wishes ?? [];

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
    <div className="min-h-screen bg-slate-50">
      <HeaderBar title="Kindness is Magic" left={<BackLink to={ROUTES.DASHBOARD} label="Dashboard" />} />

      <main className={`mx-auto px-4 py-8 sm:px-6 ${widthClass}`}>
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-violet-950">Manage Wishes</h2>
          <div className="flex items-center gap-3">
            <ColumnToggle resourceKey="adminWishes" />
            <Button onClick={() => setBatchAssignOpen(true)} disabled={selectedIds.size === 0 || batchAssignMut.isPending}>
              Batch Assign ({selectedIds.size})
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <select
            aria-label="Family filter"
            value={familyFilter ?? ""}
            onChange={(e) => {
              setFamilyFilter(e.target.value ? parseInt(e.target.value, 10) : null);
              resetPage();
            }}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
          >
            <option value="">All families</option>
            {(families ?? []).map((f) => (
              <option key={f.id} value={f.id}>
                {f.family_name}
              </option>
            ))}
          </select>

          <select
            aria-label="Assigned to filter"
            value={assignedToFilter ?? ""}
            onChange={(e) => {
              setAssignedToFilter(e.target.value ? parseInt(e.target.value, 10) : null);
              resetPage();
            }}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
          >
            <option value="">All assignees</option>
            {(users ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.display_name}
              </option>
            ))}
          </select>

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
            <option value="true">Purchased</option>
            <option value="false">Unpurchased</option>
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
          </select>

          <select
            aria-label="Sort"
            value={sortField}
            onChange={(e) => {
              setSortField(e.target.value);
              resetPage();
            }}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
          >
            <option value="">Default sort</option>
            <option value="id">ID ↑</option>
            <option value="-id">ID ↓</option>
            <option value="description">Description ↑</option>
            <option value="-description">Description ↓</option>
            <option value="type">Type ↑</option>
            <option value="-type">Type ↓</option>
            <option value="purchased_at">Purchased ↑</option>
            <option value="-purchased_at">Purchased ↓</option>
            <option value="created_at">Created ↑</option>
            <option value="-created_at">Created ↓</option>
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
            <p className="py-8 text-center text-gray-400">No wishes found.</p>
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
              {visibleColumns.includes("person_given_name") && <Th>Person</Th>}
              {visibleColumns.includes("family_id") && <Th>Family</Th>}
              {visibleColumns.includes("type") && <Th>Type</Th>}
              {visibleColumns.includes("description") && <Th>Description</Th>}
              {visibleColumns.includes("size") && <Th>Size</Th>}
              {visibleColumns.includes("color") && <Th>Color</Th>}
              {visibleColumns.includes("assigned_to") && <Th>Assigned To</Th>}
              {visibleColumns.includes("purchased_at") && <Th>Purchased</Th>}
              {visibleColumns.includes("purchased_where") && <Th>Purchased Where</Th>}
              {visibleColumns.includes("received_at") && <Th>Received At</Th>}
              {visibleColumns.includes("purchaser_note") && <Th>Purchaser Note</Th>}
              <Th>Actions</Th>
            </TableHead>
            <TableBody>
              {wishes.map((w) => (
                <>
                  <Tr key={w.id}>
                    <Td>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(w.id)}
                        onChange={() => toggleSelect(w.id)}
                        className="h-4 w-4 rounded border-gray-300 text-btn-start focus:ring-btn-start"
                        aria-label={`Select wish for ${w.person_given_name}`}
                      />
                    </Td>
                    {visibleColumns.includes("person_given_name") && (
                      <Td>
                        <Link to={route.adminFamilyPeople(w.family_id)} className="text-btn-start hover:underline">
                          {w.person_given_name}
                        </Link>
                      </Td>
                    )}
                    {visibleColumns.includes("family_id") && (
                      <Td>
                        <Link to={route.adminFamilyPeople(w.family_id)} className="text-btn-start hover:underline">
                          {getFamilyName(families ?? [], w.family_id)}
                        </Link>
                      </Td>
                    )}
                    {visibleColumns.includes("type") && (
                      <Td>
                        <WishTypeBadge type={w.type} />
                      </Td>
                    )}
                    {visibleColumns.includes("description") && <Td className="max-w-xs truncate">{w.description}</Td>}
                    {visibleColumns.includes("size") && <Td>{w.size ?? "—"}</Td>}
                    {visibleColumns.includes("color") && <Td>{w.color ?? "—"}</Td>}
                    {visibleColumns.includes("assigned_to") && <Td>{w.assigned_to_name ?? "—"}</Td>}
                    {visibleColumns.includes("purchased_at") && (
                      <Td>
                        {w.purchased_at ? (
                          <span className="text-xs text-green-700" title={formatDateTime(w.purchased_at)}>
                            ✓ {formatDateTime(w.purchased_at)}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </Td>
                    )}
                    {visibleColumns.includes("purchased_where") && (
                      <Td className="max-w-xs text-xs truncate">{w.purchased_where || "—"}</Td>
                    )}
                    {visibleColumns.includes("received_at") && (
                      <Td className="text-xs text-gray-500">{w.received_at ? new Date(w.received_at).toLocaleDateString() : "—"}</Td>
                    )}
                    {visibleColumns.includes("purchaser_note") && <Td className="max-w-xs text-xs truncate">{w.purchaser_note || "—"}</Td>}
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
                        <ActionsDropdown
                          items={[
                            {
                              label: "Assign…",
                              variant: "secondary" as const,
                              onClick: () => {
                                setSelectedIds(new Set([w.id]));
                                setBatchAssignOpen(true);
                              },
                              disabled: batchAssignMut.isPending,
                            },
                            ...(w.assigned_to_id != null
                              ? [
                                  {
                                    label: "Unassign",
                                    variant: "secondary" as const,
                                    onClick: () => openEdit(w.id),
                                    disabled: !!editingId && editingId !== w.id,
                                  },
                                ]
                              : []),
                          ]}
                          disabled={updateMut.isPending}
                        />
                      </div>
                    </Td>
                  </Tr>
                  {editingId === w.id && (
                    <Tr key={`${w.id}-edit`}>
                      <Td colSpan={visibleColumns.length + 2} className="!py-3">
                        <div className="rounded-xl bg-gray-50 p-4">
                          {detailLoading ? (
                            <div className="flex items-center justify-center gap-3 py-6 text-btn-start">
                              <Spinner size="sm" />
                              <span className="text-sm font-medium">Loading…</span>
                            </div>
                          ) : detail ? (
                            <WishEditForm
                              wish={detail}
                              users={users ?? []}
                              onSave={handleUpdateWish}
                              onCancel={cancelForm}
                              loading={updateMut.isPending}
                            />
                          ) : null}
                        </div>
                      </Td>
                    </Tr>
                  )}
                </>
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

        {/* Mark-purchased dialog */}
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

        {/* Batch-assign dialog */}
        <BatchAssignDialog
          open={batchAssignOpen}
          selectedCount={selectedIds.size}
          users={users ?? []}
          assignedToId={assignUserId}
          onAssignToChange={setAssignUserId}
          onSubmit={() => {
            if (assignUserId == null) return;
            batchAssignMut.mutate({
              wish_ids: Array.from(selectedIds),
              assigned_to_id: assignUserId,
            });
          }}
          onCancel={() => {
            setBatchAssignOpen(false);
            setAssignUserId(null);
          }}
          loading={batchAssignMut.isPending}
        />

        {/* Errors */}
        <MutationErrors mutations={[updateMut, markPurchasedMut, batchAssignMut]} />
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* WishEditForm — inline edit form for wish fields                     */
/* ------------------------------------------------------------------ */

interface WishEditFormProps {
  wish: WishDetail;
  users: UserDropdownItem[];
  onSave: (data: WishFormState) => void;
  onCancel: () => void;
  loading: boolean;
}

/** Internal form state — mirrors the wish detail fields. */
interface WishFormState {
  type: WishType;
  description: string;
  size: string;
  color: string;
  assigned_to_id: number | null;
  purchased_where: string;
  received_at: string;
  purchaser_note: string;
}

function WishEditForm({ wish, users, onSave, onCancel, loading }: WishEditFormProps) {
  const [form, setForm] = useState<WishFormState>(() => ({
    type: wish.type,
    description: wish.description,
    size: wish.size ?? "",
    color: wish.color ?? "",
    assigned_to_id: wish.assigned_to_id,
    purchased_where: wish.purchased_where ?? "",
    received_at: wish.received_at ?? "",
    purchaser_note: wish.purchaser_note ?? "",
  }));

  useEffect(() => {
    setForm({
      type: wish.type,
      description: wish.description,
      size: wish.size ?? "",
      color: wish.color ?? "",
      assigned_to_id: wish.assigned_to_id,
      purchased_where: wish.purchased_where ?? "",
      received_at: wish.received_at ?? "",
      purchaser_note: wish.purchaser_note ?? "",
    });
  }, [wish]);

  const update = (key: string, val: unknown) => setForm((p) => ({ ...p, [key]: val }));

  return (
    <Card className="mb-6 border border-gray-200">
      <h3 className="mb-4 text-lg font-semibold text-violet-950">Edit Wish</h3>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(form);
        }}
      >
        <div className="flex flex-col gap-4 sm:flex-row">
          <FormField
            label="Type"
            fieldProps={{
              value: form.type,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("type", e.target.value as WishType),
              readOnly: true,
              autoComplete: "off",
            }}
          />
          <FormField
            label="Description"
            fieldProps={{
              value: form.description,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("description", e.target.value),
              required: true,
              maxLength: 60,
              autoComplete: "off",
            }}
          />
          <FormField
            label="Size"
            fieldProps={{
              value: form.size,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("size", e.target.value),
              maxLength: 20,
              autoComplete: "off",
            }}
          />
          <FormField
            label="Color"
            fieldProps={{
              value: form.color,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("color", e.target.value),
              maxLength: 20,
              autoComplete: "off",
            }}
          />
        </div>

        <div className="mt-4 flex flex-col gap-4 sm:flex-row">
          <div>
            <label htmlFor={`wish-edit-assigned-${wish.id}`} className="mb-1.5 block text-sm font-medium text-gray-700">
              Assigned To
            </label>
            <select
              id={`wish-edit-assigned-${wish.id}`}
              value={form.assigned_to_id ?? ""}
              onChange={(e) => update("assigned_to_id", e.target.value ? parseInt(e.target.value, 10) : null)}
              className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
            >
              <option value="">Unassigned</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.display_name}
                </option>
              ))}
            </select>
          </div>

          <FormField
            label="Purchased Where"
            fieldProps={{
              value: form.purchased_where,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("purchased_where", e.target.value),
              maxLength: 200,
              autoComplete: "off",
            }}
          />
        </div>

        <div className="mt-4">
          <DatePicker label="Received At" isOptional value={form.received_at} onChange={(val) => update("received_at", val)} />
        </div>

        <div className="mt-4">
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

/* ------------------------------------------------------------------ */
/* BatchAssignDialog                                                   */
/* ------------------------------------------------------------------ */

interface BatchAssignDialogProps {
  open: boolean;
  selectedCount: number;
  users: UserDropdownItem[];
  assignedToId: number | null;
  onAssignToChange: (id: number | null) => void;
  onSubmit: () => void;
  onCancel: () => void;
  loading: boolean;
}

function BatchAssignDialog({
  open,
  selectedCount,
  users,
  assignedToId,
  onAssignToChange,
  onSubmit,
  onCancel,
  loading,
}: BatchAssignDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl">
        <p className="mb-4 text-sm font-semibold text-gray-700">
          Assign{" "}
          <strong>
            {selectedCount} wish{selectedCount > 1 ? "es" : ""}
          </strong>
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
          className="space-y-3"
        >
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Assign to</label>
            <select
              value={assignedToId ?? ""}
              onChange={(e) => onAssignToChange(e.target.value === "" ? null : parseInt(e.target.value, 10))}
              required
              className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
            >
              <option value="">Select…</option>
              <option value="0">Unassigned</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.display_name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-3 pt-1">
            <Button type="submit" className="flex-1" loading={loading} disabled={assignedToId == null}>
              {loading ? "Assigning…" : "Assign"}
            </Button>
            <Button type="button" variant="secondary" className="flex-1" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* WishTypeBadge                                                       */
/* ------------------------------------------------------------------ */

const wishTypeColors: Record<WishType, string> = {
  adult: "bg-purple-100 text-purple-700",
  practical: "bg-blue-100 text-blue-700",
  fun: "bg-amber-100 text-amber-700",
};

function WishTypeBadge({ type }: { type: WishType }) {
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${wishTypeColors[type] ?? "bg-gray-100 text-gray-700"}`}>{type}</span>;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function getFamilyName(families: FamilyDropdownItem[], familyId: number): string {
  const family = families.find((f) => f.id === familyId);
  return family?.family_name ?? `Family #${familyId}`;
}
