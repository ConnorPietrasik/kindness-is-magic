/**
 * Admin — Manage Referrers
 *
 * List, create, edit, delete referrers.
 * Uses useCrudManager for data fetching and mutations.
 * Separate "Deleted" tab calls the /deleted endpoint.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ActionsDropdown } from "../components/ActionsDropdown";
import { ApprovalBadge } from "../components/ApprovalBadge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ColumnToggle } from "../components/ColumnToggle";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { CrudTabs } from "../components/CrudTabs";
import { defaultReferrerForm } from "../components/defaults";
import { HeaderBar } from "../components/HeaderBar";
import { MutationErrors } from "../components/MutationErrors";
import { Pagination } from "../components/Pagination";
import { ReferrerForm } from "../components/ReferrerForm";
import { PageSpinner, Spinner } from "../components/Spinner";
import { Table, TableBody, TableHead, Td, Th, Tr } from "../components/Table";
import { useColumnVisibility } from "../hooks/useColumnVisibility";
import { useCrudManager } from "../hooks/useCrudManager";
import { useCrudTabs } from "../hooks/useCrudTabs";
import { useDebouncedState } from "../hooks/useDebouncedState";
import { getPaginationInfo, usePagination } from "../hooks/usePagination";
import { useTableWidth } from "../hooks/useTableWidth";
import {
  adminApproveReferrer,
  adminCreateReferrer,
  adminDeleteReferrer,
  adminGetReferrer,
  adminListDeletedReferrers,
  adminListReferrers,
  adminRejectReferrer,
  adminRestoreReferrer,
  adminUpdateReferrer,
} from "../lib/api";
import { adminDeletedReferrers, adminReferrers, adminReferrersDropdown } from "../lib/queryKeys";
import { route } from "../lib/routes";
import { normalizeUpdatePayload } from "../lib/utils";
import type { AdminReferrersListParams, ReferrerDetail, ReferrerPayload } from "../types";

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function AdminReferrers() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const pagination = usePagination();
  const { viewTab, isDeletedView, handleTabChange } = useCrudTabs({ pagination });
  const [restoreConfirm, setRestoreConfirm] = useState<number | null>(null);
  const [approveConfirm, setApproveConfirm] = useState<number | null>(null);
  const [rejectConfirm, setRejectConfirm] = useState<number | null>(null);
  const [approvalFilter, setApprovalFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");

  const approveMut = useMutation({
    mutationFn: adminApproveReferrer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminReferrers });
    },
  });

  const rejectMut = useMutation({
    mutationFn: adminRejectReferrer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminReferrers });
    },
  });

  // Column visibility
  const { visibleColumns, apiColumns } = useColumnVisibility("adminReferrers");
  const { widthClass } = useTableWidth("adminReferrers");

  const debouncedSearch = useDebouncedState(searchQuery, 1000, () => pagination.goToPage(1));

  // Build list params (no include_deleted — deleted uses separate endpoint)
  const listParams = useMemo<AdminReferrersListParams>(
    () => ({
      ...pagination.params,
      columns: apiColumns,
      search: debouncedSearch || undefined,
      approval_status: approvalFilter || undefined,
    }),
    [pagination.params, apiColumns, debouncedSearch, approvalFilter]
  );

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
    rootKey: isDeletedView ? adminDeletedReferrers : adminReferrers,
    listFn: isDeletedView ? adminListDeletedReferrers : adminListReferrers,
    listParams,
    detailFn: adminGetReferrer,
    createFn: isDeletedView ? undefined : adminCreateReferrer,
    updateFn: isDeletedView ? undefined : adminUpdateReferrer,
    deleteFn: isDeletedView ? undefined : adminDeleteReferrer,
    restoreFn: adminRestoreReferrer,
    invalidationKeys: [adminReferrers, adminDeletedReferrers, adminReferrersDropdown],
    entityName: "Referrer",
  });

  const pageInfo = useMemo(
    () => getPaginationInfo(listData?.total ?? 0, pagination.page, pagination.pageSize),
    [listData?.total, pagination.page, pagination.pageSize]
  );

  function handleCreate(formData: ReferrerPayload) {
    createMut?.mutate(formData);
  }

  function handleUpdate(formData: ReferrerPayload) {
    if (!editingId) return;
    const payload = normalizeUpdatePayload(formData, detail as ReferrerDetail);
    updateMut?.mutate({ id: editingId, data: payload as ReferrerPayload });
  }

  const referrers = listData?.referrers ?? [];

  if (listLoading) return <PageSpinner />;

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar title="Kindness is Magic" />

      <main className={`mx-auto px-4 py-8 sm:px-6 ${widthClass}`}>
        {/* Header */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold text-violet-950">Manage Referrers</h2>
          <div className="flex items-center gap-3">
            <Button onClick={() => navigate(route.adminInviteCodes(true))}>Invite Referrers</Button>
            {!isDeletedView && <ColumnToggle resourceKey="adminReferrers" />}
            {!isDeletedView && <Button onClick={openCreate}>+ Add Referrer</Button>}
          </div>
        </div>

        {/* Tabs */}
        <CrudTabs viewTab={viewTab} onChange={handleTabChange} />

        {/* Filters */}
        {!isDeletedView && (
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <select
              aria-label="Approval status filter"
              value={approvalFilter}
              onChange={(e) => {
                setApprovalFilter(e.target.value);
                pagination.goToPage(1);
              }}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
            >
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
            <input
              type="text"
              placeholder="Search by name…"
              aria-label="Search by name"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
              autoComplete="off"
            />
          </div>
        )}

        {/* Tab panel content */}
        <div role="tabpanel">
          {/* Create form (active tab only) */}
          {showForm && (
            <ReferrerForm
              title="Add Referrer"
              initial={defaultReferrerForm}
              isEdit={false}
              onSubmit={handleCreate}
              onCancel={cancelForm}
              loading={!!createMut?.isPending}
            />
          )}

          {/* Table */}
          {referrers.length === 0 ? (
            <Card>
              <p className="py-8 text-center text-gray-400">{isDeletedView ? "No deleted referrers." : "No referrers yet."}</p>
            </Card>
          ) : (
            <Table>
              <TableHead>
                <Th>ID</Th>
                {visibleColumns.includes("name") && <Th>Name</Th>}
                {visibleColumns.includes("family_limit") && <Th>Family Limit</Th>}
                {visibleColumns.includes("phone_number") && <Th>Phone</Th>}
                {visibleColumns.includes("family_invite_code") && <Th>Invite Code</Th>}
                {visibleColumns.includes("approval_status") && <Th>Approval</Th>}
                {visibleColumns.includes("approved_by_admin_name") && <Th>Approved By</Th>}
                {visibleColumns.includes("approved_at") && <Th>Approved At</Th>}
                {visibleColumns.includes("created_at") && <Th>Created</Th>}
                <Th>Actions</Th>
              </TableHead>
              <TableBody>
                {referrers.map((r) => (
                  <React.Fragment key={r.id}>
                    <Tr>
                      <Td>{r.id}</Td>
                      {visibleColumns.includes("name") && <Td className={r.deleted_at != null ? "text-gray-400" : ""}>{r.name}</Td>}
                      {visibleColumns.includes("family_limit") && (
                        <Td>
                          {r.family_count ?? 0} / {r.family_limit}
                        </Td>
                      )}
                      {visibleColumns.includes("phone_number") && <Td>{r.phone_number || "—"}</Td>}
                      {visibleColumns.includes("family_invite_code") && <Td className="font-mono text-xs">{r.family_invite_code}</Td>}
                      {visibleColumns.includes("approval_status") && (
                        <Td>
                          <div className="flex items-center gap-2">
                            <ApprovalBadge status={r.approval_status} />
                            {!isDeletedView && !r.deleted_at && r.approval_status === "pending" && (
                              <>
                                <Button
                                  variant="success"
                                  size="sm"
                                  className="px-2 py-1 text-xs"
                                  onClick={() => setApproveConfirm(r.id)}
                                  disabled={approveMut.isPending || rejectMut.isPending}
                                >
                                  Approve
                                </Button>
                                <Button
                                  variant="danger"
                                  size="sm"
                                  className="px-2 py-1 text-xs"
                                  onClick={() => setRejectConfirm(r.id)}
                                  disabled={approveMut.isPending || rejectMut.isPending}
                                >
                                  Reject
                                </Button>
                              </>
                            )}
                          </div>
                        </Td>
                      )}
                      {visibleColumns.includes("approved_by_admin_name") && <Td>{r.approved_by_admin_name || "—"}</Td>}
                      {visibleColumns.includes("approved_at") && (
                        <Td className="text-xs text-gray-500">{r.approved_at ? new Date(r.approved_at).toLocaleDateString() : "—"}</Td>
                      )}
                      {visibleColumns.includes("created_at") && (
                        <Td className="text-xs text-gray-500">{new Date(r.created_at).toLocaleDateString()}</Td>
                      )}
                      <Td>
                        <div className="flex flex-wrap gap-2">
                          {!isDeletedView && !r.deleted_at && (
                            <Link
                              to={route.adminReferrerFamilies(r.id)}
                              className="inline-flex items-center rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700"
                            >
                              Manage
                            </Link>
                          )}
                          {!isDeletedView && !r.deleted_at && (
                            <>
                              <Button
                                variant="secondary"
                                size="sm"
                                className="px-3 py-1.5 text-xs"
                                onClick={() => (editingId === r.id ? cancelForm() : openEdit(r.id))}
                              >
                                {editingId === r.id ? "Done" : "Edit"}
                              </Button>
                              {r.approval_status === "pending" && (
                                <>
                                  <Button
                                    variant="success"
                                    size="sm"
                                    className="px-2 py-1 text-xs"
                                    onClick={() => setApproveConfirm(r.id)}
                                    disabled={approveMut.isPending || rejectMut.isPending}
                                  >
                                    Approve
                                  </Button>
                                  <Button
                                    variant="danger"
                                    size="sm"
                                    className="px-2 py-1 text-xs"
                                    onClick={() => setRejectConfirm(r.id)}
                                    disabled={approveMut.isPending || rejectMut.isPending}
                                  >
                                    Reject
                                  </Button>
                                </>
                              )}
                              <ActionsDropdown
                                items={[
                                  ...(!isDeletedView && !r.deleted_at && r.approval_status === "pending"
                                    ? [
                                        {
                                          label: "Approve",
                                          onClick: () => setApproveConfirm(r.id),
                                        },
                                        {
                                          label: "Reject",
                                          variant: "danger" as const,
                                          onClick: () => setRejectConfirm(r.id),
                                        },
                                      ]
                                    : []),
                                  {
                                    label: "Delete",
                                    variant: "danger" as const,
                                    onClick: () => confirmDelete(r.id),
                                  },
                                ]}
                                disabled={deleteMut?.isPending || approveMut.isPending || rejectMut.isPending}
                              />
                            </>
                          )}
                          {isDeletedView && (
                            <Button
                              variant="secondary"
                              size="sm"
                              className="px-3 py-1.5 text-xs"
                              onClick={() => setRestoreConfirm(r.id)}
                              disabled={restoreMut?.isPending}
                            >
                              Restore
                            </Button>
                          )}
                        </div>
                      </Td>
                    </Tr>
                    {editingId === r.id && (
                      <Tr key={`${r.id}-edit`}>
                        <Td colSpan={visibleColumns.length + 2} className="!py-3">
                          <div className="rounded-xl bg-gray-50 p-4">
                            {detailLoading ? (
                              <div className="flex items-center justify-center gap-3 py-6 text-btn-start">
                                <Spinner size="sm" />
                                <span className="text-sm font-medium">Loading…</span>
                              </div>
                            ) : detail ? (
                              <ReferrerForm
                                title={`Edit Referrer #${r.id}`}
                                initial={detail}
                                isEdit={true}
                                onSubmit={handleUpdate}
                                onCancel={cancelForm}
                                loading={!!updateMut?.isPending}
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

          {/* Delete confirmation */}
          <ConfirmDialog
            open={deleteConfirm !== null}
            title={
              <>
                Delete referrer <strong>#{deleteConfirm}</strong>?
              </>
            }
            description="Families will be reassigned to orphan. Linked users will be detached."
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
                Restore referrer <strong>#{restoreConfirm}</strong>?
              </>
            }
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

          {/* Approve confirmation */}
          <ConfirmDialog
            open={approveConfirm !== null}
            title={<>Approve this referrer?</>}
            description="They will be able to send family invite emails and will receive a notification."
            onConfirm={() => {
              if (approveConfirm != null) {
                approveMut.mutate(approveConfirm);
                setApproveConfirm(null);
              }
            }}
            onCancel={() => setApproveConfirm(null)}
            loading={approveMut.isPending}
            confirmLabel="Yes, approve"
            loadingLabel="Approving…"
            confirmVariant="secondary"
          />

          {/* Reject confirmation */}
          <ConfirmDialog
            open={rejectConfirm !== null}
            title={<>Reject this referrer?</>}
            description="They will lose access and will receive a notification."
            onConfirm={() => {
              if (rejectConfirm != null) {
                rejectMut.mutate(rejectConfirm);
                setRejectConfirm(null);
              }
            }}
            onCancel={() => setRejectConfirm(null)}
            loading={rejectMut.isPending}
            confirmLabel="Yes, reject"
            loadingLabel="Rejecting…"
            confirmVariant="danger"
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
          mutations={[createMut, updateMut, deleteMut, restoreMut, approveMut, rejectMut].filter(
            (m): m is NonNullable<typeof m> => m != null
          )}
        />
      </main>
    </div>
  );
}
