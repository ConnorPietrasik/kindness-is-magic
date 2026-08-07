/**
 * Admin — Referrer Detail + Families Management
 *
 * View/edit a specific referrer and manage their families.
 * Thin wrapper around HierarchicalManage exercising all features:
 * tabs (active/deleted), pagination, restore confirmation, dialogs.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ActionsDropdown } from "../components/ActionsDropdown";
import { ApprovalBadge } from "../components/ApprovalBadge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ColumnToggle } from "../components/ColumnToggle";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DisplayId } from "../components/DisplayId";
import { defaultFamilyForm, defaultReferrerForm } from "../components/defaults";
import { FamilyForm } from "../components/FamilyForm";
import { BackLink, HeaderBar } from "../components/HeaderBar";
import {
  HierarchicalManage,
  type HierarchicalManageChildCallbacks,
  type HierarchicalManageParentRenderProps,
} from "../components/HierarchicalManage";
import { InfoRow } from "../components/InfoRow";
import { ReferrerForm } from "../components/ReferrerForm";
import { Spinner } from "../components/Spinner";
import { Table, TableBody, TableHead, Td, Th, Tr } from "../components/Table";
import { useToast } from "../context/ToastContext";
import { useColumnVisibility } from "../hooks/useColumnVisibility";
import { useDeliveryUsers } from "../hooks/useDeliveryUsers";
import { useTableWidth } from "../hooks/useTableWidth";
import {
  adminApproveWishes,
  adminCreateFamily,
  adminDeleteFamily,
  adminGetFamily,
  adminGetReferrer,
  adminListDeletedFamilies,
  adminListReferrerFamilies,
  adminResetWishState,
  adminRestoreFamily,
  adminUpdateFamily,
  adminUpdateReferrer,
} from "../lib/api";
import {
  adminDeletedFamilies,
  adminDeletedReferrerFamilies,
  adminFamilies,
  adminPackingSlips,
  adminReferrerDetail,
  adminReferrerFamilies,
  adminReviewQueue,
  adminWishes,
} from "../lib/queryKeys";
import { ROUTES, route } from "../lib/routes";
import { normalizeUpdatePayload } from "../lib/utils";
import type { AdminListParams, FamilyDetail, FamilyPayload, ReferrerDetail } from "../types";

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
export default function AdminReferrerFamilies() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { id: refId } = useParams<{ id: string }>();
  const refIdNum = parseInt(refId!, 10);
  const refIdStr = String(refIdNum);

  const referrerKey = adminReferrerDetail(refIdStr);
  const familiesKey = adminReferrerFamilies(refIdStr);
  const deletedFamiliesKey = adminDeletedReferrerFamilies(refIdStr);

  // Reset wish state mutation
  const resetMut = useMutation({
    mutationFn: adminResetWishState,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: familiesKey });
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
      queryClient.invalidateQueries({ queryKey: familiesKey });
      queryClient.invalidateQueries({ queryKey: adminFamilies });
      queryClient.invalidateQueries({ queryKey: adminReviewQueue });
      queryClient.invalidateQueries({ queryKey: adminPackingSlips });
      queryClient.invalidateQueries({ queryKey: adminWishes });
      toast.success("Family fully approved and visible to donors");
    },
  });

  const [fullyApproveConfirm, setFullyApproveConfirm] = useState<number | null>(null);

  // Delivery users lookup (for dropdown)
  const { deliveryUserMap, deliveryUsersLoading } = useDeliveryUsers();

  // Column visibility (shared with adminFamilies)
  const { visibleColumns, apiColumns } = useColumnVisibility("adminFamilies");
  const { widthClass } = useTableWidth("adminFamilies");

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar title="Kindness is Magic" left={<BackLink to={ROUTES.ADMIN_REFERRERS} label="Referrers" />} />

      <main className={`mx-auto px-4 py-8 sm:px-6 ${widthClass}`}>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">Referrer &amp; Families</h2>
          <ColumnToggle resourceKey="adminFamilies" />
        </div>

        <HierarchicalManage
          parent={{
            id: refIdNum,
            queryKey: referrerKey,
            fetchFn: adminGetReferrer,
            updateApi: adminUpdateReferrer,
            render: (props) => <ReferrerCard {...props} />,
          }}
          child={{
            queryKey: familiesKey,
            listFn: (params) =>
              adminListReferrerFamilies(refIdNum, params ? ({ ...params, columns: apiColumns } as AdminListParams) : undefined),
            detailFn: adminGetFamily,
            createApi: (data) => adminCreateFamily(data),
            updateApi: adminUpdateFamily,
            deleteApi: adminDeleteFamily,
            restoreApi: adminRestoreFamily,
            createNormaliseFn: (formData) => ({ ...formData, referrer_id: refIdNum }),
            updateNormaliseFn: (formData, original) => normalizeUpdatePayload(formData, original) as FamilyPayload,
            formDefault: defaultFamilyForm as unknown as FamilyPayload,
            formComponent: FamilyForm,
            formExtra: { showReferrerNotes: true, deliveryUserMap, deliveryUsersLoading } as Partial<
              React.ComponentProps<typeof FamilyForm>
            >,
            render: (rows, callbacks, ctx) => (
              <FamiliesTable
                rows={rows as FamilyDetail[]}
                callbacks={callbacks}
                isDeletedView={ctx.isDeletedView}
                referrerId={refIdNum}
                visibleColumns={visibleColumns}
                onResetWishState={(id) => resetMut.mutate(id)}
                isResetting={resetMut.isPending}
                onFullyApprove={(id) => fullyApproveMut.mutate(id)}
                isFullyApproving={fullyApproveMut.isPending}
              />
            ),
            title: "Families",
            createButtonLabel: "+ Add Family",
            invalidationKeys: [familiesKey, deletedFamiliesKey, adminFamilies, adminDeletedFamilies, adminWishes],
            entityName: "Family",
          }}
          tabs={{
            deleted: {
              queryKey: deletedFamiliesKey,
              listFn: (params) =>
                adminListDeletedFamilies({
                  page: params?.page ?? 1,
                  page_size: params?.page_size ?? 20,
                  referrer_id: refIdNum,
                  columns: apiColumns,
                }),
              readonly: true,
            },
          }}
          pagination={{ enabled: true }}
          dialogs={{
            deleteDescription: "This will also soft-delete all people in the family.",
            restoreDescription: "This will also restore all people in the family.",
          }}
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
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Parent card render                                                  */
/* ------------------------------------------------------------------ */

function ReferrerCard(props: HierarchicalManageParentRenderProps<ReferrerDetail>) {
  const { data, isEditing, onToggleEdit, isSaving, onSave } = props;

  return (
    <Card className="mb-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold text-gray-900">{data ? data.name : "\u2014"}</h3>
          {data && <span className="text-xs font-mono text-gray-400">#{data.id}</span>}
          {data && (
            <span className="inline-flex items-center rounded-full bg-btn-start px-2 py-0.5 text-xs font-semibold text-white">
              {(data.family_count ?? 0) === 1 ? "1 family" : `${data.family_count ?? 0} families`}
            </span>
          )}
        </div>
        <Button variant="secondary" className="h-8 px-3 text-xs" onClick={onToggleEdit}>
          {isEditing ? "Cancel" : "Edit"}
        </Button>
      </div>

      {isEditing ? (
        <ReferrerForm
          title="Edit Referrer"
          initial={data ?? defaultReferrerForm}
          isEdit={true}
          onSubmit={onSave}
          onCancel={() => onToggleEdit()}
          loading={isSaving}
        />
      ) : (
        data && (
          <div className="space-y-0">
            <InfoRow label="Name" value={data.name} />
            <InfoRow label="Phone" value={data.phone_number} />
            <InfoRow label="Family Limit" value={`${data.family_count ?? 0} / ${data.family_limit}`} isLast />
          </div>
        )
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Children table render                                               */
/* ------------------------------------------------------------------ */

function FamiliesTable({
  rows,
  callbacks,
  isDeletedView,
  referrerId,
  visibleColumns,
  onResetWishState,
  isResetting,
  onFullyApprove,
  isFullyApproving,
}: {
  rows: FamilyDetail[];
  callbacks: HierarchicalManageChildCallbacks;
  isDeletedView: boolean;
  referrerId: number;
  visibleColumns: string[];
  onResetWishState: (id: number) => void;
  isResetting: boolean;
  onFullyApprove: (id: number) => void;
  isFullyApproving: boolean;
}) {
  if (rows.length === 0) {
    return (
      <Card>
        <p className="py-8 text-center text-gray-400">
          {isDeletedView ? "No deleted families for this referrer." : "No families for this referrer yet."}
        </p>
      </Card>
    );
  }

  return (
    <Table>
      <TableHead>
        {visibleColumns.includes("display_id") && <Th>ID</Th>}
        {visibleColumns.includes("family_name") && <Th>Family Name</Th>}
        {visibleColumns.includes("family_wish") && <Th>Family Wish</Th>}
        {visibleColumns.includes("contact_name") && <Th>Contact</Th>}
        {visibleColumns.includes("referrer_id") && <Th>Referrer</Th>}
        {visibleColumns.includes("phone_number") && <Th>Phone</Th>}
        {visibleColumns.includes("person_count") && <Th>People</Th>}
        {visibleColumns.includes("approval_status") && <Th>Approval</Th>}
        {visibleColumns.includes("pickup_window") && <Th>Pickup Window</Th>}
        {visibleColumns.includes("wish_lock_level") && <Th>Lock Level</Th>}
        {visibleColumns.includes("wish_review_requested_at") && <Th>Review Requested</Th>}
        {visibleColumns.includes("wish_rejection_reason") && <Th>Rejection Reason</Th>}
        {visibleColumns.includes("delivery") && <Th>Delivery</Th>}
        <Th>Actions</Th>
      </TableHead>
      <TableBody>
        {rows.map((f) => (
          <React.Fragment key={f.id}>
            <Tr className={getLockLevelRowClass(f.deleted_at, f.wish_lock_level)}>
              {visibleColumns.includes("display_id") && (
                <Td className="whitespace-nowrap text-xs text-gray-400">
                  <DisplayId displayId={f.display_id} familyId={f.id} referrerId={referrerId} />
                </Td>
              )}
              {visibleColumns.includes("family_name") && (
                <Td className={f.deleted_at != null ? "text-gray-400" : ""}>
                  {f.family_name}
                  {f.deleted_at == null && f.referrer_notes != null && (
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
              )}
              {visibleColumns.includes("family_wish") && <Td className="max-w-xs truncate">{f.family_wish ?? ""}</Td>}
              {visibleColumns.includes("contact_name") && <Td>{f.contact_name}</Td>}
              {visibleColumns.includes("referrer_id") && (
                <Td>
                  {f.referrer_id != null ? (
                    <Link
                      to={route.adminReferrerFamilies(f.referrer_id)}
                      className="text-sm text-violet-600 transition-colors hover:text-violet-800"
                    >
                      {f.referrer_name || `ID ${f.referrer_id}`}
                    </Link>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </Td>
              )}
              {visibleColumns.includes("phone_number") && <Td>{f.phone_number || "—"}</Td>}
              {visibleColumns.includes("person_count") && <Td className="whitespace-nowrap">{f.person_count ?? 0}</Td>}
              {visibleColumns.includes("approval_status") && (
                <Td>
                  <ApprovalBadge status={f.approval_status} />
                </Td>
              )}
              {visibleColumns.includes("pickup_window") && <Td className="text-xs">{f.pickup_window || "—"}</Td>}
              {visibleColumns.includes("wish_lock_level") && (
                <Td>
                  <span className="text-xs capitalize">{f.wish_lock_level}</span>
                </Td>
              )}
              {visibleColumns.includes("wish_review_requested_at") && (
                <Td className="text-xs text-gray-500">
                  {f.wish_review_requested_at ? new Date(f.wish_review_requested_at).toLocaleDateString() : "—"}
                </Td>
              )}
              {visibleColumns.includes("wish_rejection_reason") && (
                <Td className="max-w-xs text-xs text-gray-500 truncate">{f.wish_rejection_reason || "—"}</Td>
              )}
              {visibleColumns.includes("delivery") && (
                <Td>{f.delivery_user_name || (f.delivery_user_id != null ? `ID ${f.delivery_user_id}` : "—")}</Td>
              )}
              <Td>
                <div className="flex items-center gap-2">
                  {!isDeletedView && f.deleted_at == null && (
                    <Link
                      to={`${route.adminFamilyPeople(f.id)}?from=referrer`}
                      className="inline-flex items-center rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700"
                    >
                      Manage
                    </Link>
                  )}
                  {!isDeletedView && f.deleted_at == null && (
                    <>
                      <Button
                        variant="secondary"
                        className="h-7 px-2 text-xs"
                        onClick={() => (callbacks.isEditing(f.id) ? callbacks.cancelForm?.() : callbacks.onEdit(f.id))}
                      >
                        {callbacks.isEditing(f.id) ? "Done" : "Edit"}
                      </Button>
                      <ActionsDropdown
                        items={[
                          ...(f.wish_lock_level !== "family"
                            ? [
                                {
                                  label: "Reset Lock",
                                  variant: "secondary" as const,
                                  onClick: () => onResetWishState(f.id),
                                },
                              ]
                            : []),
                          ...(f.wish_lock_level !== "admin"
                            ? [
                                {
                                  label: "Fully Approve",
                                  onClick: () => onFullyApprove(f.id),
                                },
                              ]
                            : []),
                          {
                            label: "Delete",
                            variant: "danger" as const,
                            onClick: () => callbacks.onDelete(f.id),
                          },
                        ]}
                        disabled={callbacks.isDeleting || isResetting || isFullyApproving}
                      />
                    </>
                  )}
                  {isDeletedView && (
                    <Button
                      variant="secondary"
                      className="h-7 px-2 text-xs"
                      onClick={() => callbacks.onRestore(f.id)}
                      disabled={callbacks.isRestoring}
                    >
                      Restore
                    </Button>
                  )}
                </div>
              </Td>
            </Tr>
            {callbacks.editingId === f.id && (
              <Tr key={`${f.id}-edit`}>
                <Td colSpan={visibleColumns.length + 1} className="!py-3">
                  <div className="rounded-xl bg-gray-50 p-4">
                    {callbacks.detailLoading ? (
                      <div className="flex items-center justify-center gap-3 py-6 text-btn-start">
                        <Spinner size="sm" />
                        <span className="text-sm font-medium">Loading…</span>
                      </div>
                    ) : callbacks.editFormComponent && callbacks.editFormProps ? (
                      <callbacks.editFormComponent {...callbacks.editFormProps} />
                    ) : null}
                  </div>
                </Td>
              </Tr>
            )}
          </React.Fragment>
        ))}
      </TableBody>
    </Table>
  );
}
