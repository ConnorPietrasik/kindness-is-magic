/**
 * Admin — Manage Referrers
 *
 * List, create, edit, delete referrers.
 * Uses useCrudManager for data fetching and mutations.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { defaultReferrerForm } from "../components/defaults";
import { FormField } from "../components/FormField";
import { BackLink, HeaderBar } from "../components/HeaderBar";
import { MutationErrors } from "../components/MutationErrors";
import { Pagination } from "../components/Pagination";
import { PageSpinner, Spinner } from "../components/Spinner";
import { Table, TableBody, TableHead, Td, Th, Tr } from "../components/Table";
import { useCrudManager } from "../hooks/useCrudManager";
import { getPaginationInfo, usePagination } from "../hooks/usePagination";
import { adminCreateReferrer, adminDeleteReferrer, adminGetReferrer, adminListReferrers, adminUpdateReferrer } from "../lib/api";
import { normalizeUpdatePayload } from "../lib/utils";
import type { PaginationParams, ReferrerDetail, ReferrerPayload } from "../types";

const REFERRER_KEYS = ["adminReferrers"];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function AdminReferrers() {
  const pagination = usePagination();
  const [includeDeleted, setIncludeDeleted] = useState(false);

  // Merge pagination params with include_deleted for cache separation
  const listParams = useMemo<PaginationParams>(
    () => ({ ...pagination.params, include_deleted: includeDeleted }),
    [pagination.params, includeDeleted]
  );

  const {
    listData,
    listLoading,
    detail,
    detailLoading,
    createMut,
    updateMut,
    deleteMut,
    showForm,
    editingId,
    deleteConfirm,
    openCreate,
    openEdit,
    cancelForm,
    confirmDelete,
    cancelDelete,
  } = useCrudManager({
    rootKey: REFERRER_KEYS,
    listFn: adminListReferrers,
    listParams,
    detailFn: adminGetReferrer,
    createFn: adminCreateReferrer,
    updateFn: adminUpdateReferrer,
    deleteFn: adminDeleteReferrer,
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

  if (listLoading) return <PageSpinner />;

  const referrers = listData?.referrers ?? [];

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar title="Kindness is Magic" left={<BackLink />} />

      <main className="mx-auto max-w-[900px] px-4 py-8 sm:px-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-violet-950">Manage Referrers</h2>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={includeDeleted}
                onChange={(e) => setIncludeDeleted(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-violet-600 focus:ring-violet-500"
              />
              Show deleted
            </label>
            <Button onClick={openCreate}>+ Add Referrer</Button>
          </div>
        </div>

        {/* Create / Edit form */}
        {editingId && detailLoading && (
          <Card className="mb-6 flex items-center justify-center gap-2 border border-gray-200 py-6 text-btn-start">
            <Spinner size="sm" />
            <span>Loading…</span>
          </Card>
        )}

        {(showForm || (editingId && detail)) && (
          <ReferrerForm
            title={editingId ? "Edit Referrer" : "Add Referrer"}
            initial={editingId ? (detail ?? defaultReferrerForm) : defaultReferrerForm}
            isEdit={!!editingId}
            onSubmit={editingId ? handleUpdate : handleCreate}
            onCancel={cancelForm}
            loading={!!(createMut?.isPending || updateMut?.isPending)}
          />
        )}

        {/* Table */}
        {referrers.length === 0 ? (
          <Card>
            <p className="py-8 text-center text-gray-400">No referrers yet.</p>
          </Card>
        ) : (
          <Table>
            <TableHead>
              <Th>ID</Th>
              <Th>Name</Th>
              <Th>Family Limit</Th>
              {includeDeleted && <Th>Deleted</Th>}
              <Th>Actions</Th>
            </TableHead>
            <TableBody>
              {referrers.map((r) => (
                <Tr key={r.id}>
                  <Td>{r.id}</Td>
                  <Td className={r.deleted_at != null ? "text-gray-400" : ""}>{r.name}</Td>
                  <Td>{r.family_limit}</Td>
                  {includeDeleted && (
                    <Td>
                      {r.deleted_at != null ? (
                        <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Yes</span>
                      ) : (
                        <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">No</span>
                      )}
                    </Td>
                  )}
                  <Td>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="px-3 py-1.5 text-xs"
                        onClick={() => openEdit(r.id)}
                        disabled={!!editingId}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        className="px-3 py-1.5 text-xs"
                        onClick={() => confirmDelete(r.id)}
                        disabled={deleteMut?.isPending}
                      >
                        Delete
                      </Button>
                    </div>
                  </Td>
                </Tr>
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

        {/* Pagination */}
        <Pagination
          page={pagination.page}
          totalPages={pageInfo.totalPages}
          total={listData?.total ?? 0}
          pageSize={pagination.pageSize}
          onPageChange={pagination.goToPage}
          onPageSizeChange={pagination.setPageSize}
        />

        {/* Errors */}
        <MutationErrors mutations={[createMut, updateMut, deleteMut].filter((m): m is NonNullable<typeof m> => m != null)} />
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ReferrerForm sub-component (inline — not shared per spec)           */
/* ------------------------------------------------------------------ */
interface ReferrerFormProps {
  title: string;
  initial: Partial<ReferrerDetail>;
  isEdit: boolean;
  onSubmit: (data: ReferrerPayload) => void;
  onCancel: () => void;
  loading: boolean;
}

function ReferrerForm({ title, initial, isEdit, onSubmit, onCancel, loading }: ReferrerFormProps) {
  const [form, setForm] = useState<ReferrerPayload>(() => ({ ...initial }));
  const [pendingDelete, setPendingDelete] = useState(false);

  useEffect(() => {
    setForm({ ...initial });
  }, [initial]);

  const update = (key: string, val: unknown) => setForm((p) => ({ ...p, [key]: val }));

  const originalIsDeleted = useMemo(() => (initial as ReferrerDetail).deleted_at != null, [initial]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      // Check if user is soft-deleting
      if (isEdit && form.deleted_at != null && !originalIsDeleted) {
        setPendingDelete(true);
        return;
      }

      onSubmit(form);
    },
    [form, isEdit, onSubmit, originalIsDeleted]
  );

  const handleConfirmDelete = useCallback(() => {
    setPendingDelete(false);
    onSubmit(form);
  }, [form, onSubmit]);

  return (
    <>
      <Card className="mb-6 border border-gray-200">
        <h3 className="mb-4 text-lg font-semibold text-violet-950">{title}</h3>
        <form onSubmit={handleSubmit}>
          <div className="flex flex-col gap-4 sm:flex-row">
            <FormField
              label="Name"
              fieldProps={{
                value: form.name,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("name", e.target.value),
                required: true,
                maxLength: 60,
              }}
            />
            <FormField
              label="Family Limit"
              type="number"
              fieldProps={{
                value: form.family_limit,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("family_limit", parseInt(e.target.value, 10) || 1),
                required: true,
                min: 1,
                max: 999,
              }}
            />
            <FormField
              label="Phone"
              fieldProps={{
                value: form.phone_number,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("phone_number", e.target.value),
                required: true,
                maxLength: 20,
              }}
            />
          </div>

          {/* Soft-delete toggle (admin edit only) */}
          {isEdit && (
            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="referrer_deleted_at"
                checked={form.deleted_at != null}
                onChange={(e) => update("deleted_at", e.target.checked ? new Date().toISOString() : null)}
                className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
              />
              <label htmlFor="referrer_deleted_at" className="text-sm font-medium text-gray-700">
                {form.deleted_at != null ? "Mark as deleted" : "Soft-deleted"}
                {form.deleted_at != null && !originalIsDeleted && (
                  <span className="ml-1 text-xs text-red-600">(requires confirmation)</span>
                )}
              </label>
            </div>
          )}

          <div className="mt-4 flex gap-2">
            <Button type="submit" loading={loading}>
              {loading ? "Saving…" : isEdit ? "Update" : "Create"}
            </Button>
            <Button variant="secondary" type="button" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </form>
      </Card>

      {/* Confirmation dialog when soft-deleting */}
      <ConfirmDialog
        open={pendingDelete}
        title="Soft-delete this referrer?"
        description="Families will be reassigned to orphan. Linked users will be detached. The action can be reversed by unchecking 'Soft-deleted'."
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(false)}
      />
    </>
  );
}
