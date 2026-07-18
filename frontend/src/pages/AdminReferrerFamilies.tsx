/**
 * Admin — Referrer Detail + Families Management
 *
 * View/edit a specific referrer and manage their families.
 * Thin wrapper around HierarchicalManage.
 * Each family row has a "Manage" link to that family's people page.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { defaultFamilyForm, defaultReferrerForm } from "../components/defaults";
import { FamilyForm } from "../components/FamilyForm";
import { FormField } from "../components/FormField";
import { BackLink, HeaderBar } from "../components/HeaderBar";
import { InfoRow } from "../components/InfoRow";
import { MutationErrors } from "../components/MutationErrors";
import { Pagination } from "../components/Pagination";
import { PageSpinner, Spinner } from "../components/Spinner";
import { Table, TableBody, TableHead, Td, Th, Tr } from "../components/Table";
import { useCrudManager } from "../hooks/useCrudManager";
import { getPaginationInfo, usePagination } from "../hooks/usePagination";
import {
  adminCreateFamily,
  adminDeleteFamily,
  adminGetFamily,
  adminGetReferrer,
  adminListReferrerFamilies,
  adminRestoreFamily,
  adminUpdateFamily,
  adminUpdateReferrer,
} from "../lib/api";
import { ROUTES, route } from "../lib/routes";
import { normalizeUpdatePayload } from "../lib/utils";
import type { FamilyDetail, FamilyPayload, PaginationParams, ReferrerDetail, ReferrerPayload } from "../types";

const REFERRER_KEYS = ["adminReferrers"];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function AdminReferrerFamilies() {
  const { id: refId } = useParams<{ id: string }>();
  const refIdNum = parseInt(refId!, 10);
  const refIdStr = String(refIdNum);

  const referrerKey = [...REFERRER_KEYS, refIdStr];
  const familiesKey = ["adminReferrerFamilies", refIdStr];

  const queryClient = useQueryClient();
  const pagination = usePagination();
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [showEditReferrer, setShowEditReferrer] = useState(false);
  const [restoreConfirm, setRestoreConfirm] = useState<number | null>(null);

  // Referrer detail
  const { data: referrerData, isLoading: referrerLoading } = useQuery({
    queryKey: referrerKey,
    queryFn: () => adminGetReferrer(refIdNum),
  });

  // Referrer update mutation
  const referrerUpdateMut = useMutation({
    mutationFn: (data: ReferrerPayload) => adminUpdateReferrer(refIdNum, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: referrerKey });
      setShowEditReferrer(false);
    },
  });

  // Families CRUD
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
    rootKey: familiesKey,
    listFn: (params) => adminListReferrerFamilies(refIdNum, params as PaginationParams),
    listParams,
    detailFn: adminGetFamily,
    createFn: adminCreateFamily,
    updateFn: adminUpdateFamily,
    deleteFn: adminDeleteFamily,
    restoreFn: adminRestoreFamily,
    invalidationKeys: [familiesKey],
  });

  const pageInfo = useMemo(
    () => getPaginationInfo(listData?.total ?? 0, pagination.page, pagination.pageSize),
    [listData?.total, pagination.page, pagination.pageSize]
  );

  function handleCreate(formData: FamilyPayload) {
    createMut?.mutate({ ...formData, referrer_id: refIdNum });
  }

  function handleUpdate(formData: FamilyPayload) {
    if (!editingId) return;
    const payload = normalizeUpdatePayload(formData, detail as FamilyDetail);
    updateMut?.mutate({ id: editingId, data: payload as FamilyPayload });
  }

  function handleUpdateReferrer(formData: ReferrerPayload) {
    const payload = normalizeUpdatePayload(formData, referrerData as ReferrerDetail);
    referrerUpdateMut.mutate(payload as ReferrerPayload);
  }

  if (referrerLoading || listLoading) return <PageSpinner />;

  const families = listData?.families ?? [];

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar title="Kindness is Magic" left={<BackLink to={ROUTES.ADMIN_REFERRERS} label="Referrers" />} />

      <main className="mx-auto max-w-[960px] px-4 py-8 sm:px-6">
        <h2 className="mb-6 text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">Referrer &amp; Families</h2>

        {/* ── Referrer info card ──────────────────────────────── */}
        <Card className="mb-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-gray-900">{referrerData ? referrerData.name : "\u2014"}</h3>
              {referrerData && (
                <span className="inline-flex items-center rounded-full bg-btn-start px-2 py-0.5 text-xs font-semibold text-white">
                  {(referrerData.family_count ?? 0) === 1 ? "1 family" : `${referrerData.family_count ?? 0} families`}
                </span>
              )}
            </div>
            <Button variant="secondary" className="h-8 px-3 text-xs" onClick={() => setShowEditReferrer(!showEditReferrer)}>
              {showEditReferrer ? "Cancel" : "Edit"}
            </Button>
          </div>

          {showEditReferrer ? (
            <ReferrerForm
              initial={referrerData ?? defaultReferrerForm}
              onSubmit={handleUpdateReferrer}
              onCancel={() => setShowEditReferrer(false)}
              loading={referrerUpdateMut.isPending}
            />
          ) : (
            referrerData && (
              <div className="space-y-0">
                <InfoRow label="Name" value={referrerData.name} />
                <InfoRow label="Phone" value={referrerData.phone_number} />
                <InfoRow label="Family Limit" value={String(referrerData.family_limit)} isLast />
              </div>
            )
          )}
        </Card>

        {/* ── Families section ────────────────────────────────── */}
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">Families</h3>
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
            <Button onClick={openCreate}>+ Add Family</Button>
          </div>
        </div>

        {/* Create / Edit form */}
        {editingId && detailLoading && (
          <Card className="mb-6 flex items-center justify-center gap-2 border border-gray-200 py-6 text-gray-400">
            <Spinner size="sm" />
            <span className="text-sm">Loading…</span>
          </Card>
        )}

        {(showForm || (editingId && detail)) && (
          <FamilyForm
            title={editingId ? "Edit Family" : "Add Family"}
            initial={editingId ? (detail ?? defaultFamilyForm) : { ...defaultFamilyForm, referrer_id: refIdNum }}
            isEdit={!!editingId}
            onSubmit={editingId ? handleUpdate : handleCreate}
            onCancel={cancelForm}
            loading={createMut?.isPending || updateMut?.isPending}
          />
        )}

        {/* Table */}
        {families.length === 0 ? (
          <Card>
            <p className="py-8 text-center text-gray-400">No families for this referrer yet.</p>
          </Card>
        ) : (
          <Table>
            <TableHead>
              <Th>ID</Th>
              <Th>Family Name</Th>
              <Th>Contact</Th>
              <Th>People</Th>
              {includeDeleted && <Th>Deleted</Th>}
              <Th>Actions</Th>
            </TableHead>
            <TableBody>
              {families.map((f) => (
                <Tr key={f.id}>
                  <Td className="whitespace-nowrap text-xs text-gray-400">{f.id}</Td>
                  <Td className={f.deleted_at != null ? "text-gray-400" : ""}>{f.family_name}</Td>
                  <Td>{f.contact_name}</Td>
                  <Td className="whitespace-nowrap">{f.person_count ?? 0}</Td>
                  {includeDeleted && (
                    <Td>
                      {f.deleted_at != null ? (
                        <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Yes</span>
                      ) : (
                        <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">No</span>
                      )}
                    </Td>
                  )}
                  <Td>
                    <div className="flex items-center gap-2">
                      <Link
                        to={`${route.adminFamilyPeople(f.id)}?from=referrer`}
                        className="inline-flex items-center rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700"
                      >
                        Manage
                      </Link>
                      <Button variant="secondary" className="h-7 px-2 text-xs" onClick={() => openEdit(f.id)} disabled={!!editingId}>
                        Edit
                      </Button>
                      {f.deleted_at != null ? (
                        <Button
                          variant="secondary"
                          className="h-7 px-2 text-xs"
                          onClick={() => setRestoreConfirm(f.id)}
                          disabled={restoreMut?.isPending}
                        >
                          Restore
                        </Button>
                      ) : (
                        <Button
                          variant="danger"
                          className="h-7 px-2 text-xs"
                          onClick={() => confirmDelete(f.id)}
                          disabled={deleteMut?.isPending}
                        >
                          Delete
                        </Button>
                      )}
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
        <MutationErrors
          mutations={[referrerUpdateMut, createMut, updateMut, deleteMut, restoreMut].filter((m): m is NonNullable<typeof m> => m != null)}
        />
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ReferrerForm sub-component                                          */
/* ------------------------------------------------------------------ */
interface ReferrerFormProps {
  initial: Partial<ReferrerDetail>;
  onSubmit: (data: ReferrerPayload) => void;
  onCancel: () => void;
  loading: boolean;
}

function ReferrerForm({ initial, onSubmit, onCancel, loading }: ReferrerFormProps) {
  const [form, setForm] = useState<ReferrerPayload>(() => ({ ...initial }));

  const update = (key: string, val: unknown) => setForm((p) => ({ ...p, [key]: val }));

  return (
    <form
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        onSubmit(form);
      }}
      className="mx-auto max-w-sm space-y-3"
    >
      <FormField
        label="Name"
        fieldProps={{
          type: "text",
          value: form.name,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("name", e.target.value),
          required: true,
          maxLength: 60,
        }}
      />
      <FormField
        label="Phone"
        fieldProps={{
          type: "text",
          value: form.phone_number,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("phone_number", e.target.value),
          required: true,
          maxLength: 20,
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
      <div className="flex gap-3 pt-1">
        <Button type="submit" loading={loading} className="flex-1">
          {loading ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} className="flex-1">
          Cancel
        </Button>
      </div>
    </form>
  );
}
