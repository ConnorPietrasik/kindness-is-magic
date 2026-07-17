/**
 * Admin — Manage People
 *
 * List, create, edit, delete people.
 * Uses useCrudManager for data fetching and mutations.
 */

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { defaultPersonForm } from "../components/defaults";
import { BackLink, HeaderBar } from "../components/HeaderBar";
import { MutationErrors } from "../components/MutationErrors";
import { Pagination } from "../components/Pagination";
import { PersonForm } from "../components/PersonForm";
import { PageSpinner, Spinner } from "../components/Spinner";
import { Table, TableBody, TableHead, Td, Th, Tr } from "../components/Table";
import { useCrudManager } from "../hooks/useCrudManager";
import { getPaginationInfo, usePagination } from "../hooks/usePagination";
import { adminCreatePerson, adminDeletePerson, adminGetPerson, adminListFamilies, adminListPeople, adminUpdatePerson } from "../lib/api";
import { normalizeUpdatePayload } from "../lib/utils";
import type { PaginationParams, PersonDetail, PersonPayload } from "../types";

const PEOPLE_KEYS = ["adminPeople"];
const FAMILY_KEYS = ["adminFamilies"];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function AdminPeople() {
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
    rootKey: PEOPLE_KEYS,
    listFn: adminListPeople,
    listParams,
    detailFn: adminGetPerson,
    createFn: adminCreatePerson,
    updateFn: adminUpdatePerson,
    deleteFn: adminDeletePerson,
  });

  const pageInfo = useMemo(
    () => getPaginationInfo(listData?.total ?? 0, pagination.page, pagination.pageSize),
    [listData?.total, pagination.page, pagination.pageSize]
  );

  // Families lookup (for dropdown + display)
  const { data: familyData, isLoading: familiesLoading } = useQuery({
    queryKey: FAMILY_KEYS,
    queryFn: () => adminListFamilies(),
  });

  const familyMap = useMemo((): Record<number, string> => {
    const map: Record<number, string> = {};
    (familyData?.families ?? []).forEach((f) => {
      map[f.id] = f.family_name;
    });
    return map;
  }, [familyData]);

  function handleCreate(formData: PersonPayload) {
    createMut?.mutate(formData);
  }

  function handleUpdate(formData: PersonPayload) {
    if (!editingId) return;
    const payload = normalizeUpdatePayload(formData, detail as PersonDetail);
    updateMut?.mutate({ id: editingId, data: payload as PersonPayload });
  }

  if (listLoading) return <PageSpinner />;

  const people = listData?.people ?? [];

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar title="Kindness is Magic" left={<BackLink />} />

      <main className="mx-auto max-w-[960px] px-4 py-8 sm:px-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-violet-950">Manage People</h2>
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
            <Button onClick={openCreate}>+ Add Person</Button>
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
          <PersonForm
            title={editingId ? "Edit Person" : "Add Person"}
            initial={editingId ? (detail ?? defaultPersonForm) : defaultPersonForm}
            isEdit={!!editingId}
            familyMap={familyMap}
            familyOptionsLoading={familiesLoading}
            showDeletedToggle
            onSubmit={editingId ? handleUpdate : handleCreate}
            onCancel={cancelForm}
            loading={createMut?.isPending || updateMut?.isPending}
          />
        )}

        {/* Table */}
        {people.length === 0 ? (
          <Card>
            <p className="py-8 text-center text-gray-400">No people yet.</p>
          </Card>
        ) : (
          <Table>
            <TableHead>
              <Th>ID</Th>
              <Th>Name</Th>
              <Th>Age</Th>
              <Th>Family</Th>
              {includeDeleted && <Th>Deleted</Th>}
              <Th>Actions</Th>
            </TableHead>
            <TableBody>
              {people.map((p) => (
                <Tr key={p.id}>
                  <Td>{p.id}</Td>
                  <Td className={p.is_deleted ? "text-gray-400" : ""}>{p.given_name}</Td>
                  <Td>{p.age}</Td>
                  <Td>{familyMap[p.family_id] || `ID ${p.family_id}`}</Td>
                  {includeDeleted && (
                    <Td>
                      {p.is_deleted ? (
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
                        onClick={() => openEdit(p.id)}
                        disabled={!!editingId}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        className="px-3 py-1.5 text-xs"
                        onClick={() => confirmDelete(p.id)}
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
              Delete person <strong>#{deleteConfirm}</strong>?
            </>
          }
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
