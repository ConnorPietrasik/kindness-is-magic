/**
 * Admin — My Assigned Gifts
 *
 * Paginated list of wishes assigned to the current admin (mirrors the
 * purchaser view), with:
 *  - Filter: purchased / unpurchased / all
 *  - "Mark Purchased" dialog
 *  - Inline edit for purchaser note + received_at
 *
 * Wishes are scoped to the current admin via the admin list endpoint's
 * `assigned_to_id` filter. Full wish editing (definition fields,
 * reassignment) lives on the Manage Wishes page.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { DatePicker } from "../components/DatePicker";
import { BackLink, HeaderBar } from "../components/HeaderBar";
import { MarkPurchasedDialog } from "../components/MarkPurchasedDialog";
import { MutationErrors } from "../components/MutationErrors";
import { OptionalLabel } from "../components/OptionalLabel";
import { Pagination } from "../components/Pagination";
import { PageSpinner, Spinner } from "../components/Spinner";
import { Table, TableBody, TableHead, Td, Th, Tr } from "../components/Table";
import { WishTypeBadge } from "../components/WishTypeBadge";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useCrudManager } from "../hooks/useCrudManager";
import { useFamiliesDropdown } from "../hooks/useDropdowns";
import { getPaginationInfo, usePagination } from "../hooks/usePagination";
import { adminGetWish, adminListWishes, adminMarkPurchased, adminUpdateWish } from "../lib/api";
import { adminPackingSlips, adminWishDetail, adminWishes } from "../lib/queryKeys";
import { ROUTES, route } from "../lib/routes";
import { formatDateTime, normalizeUpdatePayload } from "../lib/utils";
import type { AdminWishesListParams, AdminWishUpdate, WishDetail, WishListResponse, WishPurchaseMark } from "../types";

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function AdminAssignedGifts() {
  const { user } = useAuth();
  // Defer the data hooks until the user is known so the list query never
  // fires unscoped (before `assigned_to_id` is available).
  if (!user) return <PageSpinner />;
  return <AdminAssignedGiftsList userId={user.id} />;
}

function AdminAssignedGiftsList({ userId }: { userId: number }) {
  const [purchasedFilter, setPurchasedFilter] = useState<string>("all");
  const [markPurchasedId, setMarkPurchasedId] = useState<number | null>(null);

  const pagination = usePagination({ defaultPageSize: 50 });
  const queryClient = useQueryClient();
  const toast = useToast();
  const { familyMap } = useFamiliesDropdown();

  // Build list params — always scoped to the current admin
  const listParams = useMemo<AdminWishesListParams>(
    () => ({
      ...pagination.params,
      assigned_to_id: userId,
      purchased: purchasedFilter !== "all" ? purchasedFilter : undefined,
    }),
    [pagination.params, userId, purchasedFilter]
  );

  // CRUD manager — list/detail/update only (no create/delete for wishes)
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

  // Update handler — build typed payload from form state
  function handleUpdateWish(formData: AdminEditFormState) {
    if (editingId == null || detail == null) return;
    // Cleared fields keep "" — the backend's sentinel for clearing.
    const payload = normalizeUpdatePayload(formData, detail);
    updateMut.mutate({ id: editingId, data: payload });
  }

  const wishes = listData?.wishes ?? [];
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

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-violet-950">My Assigned Gifts</h2>
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
        </div>

        {/* Table */}
        {wishes.length === 0 ? (
          <Card>
            <p className="py-8 text-center text-gray-400">No wishes assigned to you.</p>
          </Card>
        ) : (
          <Table>
            <TableHead>
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
                    <Td className="whitespace-nowrap font-mono text-xs">{w.display_id ?? "—"}</Td>
                    <Td>{w.person_given_name ?? "Family"}</Td>
                    <Td>
                      <Link to={route.adminFamilyPeople(w.family_id)} className="text-btn-start hover:underline">
                        {familyMap[w.family_id] ?? `Family #${w.family_id}`}
                      </Link>
                    </Td>
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
                      <Td colSpan={9} className="!py-3">
                        <div className="rounded-xl bg-gray-50 p-4">
                          {detailLoading ? (
                            <div className="flex items-center justify-center gap-3 py-6 text-btn-start">
                              <Spinner size="sm" />
                              <span className="text-sm font-medium">Loading…</span>
                            </div>
                          ) : detail ? (
                            <AdminEditForm wish={detail} onSave={handleUpdateWish} onCancel={cancelForm} loading={updateMut.isPending} />
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

        {/* Errors */}
        <MutationErrors mutations={[updateMut, markPurchasedMut]} />
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* AdminEditForm — inline edit for purchaser_note + received_at        */
/* ------------------------------------------------------------------ */

interface AdminEditFormProps {
  wish: WishDetail;
  onSave: (data: AdminEditFormState) => void;
  onCancel: () => void;
  loading: boolean;
}

/** Internal form state — only the purchase-tracking fields this page edits. */
interface AdminEditFormState {
  purchaser_note: string;
  received_at: string;
}

function AdminEditForm({ wish, onSave, onCancel, loading }: AdminEditFormProps) {
  const [form, setForm] = useState<AdminEditFormState>(() => ({
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
