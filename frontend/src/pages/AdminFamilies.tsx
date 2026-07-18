/**
 * Admin — Manage Families
 *
 * List, create, edit, delete families.
 * Uses useCrudManager for data fetching and mutations.
 */

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { defaultFamilyForm } from "../components/defaults";
import { FamilyForm } from "../components/FamilyForm";
import { BackLink, HeaderBar } from "../components/HeaderBar";
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
  adminListFamilies,
  adminListReferrers,
  adminRestoreFamily,
  adminUpdateFamily,
} from "../lib/api";
import { normalizeUpdatePayload } from "../lib/utils";
import type { FamilyDetail, FamilyPayload, PaginationParams } from "../types";

const FAMILY_KEYS = ["adminFamilies"];
const REFERRER_KEYS = ["adminReferrers"];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function AdminFamilies() {
  const pagination = usePagination();
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [restoreConfirm, setRestoreConfirm] = useState<number | null>(null);

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
    rootKey: FAMILY_KEYS,
    listFn: adminListFamilies,
    listParams,
    detailFn: adminGetFamily,
    createFn: adminCreateFamily,
    updateFn: adminUpdateFamily,
    deleteFn: adminDeleteFamily,
    restoreFn: adminRestoreFamily,
    invalidationKeys: [FAMILY_KEYS, ["adminPeople"]],
  });

  const pageInfo = useMemo(
    () => getPaginationInfo(listData?.total ?? 0, pagination.page, pagination.pageSize),
    [listData?.total, pagination.page, pagination.pageSize]
  );

  // Referrers lookup (for dropdown + display)
  const { data: referrerData, isLoading: referrersLoading } = useQuery({
    queryKey: REFERRER_KEYS,
    queryFn: () => adminListReferrers(),
  });

  const referrerMap = useMemo((): Record<number, string> => {
    const map: Record<number, string> = {};
    (referrerData?.referrers ?? []).forEach((r) => {
      map[r.id] = r.name;
    });
    return map;
  }, [referrerData]);

  function handleCreate(formData: FamilyPayload) {
    createMut?.mutate(formData);
  }

  function handleUpdate(formData: FamilyPayload) {
    if (!editingId) return;
    const payload = normalizeUpdatePayload(formData, detail as FamilyDetail);
    updateMut?.mutate({ id: editingId, data: payload as FamilyPayload });
  }

  if (listLoading) return <PageSpinner />;

  const families = listData?.families ?? [];

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar title="Kindness is Magic" left={<BackLink />} />

      <main className="mx-auto max-w-[960px] px-4 py-8 sm:px-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-violet-950">Manage Families</h2>
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
          <Card className="mb-6 flex items-center justify-center gap-2 border border-gray-200 py-6 text-btn-start">
            <Spinner size="sm" />
            <span>Loading…</span>
          </Card>
        )}

        {(showForm || (editingId && detail)) && (
          <FamilyForm
            title={editingId ? "Edit Family" : "Add Family"}
            initial={editingId ? (detail ?? defaultFamilyForm) : defaultFamilyForm}
            isEdit={!!editingId}
            referrerMap={referrerMap}
            referrerOptionsLoading={referrersLoading}
            onSubmit={editingId ? handleUpdate : handleCreate}
            onCancel={cancelForm}
            loading={createMut?.isPending || updateMut?.isPending}
          />
        )}

        {/* Table */}
        {families.length === 0 ? (
          <Card>
            <p className="py-8 text-center text-gray-400">No families yet.</p>
          </Card>
        ) : (
          <Table>
            <TableHead>
              <Th>ID</Th>
              <Th>Family Name</Th>
              <Th>Contact</Th>
              <Th>Referrer</Th>
              {includeDeleted && <Th>Deleted</Th>}
              <Th>Actions</Th>
            </TableHead>
            <TableBody>
              {families.map((f) => (
                <Tr key={f.id}>
                  <Td>{f.id}</Td>
                  <Td className={f.deleted_at != null ? "text-gray-400" : ""}>{f.family_name}</Td>
                  <Td>{f.contact_name}</Td>
                  <Td>{f.referrer_id != null ? referrerMap[f.referrer_id] || `ID ${f.referrer_id}` : "—"}</Td>
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
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="px-3 py-1.5 text-xs"
                        onClick={() => openEdit(f.id)}
                        disabled={!!editingId}
                      >
                        Edit
                      </Button>
                      {f.deleted_at != null ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          className="px-3 py-1.5 text-xs"
                          onClick={() => setRestoreConfirm(f.id)}
                          disabled={restoreMut?.isPending}
                        >
                          Restore
                        </Button>
                      ) : (
                        <Button
                          variant="danger"
                          size="sm"
                          className="px-3 py-1.5 text-xs"
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
        <MutationErrors mutations={[createMut, updateMut, deleteMut, restoreMut].filter((m): m is NonNullable<typeof m> => m != null)} />
      </main>
    </div>
  );
}
