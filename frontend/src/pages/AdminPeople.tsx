/**
 * Admin — Manage People
 *
 * List, create, edit, delete people.
 * Uses useCrudManager for data fetching and mutations.
 * Separate "Deleted" tab calls the /deleted endpoint.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ActionsDropdown } from "../components/ActionsDropdown";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { CrudTabs } from "../components/CrudTabs";
import { defaultPersonForm } from "../components/defaults";
import { HeaderBar } from "../components/HeaderBar";
import { MutationErrors } from "../components/MutationErrors";
import { Pagination } from "../components/Pagination";
import { PersonForm } from "../components/PersonForm";
import { PageSpinner, Spinner } from "../components/Spinner";
import { Table, TableBody, TableHead, Td, Th, Tr } from "../components/Table";
import { useToast } from "../context/ToastContext";
import { useCrudManager } from "../hooks/useCrudManager";
import { useCrudTabs } from "../hooks/useCrudTabs";
import { getPaginationInfo, usePagination } from "../hooks/usePagination";
import {
  adminCreatePerson,
  adminDeletePerson,
  adminGetPerson,
  adminListDeletedPeople,
  adminListFamilies,
  adminListPeople,
  adminRestoreFamily,
  adminRestorePerson,
  adminUpdatePerson,
} from "../lib/api";
import { adminDeletedPeople, adminFamilies, adminPackingSlips, adminPeople } from "../lib/queryKeys";
import { route } from "../lib/routes";
import { normalizeUpdatePayload } from "../lib/utils";
import type { PaginationParams, PersonPayload } from "../types";

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function AdminPeople() {
  const pagination = usePagination();
  const { viewTab, isDeletedView, handleTabChange } = useCrudTabs({ pagination });
  const [restoreConfirm, setRestoreConfirm] = useState<number | null>(null);
  const [pendingFamilyRestore, setPendingFamilyRestore] = useState<{ personId: number; familyId: number } | null>(null);

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
    showForm,
    editingId,
    deleteConfirm,
    openCreate,
    openEdit,
    cancelForm,
    confirmDelete,
    cancelDelete,
  } = useCrudManager({
    rootKey: isDeletedView ? adminDeletedPeople : adminPeople,
    listFn: isDeletedView ? adminListDeletedPeople : adminListPeople,
    listParams,
    detailFn: adminGetPerson,
    createFn: isDeletedView ? undefined : adminCreatePerson,
    updateFn: isDeletedView ? undefined : adminUpdatePerson,
    deleteFn: isDeletedView ? undefined : adminDeletePerson,
    invalidationKeys: [isDeletedView ? adminDeletedPeople : adminPeople, adminPackingSlips],
    entityName: "Person",
  });

  const queryClient = useQueryClient();
  const toast = useToast();

  const personRestoreMut = useMutation({
    mutationFn: (id: number) => adminRestorePerson(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminPeople });
      queryClient.invalidateQueries({ queryKey: adminDeletedPeople });
      queryClient.invalidateQueries({ queryKey: adminPackingSlips });
      toast.success("Person restored");
    },
    onError: (error) => {
      const data = (error as { response?: { data?: Record<string, unknown> } })?.response?.data;
      if (data?.detail === "family_deleted" && restoreConfirm != null) {
        const person = listData?.people?.find((p) => p.id === restoreConfirm);
        if (person?.family_id != null) {
          setRestoreConfirm(null);
          setPendingFamilyRestore({ personId: restoreConfirm, familyId: person.family_id });
          return;
        }
      }
    },
  });

  const familyRestoreMut = useMutation({
    mutationFn: (id: number) => adminRestoreFamily(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminPeople });
      queryClient.invalidateQueries({ queryKey: adminDeletedPeople });
      queryClient.invalidateQueries({ queryKey: adminFamilies });
      queryClient.invalidateQueries({ queryKey: adminPackingSlips });
      toast.success("Family restored");
    },
  });

  const pageInfo = useMemo(
    () => getPaginationInfo(listData?.total ?? 0, pagination.page, pagination.pageSize),
    [listData?.total, pagination.page, pagination.pageSize]
  );

  // Families lookup (for dropdown + display)
  const { data: familyData, isLoading: familiesLoading } = useQuery({
    queryKey: adminFamilies,
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
    const payload = normalizeUpdatePayload(formData, detail);
    updateMut?.mutate({ id: editingId, data: payload });
  }

  if (listLoading) return <PageSpinner />;

  const people = listData?.people ?? [];

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar title="Kindness is Magic" />

      <main className="mx-auto max-w-[960px] px-4 py-8 sm:px-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-violet-950">Manage People</h2>
          {!isDeletedView && <Button onClick={openCreate}>+ Add Person</Button>}
        </div>

        {/* Tabs */}
        <CrudTabs viewTab={viewTab} onChange={handleTabChange} />

        {/* Tab panel content */}
        <div role="tabpanel">
          {/* Create / Edit form (active tab only) */}
          {editingId && detailLoading && (
            <Card className="mb-6 flex items-center justify-center gap-2 border border-gray-200 py-6 text-btn-start">
              <Spinner size="sm" />
              <span>Loading…</span>
            </Card>
          )}

          {(showForm || (editingId && detail)) && (
            <PersonForm
              title={editingId ? `Edit Person #${detail?.display_id}` : "Add Person"}
              initial={editingId ? (detail ?? defaultPersonForm) : defaultPersonForm}
              isEdit={!!editingId}
              familyMap={familyMap}
              familyOptionsLoading={familiesLoading}
              onSubmit={editingId ? handleUpdate : handleCreate}
              onCancel={cancelForm}
              loading={createMut?.isPending || updateMut?.isPending}
            />
          )}

          {/* Table */}
          {people.length === 0 ? (
            <Card>
              <p className="py-8 text-center text-gray-400">{isDeletedView ? "No deleted people." : "No people yet."}</p>
            </Card>
          ) : (
            <Table>
              <TableHead>
                <Th>ID</Th>
                <Th>Name</Th>
                <Th>Age</Th>
                <Th>Family</Th>
                <Th>Actions</Th>
              </TableHead>
              <TableBody>
                {people.map((p) => (
                  <Tr key={p.id} data-id={p.id}>
                    <Td className="whitespace-nowrap text-xs text-gray-400">{p.display_id}</Td>
                    <Td className={p.deleted_at != null ? "text-gray-400" : ""}>{p.given_name}</Td>
                    <Td>{p.age}</Td>
                    <Td>
                      <Link
                        to={route.adminFamilyPeople(p.family_id)}
                        className="text-sm text-violet-600 transition-colors hover:text-violet-800"
                      >
                        {familyMap[p.family_id] || `ID ${p.family_id}`}
                      </Link>
                    </Td>
                    <Td>
                      <div className="flex gap-2">
                        {!isDeletedView && p.deleted_at == null && (
                          <>
                            <Button
                              variant="secondary"
                              size="sm"
                              className="px-3 py-1.5 text-xs"
                              onClick={() => openEdit(p.id)}
                              disabled={!!editingId}
                            >
                              Edit
                            </Button>
                            <ActionsDropdown
                              items={[
                                {
                                  label: "Delete",
                                  variant: "danger" as const,
                                  onClick: () => confirmDelete(p.id),
                                },
                              ]}
                              disabled={deleteMut?.isPending}
                            />
                          </>
                        )}
                        {isDeletedView && (
                          <Button
                            variant="secondary"
                            size="sm"
                            className="px-3 py-1.5 text-xs"
                            onClick={() => setRestoreConfirm(p.id)}
                            disabled={personRestoreMut.isPending || familyRestoreMut.isPending}
                          >
                            Restore
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

          {/* Restore confirmation */}
          <ConfirmDialog
            open={restoreConfirm !== null}
            title={
              <>
                Restore person <strong>#{restoreConfirm}</strong>?
              </>
            }
            onConfirm={() => {
              if (restoreConfirm != null) {
                personRestoreMut.mutate(restoreConfirm, {
                  onSuccess: () => setRestoreConfirm(null),
                });
              }
            }}
            onCancel={() => setRestoreConfirm(null)}
            loading={personRestoreMut.isPending}
            confirmLabel="Yes, restore"
            loadingLabel="Restoring…"
            confirmVariant="secondary"
          />

          {/* Family-deleted restore confirmation */}
          <ConfirmDialog
            open={pendingFamilyRestore !== null}
            title="Family is deleted"
            description="This person's family is deleted. Restore the whole family and all its people?"
            onConfirm={() => {
              if (pendingFamilyRestore != null) {
                familyRestoreMut.mutate(pendingFamilyRestore.familyId, {
                  onSuccess: () => setPendingFamilyRestore(null),
                });
              }
            }}
            onCancel={() => setPendingFamilyRestore(null)}
            loading={familyRestoreMut.isPending}
            confirmLabel="Yes, restore family"
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
        </div>

        {/* Errors (suppress family_deleted — handled by the family-restore dialog) */}
        <MutationErrors
          mutations={[
            createMut,
            updateMut,
            deleteMut,
            {
              ...personRestoreMut,
              error:
                personRestoreMut.error &&
                (personRestoreMut.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail === "family_deleted"
                  ? null
                  : personRestoreMut.error,
            },
            familyRestoreMut,
          ].filter((m): m is NonNullable<typeof m> => m != null)}
        />
      </main>
    </div>
  );
}
