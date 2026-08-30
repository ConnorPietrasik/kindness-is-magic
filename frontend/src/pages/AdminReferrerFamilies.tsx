/**
 * Admin — Referrer Detail + Families Management
 *
 * View/edit a specific referrer and manage their families.
 * Thin wrapper around HierarchicalManage exercising all features:
 * tabs (active/deleted), pagination, restore confirmation, dialogs.
 */

import React, { useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ColumnToggle } from "../components/ColumnToggle";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { defaultFamilyForm, defaultReferrerForm } from "../components/defaults";
import { FamilyForm } from "../components/FamilyForm";
import { FamilyTableRow } from "../components/FamilyTableRow";
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
import { useColumnVisibility } from "../hooks/useColumnVisibility";
import { useDeliveryUsers } from "../hooks/useDeliveryUsers";
import { useTableWidth } from "../hooks/useTableWidth";
import { useWishLockActions } from "../hooks/useWishLockActions";
import {
  adminCreateFamily,
  adminDeleteFamily,
  adminGetFamily,
  adminGetReferrer,
  adminListDeletedFamilies,
  adminListReferrerFamilies,
  adminRestoreFamily,
  adminUpdateFamily,
  adminUpdateReferrer,
} from "../lib/api";
import {
  adminDeletedFamilies,
  adminDeletedReferrerFamilies,
  adminFamilies,
  adminReferrerDetail,
  adminReferrerFamilies,
  adminWishes,
} from "../lib/queryKeys";
import { ROUTES } from "../lib/routes";
import { getLockLevelRowClass, normalizeUpdatePayload } from "../lib/utils";
import type { AdminListParams, FamilyDetail, FamilyPayload, ReferrerDetail } from "../types";

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function AdminReferrerFamilies() {
  const { id: refId } = useParams<{ id: string }>();
  const refIdNum = parseInt(refId!, 10);
  const refIdStr = String(refIdNum);

  const referrerKey = adminReferrerDetail(refIdStr);
  const familiesKey = adminReferrerFamilies(refIdStr);
  const deletedFamiliesKey = adminDeletedReferrerFamilies(refIdStr);

  // Wish-lock row actions (reset lock / fully approve) — also refreshes
  // this referrer's scoped family list
  const { resetMut, fullyApproveMut } = useWishLockActions({ extraInvalidationKeys: [familiesKey] });

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
                visibleColumns={visibleColumns}
                onResetLock={(id) => resetMut.mutate(id)}
                onFullyApprove={(id) => fullyApproveMut.mutate(id)}
                isLockActionPending={resetMut.isPending || fullyApproveMut.isPending}
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
  visibleColumns,
  onResetLock,
  onFullyApprove,
  isLockActionPending,
}: {
  rows: FamilyDetail[];
  callbacks: HierarchicalManageChildCallbacks;
  isDeletedView: boolean;
  visibleColumns: string[];
  onResetLock: (id: number) => void;
  onFullyApprove: (id: number) => void;
  isLockActionPending: boolean;
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
      {/* Header columns follow the same order as FamilyTableRow (shared "adminFamilies" column registry). */}
      <TableHead>
        {visibleColumns.includes("display_id") && <Th>ID</Th>}
        {visibleColumns.includes("family_name") && <Th>Family Name</Th>}
        {visibleColumns.includes("family_wish") && <Th>Family Wish</Th>}
        {visibleColumns.includes("contact_name") && <Th>Contact</Th>}
        {visibleColumns.includes("referrer_id") && <Th>Referrer</Th>}
        {visibleColumns.includes("delivery") && <Th>Delivery</Th>}
        {visibleColumns.includes("claim") && <Th>Claim</Th>}
        {visibleColumns.includes("phone_number") && <Th>Phone</Th>}
        {visibleColumns.includes("person_count") && <Th>People</Th>}
        {visibleColumns.includes("verification_status") && <Th>Verification</Th>}
        {visibleColumns.includes("pickup_window") && <Th>Pickup Window</Th>}
        {visibleColumns.includes("wish_lock_level") && <Th>Lock Level</Th>}
        {visibleColumns.includes("wish_review_requested_at") && <Th>Review Requested</Th>}
        {visibleColumns.includes("wish_rejection_reason") && <Th>Rejection Reason</Th>}
        <Th>Actions</Th>
      </TableHead>
      <TableBody>
        {rows.map((f) => (
          <React.Fragment key={f.id}>
            <Tr className={getLockLevelRowClass(f)}>
              <FamilyTableRow
                family={f}
                visibleColumns={visibleColumns}
                isDeletedView={isDeletedView}
                isEditing={callbacks.isEditing(f.id)}
                fromReferrer
                onEdit={(id) => (callbacks.isEditing(id) ? callbacks.cancelForm?.() : callbacks.onEdit(id))}
                onDelete={callbacks.onDelete}
                onRestore={callbacks.onRestore}
                onResetLock={onResetLock}
                onFullyApprove={onFullyApprove}
                isDeleting={callbacks.isDeleting}
                isRestoring={callbacks.isRestoring}
                isLockActionPending={isLockActionPending}
              />
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
