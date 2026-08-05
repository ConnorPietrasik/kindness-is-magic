/**
 * Purchaser — Assigned Gifts
 *
 * Paginated list of wishes assigned to the current purchaser with:
 *  - Filter: purchased / unpurchased / all
 *  - "Mark Purchased" dialog
 *  - Inline edit for purchaser note + received_at
 *  - Family ID linked to the public wishlist page
 *
 * Purchasers cannot unassign wishes or edit wish definitions.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { DatePicker } from "../components/DatePicker";
import { FormField } from "../components/FormField";
import { BackLink, HeaderBar } from "../components/HeaderBar";
import { MutationErrors } from "../components/MutationErrors";
import { OptionalLabel } from "../components/OptionalLabel";
import { Pagination } from "../components/Pagination";
import { PageSpinner, Spinner } from "../components/Spinner";
import { Table, TableBody, TableHead, Td, Th, Tr } from "../components/Table";
import { useToast } from "../context/ToastContext";
import { useCrudManager } from "../hooks/useCrudManager";
import { getPaginationInfo, usePagination } from "../hooks/usePagination";
import { purchaserGetWish, purchaserListWishes, purchaserMarkPurchased, purchaserUpdateWish } from "../lib/api";
import { purchaserWishDetail, purchaserWishes } from "../lib/queryKeys";
import { ROUTES, route } from "../lib/routes";
import { formatDateTime, normalizeUpdatePayload } from "../lib/utils";
import type {
  PurchaserWishListResponse,
  PurchaserWishSummary,
  PurchaserWishUpdate,
  WishDetail,
  WishPurchaseMark,
  WishType,
} from "../types";

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function PurchaserAssignedGifts() {
  const [purchasedFilter, setPurchasedFilter] = useState<string>("all");
  const [markPurchasedId, setMarkPurchasedId] = useState<number | null>(null);

  const pagination = usePagination({ defaultPageSize: 50 });
  const queryClient = useQueryClient();
  const toast = useToast();

  // Build list params from filters
  const listParams = useMemo(
    () => ({
      ...pagination.params,
      purchased: purchasedFilter !== "all" ? purchasedFilter : undefined,
    }),
    [pagination.params, purchasedFilter]
  );

  // CRUD manager — update only (no create/delete for purchasers)
  const { listData, listLoading, detail, detailLoading, updateMut, editingId, openEdit, cancelForm } = useCrudManager<
    PurchaserWishListResponse,
    WishDetail,
    Partial<PurchaserWishUpdate>,
    typeof listParams
  >({
    rootKey: purchaserWishes,
    listFn: purchaserListWishes,
    listParams,
    detailFn: purchaserGetWish,
    createFn: undefined,
    updateFn: purchaserUpdateWish,
    deleteFn: undefined,
    invalidationKeys: [purchaserWishes],
    entityName: "Wish",
  });

  // Mark-purchased mutation
  const markPurchasedMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: WishPurchaseMark }) => purchaserMarkPurchased(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: purchaserWishes });
      if (markPurchasedId != null) {
        queryClient.invalidateQueries({ queryKey: purchaserWishDetail(markPurchasedId) });
      }
      setMarkPurchasedId(null);
      toast.success("Wish marked as purchased");
    },
  });

  // Update handler — build typed payload from form state
  function handleUpdateWish(formData: PurchaserEditFormState) {
    if (editingId == null || detail == null) return;
    const payload: Record<string, unknown> = normalizeUpdatePayload(formData, detail);
    // Backend sentinels: "" → NULL for optional strings
    if ("received_at" in payload && payload.received_at === "") {
      payload.received_at = ""; // explicit empty string = clear sentinel
    }
    if ("purchaser_note" in payload && payload.purchaser_note === "") {
      payload.purchaser_note = ""; // explicit empty string = clear sentinel
    }
    updateMut.mutate({ id: editingId, data: payload as Partial<PurchaserWishUpdate> });
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
          <h2 className="text-xl font-bold text-violet-950">Assigned Gifts</h2>
        </div>

        {/* Filters */}
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <select
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
            <p className="py-8 text-center text-gray-400">No wishes found.</p>
          </Card>
        ) : (
          <Table>
            <TableHead>
              <Th>Person</Th>
              <Th>Family</Th>
              <Th>Type</Th>
              <Th>Description</Th>
              <Th>Size</Th>
              <Th>Purchased</Th>
              <Th>Actions</Th>
            </TableHead>
            <TableBody>
              {wishes.map((w) => (
                <>
                  <Tr key={w.id}>
                    <Td>{w.person_given_name}</Td>
                    <Td>
                      <Link to={route.familyWishList(w.family_id)} className="text-btn-start hover:underline">
                        Family #{w.family_id}
                      </Link>
                    </Td>
                    <Td>
                      <WishTypeBadge type={w.type} />
                    </Td>
                    <Td className="max-w-xs truncate">{w.description}</Td>
                    <Td>{w.size ?? "—"}</Td>
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
                      <Td colSpan={7} className="!py-3">
                        <div className="rounded-xl bg-gray-50 p-4">
                          {detailLoading ? (
                            <div className="flex items-center justify-center gap-3 py-6 text-btn-start">
                              <Spinner size="sm" />
                              <span className="text-sm font-medium">Loading…</span>
                            </div>
                          ) : detail ? (
                            <PurchaserEditForm
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

        {/* Errors */}
        <MutationErrors mutations={[updateMut, markPurchasedMut]} />
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* PurchaserEditForm — inline edit for purchaser_note + received_at    */
/* ------------------------------------------------------------------ */

interface PurchaserEditFormProps {
  wish: WishDetail;
  onSave: (data: PurchaserEditFormState) => void;
  onCancel: () => void;
  loading: boolean;
}

/** Internal form state — only fields purchasers can edit. */
interface PurchaserEditFormState {
  purchaser_note: string;
  received_at: string;
}

function PurchaserEditForm({ wish, onSave, onCancel, loading }: PurchaserEditFormProps) {
  const [form, setForm] = useState<PurchaserEditFormState>(() => ({
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
      <h3 className="mb-4 text-lg font-semibold text-violet-950">Edit — Gift for {wish.person_given_name}</h3>
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

/* ------------------------------------------------------------------ */
/* MarkPurchasedDialog                                                 */
/* ------------------------------------------------------------------ */

interface MarkPurchasedDialogProps {
  open: boolean;
  wish: PurchaserWishSummary | null;
  onSubmit: (data: WishPurchaseMark) => void;
  onCancel: () => void;
  loading: boolean;
}

function MarkPurchasedDialog({ open, wish, onSubmit, onCancel, loading }: MarkPurchasedDialogProps) {
  const [purchasedWhere, setPurchasedWhere] = useState("");
  const [purchaserNote, setPurchaserNote] = useState("");
  const [receivedAt, setReceivedAt] = useState("");

  useEffect(() => {
    if (wish) {
      setPurchasedWhere(wish.purchased_where ?? "");
      setPurchaserNote(wish.purchaser_note ?? "");
      setReceivedAt(wish.received_at ?? "");
    }
  }, [wish]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
        <p className="mb-4 text-sm font-semibold text-gray-700">
          Mark gift for <strong>{wish?.person_given_name ?? "?"}</strong> as purchased
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({
              purchased_where: purchasedWhere || null,
              purchaser_note: purchaserNote,
              received_at: receivedAt,
            });
          }}
          className="space-y-3"
        >
          <FormField
            label="Purchased Where"
            fieldProps={{
              value: purchasedWhere,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setPurchasedWhere(e.target.value),
              maxLength: 200,
              autoComplete: "off",
            }}
          />

          <div>
            <OptionalLabel text="Purchaser Note" />
            <textarea
              value={purchaserNote}
              onChange={(e) => setPurchaserNote(e.target.value)}
              maxLength={400}
              rows={3}
              autoComplete="off"
              className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
            />
          </div>

          <DatePicker label="Received At" isOptional value={receivedAt} onChange={setReceivedAt} />

          <div className="flex gap-3 pt-1">
            <Button type="submit" className="flex-1" loading={loading}>
              {loading ? "Marking…" : "Mark Purchased"}
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
