/**
 * Admin — Manage Families
 *
 * List, create, edit, delete families.
 * Uses useCrudManager for data fetching and mutations.
 * Separate "Deleted" tab calls the /deleted endpoint.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ActionsDropdown } from "../components/ActionsDropdown";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { CrudTabs } from "../components/CrudTabs";
import { defaultFamilyForm } from "../components/defaults";
import { FamilyForm } from "../components/FamilyForm";
import { HeaderBar } from "../components/HeaderBar";
import { MutationErrors } from "../components/MutationErrors";
import { Pagination } from "../components/Pagination";
import { PageSpinner, Spinner } from "../components/Spinner";
import { Table, TableBody, TableHead, Td, Th, Tr } from "../components/Table";
import { useToast } from "../context/ToastContext";
import { useCrudManager } from "../hooks/useCrudManager";
import { useCrudTabs } from "../hooks/useCrudTabs";
import { useDeliveryUsers } from "../hooks/useDeliveryUsers";
import { getPaginationInfo, usePagination } from "../hooks/usePagination";
import {
  adminApproveWishes,
  adminCreateFamily,
  adminDeleteFamily,
  adminGetFamily,
  adminListDeletedFamilies,
  adminListFamilies,
  adminListReferrers,
  adminResetWishState,
  adminRestoreFamily,
  adminUpdateFamily,
} from "../lib/api";
import {
  adminDeletedFamilies,
  adminDeletedPeople,
  adminFamilies,
  adminPackingSlips,
  adminPeople,
  adminReferrers,
  adminReviewQueue,
  adminWishes,
} from "../lib/queryKeys";
import { route } from "../lib/routes";
import { normalizeUpdatePayload } from "../lib/utils";
import type { FamilyDetail, FamilyPayload, PaginationParams } from "../types";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function getLockLevelRowClass(deletedAt: string | null, wishLockLevel: string): string {
  if (deletedAt != null) return "";
  if (wishLockLevel === "admin") return "bg-emerald-50";
  if (wishLockLevel === "referrer") return "bg-amber-50";
  return "";
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function AdminFamilies() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const pagination = usePagination();
  const { viewTab, isDeletedView, handleTabChange } = useCrudTabs({ pagination });
  const [restoreConfirm, setRestoreConfirm] = useState<number | null>(null);
  const [resetConfirm, setResetConfirm] = useState<number | null>(null);
  const [fullyApproveConfirm, setFullyApproveConfirm] = useState<number | null>(null);
  const [showUnapproved, setShowUnapproved] = useState(false);
  const [lockEditConfirm, setLockEditConfirm] = useState<boolean>(false);
  const pendingPayload = useRef<FamilyPayload | null>(null);

  // Build list params (no include_deleted — deleted uses separate endpoint)
  const listParams = useMemo<PaginationParams>(() => pagination.params, [pagination.params]);

  const {
    listData,
    listLoading,
    detail,
    detailLoading,
    createMut,
    updateMut,
    deleteMut,
    restoreMut,
    showForm,
    editingId,
    deleteConfirm,
    openCreate,
    openEdit,
    cancelForm,
    confirmDelete,
    cancelDelete,
  } = useCrudManager({
    rootKey: isDeletedView ? adminDeletedFamilies : adminFamilies,
    listFn: isDeletedView ? adminListDeletedFamilies : adminListFamilies,
    listParams,
    detailFn: adminGetFamily,
    createFn: isDeletedView ? undefined : adminCreateFamily,
    updateFn: isDeletedView ? undefined : adminUpdateFamily,
    deleteFn: isDeletedView ? undefined : adminDeleteFamily,
    restoreFn: adminRestoreFamily,
    invalidationKeys: [adminFamilies, adminDeletedFamilies, adminPeople, adminDeletedPeople, adminPackingSlips, adminWishes],
    entityName: "Family",
  });

  const pageInfo = useMemo(
    () => getPaginationInfo(listData?.total ?? 0, pagination.page, pagination.pageSize),
    [listData?.total, pagination.page, pagination.pageSize]
  );

  // Referrers lookup (for dropdown + display)
  const { data: referrerData, isLoading: referrersLoading } = useQuery({
    queryKey: adminReferrers,
    queryFn: () => adminListReferrers(),
  });

  const referrerMap = useMemo((): Record<number, string> => {
    const map: Record<number, string> = {};
    (referrerData?.referrers ?? []).forEach((r) => {
      map[r.id] = r.name;
    });
    return map;
  }, [referrerData]);

  // Delivery users lookup (for dropdown)
  const { deliveryUserMap, deliveryUsersLoading } = useDeliveryUsers();

  // Reset wish state mutation
  const resetMut = useMutation({
    mutationFn: adminResetWishState,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminFamilies });
      queryClient.invalidateQueries({ queryKey: adminReviewQueue });
      queryClient.invalidateQueries({ queryKey: adminPackingSlips });
      queryClient.invalidateQueries({ queryKey: adminWishes });
      toast.success("Wish lock reset — family can now edit their wishes");
    },
  });

  // Fully approve mutation (skips review flow)
  const fullyApproveMut = useMutation({
    mutationFn: adminApproveWishes,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminFamilies });
      queryClient.invalidateQueries({ queryKey: adminReviewQueue });
      queryClient.invalidateQueries({ queryKey: adminPackingSlips });
      queryClient.invalidateQueries({ queryKey: adminWishes });
      toast.success("Family fully approved and visible to donors");
    },
  });

  function handleCreate(formData: FamilyPayload) {
    createMut?.mutate(formData);
  }

  function handleUpdate(formData: FamilyPayload) {
    if (!editingId) return;
    const payload = normalizeUpdatePayload(formData, detail as FamilyDetail) as FamilyPayload;
    // If family is admin-locked, ask for confirmation
    if (detail?.wish_lock_level === "admin") {
      pendingPayload.current = payload;
      setLockEditConfirm(true);
      return;
    }
    updateMut?.mutate({ id: editingId, data: payload });
  }

  function handleUpdateConfirmed() {
    setLockEditConfirm(false);
    if (editingId && pendingPayload.current) {
      updateMut?.mutate({ id: editingId, data: pendingPayload.current });
      pendingPayload.current = null;
    }
  }

  const families = useMemo(() => {
    const all = listData?.families ?? [];
    if (showUnapproved || isDeletedView) return all;
    return all.filter((f) => f.approval_status === "approved");
  }, [listData, showUnapproved, isDeletedView]);

  if (listLoading) return <PageSpinner />;

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar title="Kindness is Magic" />

      <main className="mx-auto max-w-[960px] px-4 py-8 sm:px-6">
        {/* Header */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold text-violet-950">Manage Families</h2>
          <div className="flex items-center gap-3">
            {!isDeletedView && (
              <label className="flex items-center gap-1.5 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={showUnapproved}
                  onChange={(e) => setShowUnapproved(e.target.checked)}
                  className="rounded border-gray-300 text-violet-600 focus:ring-violet-500"
                  autoComplete="off"
                />
                Show unapproved
              </label>
            )}
            {!isDeletedView && <Button onClick={openCreate}>+ Add Family</Button>}
          </div>
        </div>

        {/* Tabs */}
        <CrudTabs viewTab={viewTab} onChange={handleTabChange} />

        {/* Tab panel content */}
        <div role="tabpanel">
          {/* Create form (active tab only) */}
          {showForm && (
            <FamilyForm
              title="Add Family"
              initial={defaultFamilyForm}
              isEdit={false}
              referrerMap={referrerMap}
              referrerOptionsLoading={referrersLoading}
              deliveryUserMap={deliveryUserMap}
              deliveryUsersLoading={deliveryUsersLoading}
              showReferrerNotes
              onSubmit={handleCreate}
              onCancel={cancelForm}
              loading={!!createMut?.isPending}
            />
          )}

          {/* Table */}
          {families.length === 0 ? (
            <Card>
              <p className="py-8 text-center text-gray-400">{isDeletedView ? "No deleted families." : "No families yet."}</p>
            </Card>
          ) : (
            <Table>
              <TableHead>
                <Th>ID</Th>
                <Th>Family Name</Th>
                <Th>Family Wish</Th>
                <Th>Contact</Th>
                <Th>Referrer</Th>
                <Th>Delivery</Th>
                <Th>Actions</Th>
              </TableHead>
              <TableBody>
                {families.map((f) => (
                  <>
                    <Tr key={f.id} data-id={f.id} className={getLockLevelRowClass(f.deleted_at, f.wish_lock_level)}>
                      <Td className="whitespace-nowrap text-xs text-gray-400">{f.display_id}</Td>
                      <Td className={f.deleted_at != null ? "text-gray-400" : ""}>
                        {f.family_name}
                        {f.deleted_at == null && f.has_notes && (
                          <span className="ml-1 text-xs" title="Has internal notes">
                            📝
                          </span>
                        )}
                        {f.deleted_at == null && !isDeletedView && f.wish_lock_level === "admin" && (
                          <Link
                            to={route.familyWishList(f.id)}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="Wish List"
                            className="ml-1 text-xs text-gray-400 transition-colors hover:text-violet-600"
                            title="Wish List"
                          >
                            📄
                          </Link>
                        )}
                      </Td>
                      <Td className="max-w-xs truncate">{f.family_wish ?? ""}</Td>
                      <Td>{f.contact_name}</Td>
                      <Td>
                        {f.referrer_id != null ? (
                          <Link
                            to={route.adminReferrerFamilies(f.referrer_id)}
                            className="text-sm text-violet-600 transition-colors hover:text-violet-800"
                          >
                            {referrerMap[f.referrer_id] || `ID ${f.referrer_id}`}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </Td>
                      <Td>{f.delivery_user_name || (f.delivery_user_id != null ? `ID ${f.delivery_user_id}` : "—")}</Td>
                      <Td>
                        <div className="flex gap-2">
                          {!isDeletedView && f.deleted_at == null && (
                            <Link
                              to={route.adminFamilyPeople(f.id)}
                              className="inline-flex items-center rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700"
                            >
                              Manage
                            </Link>
                          )}
                          {!isDeletedView && f.deleted_at == null && (
                            <>
                              <Button
                                variant="secondary"
                                size="sm"
                                className="px-3 py-1.5 text-xs"
                                onClick={() => (editingId === f.id ? cancelForm() : openEdit(f.id))}
                              >
                                {editingId === f.id ? "Done" : "Edit"}
                              </Button>
                              <ActionsDropdown
                                items={[
                                  {
                                    label: "View Packing Slip",
                                    onClick: () => navigate(route.adminPackingSlips([f.id])),
                                  },
                                  ...(f.wish_lock_level !== "family"
                                    ? [
                                        {
                                          label: "Reset Lock",
                                          variant: "secondary" as const,
                                          onClick: () => setResetConfirm(f.id),
                                        },
                                      ]
                                    : []),
                                  ...(f.wish_lock_level !== "admin"
                                    ? [
                                        {
                                          label: "Fully Approve",
                                          onClick: () => setFullyApproveConfirm(f.id),
                                        },
                                      ]
                                    : []),
                                  {
                                    label: "Delete",
                                    variant: "danger" as const,
                                    onClick: () => confirmDelete(f.id),
                                  },
                                ]}
                                disabled={deleteMut?.isPending || resetMut.isPending || fullyApproveMut.isPending}
                              />
                            </>
                          )}
                          {isDeletedView && (
                            <Button
                              variant="secondary"
                              size="sm"
                              className="px-3 py-1.5 text-xs"
                              onClick={() => setRestoreConfirm(f.id)}
                              disabled={restoreMut?.isPending}
                            >
                              Restore
                            </Button>
                          )}
                        </div>
                      </Td>
                    </Tr>
                    {editingId === f.id && (
                      <Tr key={`${f.id}-edit`}>
                        <Td colSpan={7} className="!py-3">
                          <div className="rounded-xl bg-gray-50 p-4">
                            {detailLoading ? (
                              <div className="flex items-center justify-center gap-3 py-6 text-btn-start">
                                <Spinner size="sm" />
                                <span className="text-sm font-medium">Loading…</span>
                              </div>
                            ) : detail ? (
                              <FamilyForm
                                title={`Edit Family #${detail.display_id}`}
                                initial={detail}
                                isEdit={true}
                                referrerMap={referrerMap}
                                referrerOptionsLoading={referrersLoading}
                                deliveryUserMap={deliveryUserMap}
                                deliveryUsersLoading={deliveryUsersLoading}
                                showReferrerNotes
                                onSubmit={handleUpdate}
                                onCancel={cancelForm}
                                loading={!!updateMut?.isPending}
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

          {/* Delete confirmation */}
          <ConfirmDialog
            open={deleteConfirm !== null}
            title={
              <>
                Delete family <strong>#{deleteConfirm}</strong>?
              </>
            }
            description="This will also soft-delete all people in the family."
            onConfirm={() => {
              if (deleteConfirm != null) {
                deleteMut?.mutate(deleteConfirm);
                cancelDelete();
              }
            }}
            onCancel={cancelDelete}
            loading={deleteMut?.isPending}
          />

          {/* Restore confirmation */}
          <ConfirmDialog
            open={restoreConfirm !== null}
            title={
              <>
                Restore family <strong>#{restoreConfirm}</strong>?
              </>
            }
            description="This will also restore all people in the family."
            onConfirm={() => {
              if (restoreConfirm != null) {
                restoreMut?.mutate(restoreConfirm);
                setRestoreConfirm(null);
              }
            }}
            onCancel={() => setRestoreConfirm(null)}
            loading={restoreMut?.isPending}
            confirmLabel="Yes, restore"
            loadingLabel="Restoring…"
            confirmVariant="secondary"
          />

          {/* Lock edit confirmation */}
          <ConfirmDialog
            open={lockEditConfirm}
            title="Edit admin-approved family?"
            description="This family is fully approved and visible to donors. Changes will be immediately visible. Are you sure you want to proceed?"
            onConfirm={handleUpdateConfirmed}
            onCancel={() => {
              setLockEditConfirm(false);
              pendingPayload.current = null;
            }}
            loading={updateMut?.isPending}
            confirmLabel="Yes, update"
            loadingLabel="Updating…"
            confirmVariant="primary"
          />

          {/* Reset wish lock confirmation */}
          <ConfirmDialog
            open={resetConfirm !== null}
            title={
              <>
                Reset wish lock for family <strong>#{resetConfirm}</strong>?
              </>
            }
            description="This will unlock the family's wishes so they can edit them again. Any admin approval will be removed."
            onConfirm={() => {
              if (resetConfirm != null) {
                resetMut.mutate(resetConfirm);
                setResetConfirm(null);
              }
            }}
            onCancel={() => setResetConfirm(null)}
            loading={resetMut.isPending}
            confirmLabel="Yes, reset"
            loadingLabel="Resetting…"
            confirmVariant="secondary"
          />

          {/* Fully approve confirmation */}
          <ConfirmDialog
            open={fullyApproveConfirm !== null}
            title={
              <>
                Fully approve family <strong>#{fullyApproveConfirm}</strong>?
              </>
            }
            description="This will make the family's wishes visible to donors immediately, skipping referrer review."
            onConfirm={() => {
              if (fullyApproveConfirm != null) {
                fullyApproveMut.mutate(fullyApproveConfirm);
                setFullyApproveConfirm(null);
              }
            }}
            onCancel={() => setFullyApproveConfirm(null)}
            loading={fullyApproveMut.isPending}
            confirmLabel="Yes, fully approve"
            loadingLabel="Approving…"
            confirmVariant="primary"
          />

          {/* Pagination */}
          <Pagination
            page={pagination.page}
            totalPages={pageInfo.totalPages}
            total={listData?.total ?? 0}
            pageSize={pagination.pageSize}
            onPageChange={pagination.goToPage}
            onPageSizeChange={pagination.setPageSize}
          />
        </div>

        {/* Errors */}
        <MutationErrors
          mutations={[createMut, updateMut, deleteMut, restoreMut, resetMut, fullyApproveMut].filter(
            (m): m is NonNullable<typeof m> => m != null
          )}
        />
      </main>
    </div>
  );
}
