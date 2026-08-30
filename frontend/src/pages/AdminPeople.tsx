/**
 * Admin — Manage People
 *
 * List, create, edit, delete people.
 * Uses useCrudManager for data fetching and mutations.
 * Separate "Deleted" tab calls the /deleted endpoint.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ActionsDropdown } from "../components/ActionsDropdown";
import { Button } from "../components/Button";
import { ColumnToggle } from "../components/ColumnToggle";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { CrudTabs } from "../components/CrudTabs";
import { DisplayId } from "../components/DisplayId";
import { defaultPersonForm } from "../components/defaults";
import { HeaderBar } from "../components/HeaderBar";
import { MutationErrors } from "../components/MutationErrors";
import { Pagination } from "../components/Pagination";
import { PersonForm } from "../components/PersonForm";
import { PageSpinner, Spinner } from "../components/Spinner";
import { Table, TableBody, TableHead, Td, Th, Tr } from "../components/Table";
import { WishCellAdult, WishCellType } from "../components/WishCell";
import { useToast } from "../context/ToastContext";
import { useColumnVisibility } from "../hooks/useColumnVisibility";
import { useCrudManager } from "../hooks/useCrudManager";
import { useCrudTabs } from "../hooks/useCrudTabs";
import { useDebouncedState } from "../hooks/useDebouncedState";
import { useFamiliesDropdown } from "../hooks/useDropdowns";
import { getPaginationInfo, usePagination } from "../hooks/usePagination";
import { useTableWidth } from "../hooks/useTableWidth";
import {
  adminCreatePerson,
  adminDeletePerson,
  adminGetPerson,
  adminListDeletedPeople,
  adminListPeople,
  adminRestoreFamily,
  adminRestorePerson,
  adminUpdatePerson,
} from "../lib/api";
import { adminDeletedPeople, adminFamilies, adminPackingSlips, adminPeople, adminWishes } from "../lib/queryKeys";
import { route } from "../lib/routes";
import { normalizeUpdatePayload } from "../lib/utils";
import type { AdminPeopleListParams, PersonPayload } from "../types";
import { personRoleLabel } from "../types";

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function AdminPeople() {
  const pagination = usePagination();
  const { viewTab, isDeletedView, handleTabChange } = useCrudTabs({ pagination });
  const [restoreConfirm, setRestoreConfirm] = useState<number | null>(null);
  const [pendingFamilyRestore, setPendingFamilyRestore] = useState<{ personId: number; familyId: number } | null>(null);
  const [familyFilter, setFamilyFilter] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchName, setSearchName] = useState("");
  const [searchRole, setSearchRole] = useState("");
  const [searchNote, setSearchNote] = useState("");
  const [searchWish, setSearchWish] = useState("");
  const [minAge, setMinAge] = useState("");
  const [maxAge, setMaxAge] = useState("");
  const [sortField, setSortField] = useState<string | null>(null);

  // Column visibility
  const { visibleColumns, apiColumns } = useColumnVisibility("adminPeople");
  const { widthClass } = useTableWidth("adminPeople");

  const debouncedSearch = useDebouncedState(searchQuery, 1000, () => pagination.goToPage(1));
  const debouncedSearchName = useDebouncedState(searchName, 1000, () => pagination.goToPage(1));
  const debouncedSearchRole = useDebouncedState(searchRole, 1000, () => pagination.goToPage(1));
  const debouncedSearchNote = useDebouncedState(searchNote, 1000, () => pagination.goToPage(1));
  const debouncedSearchWish = useDebouncedState(searchWish, 1000, () => pagination.goToPage(1));
  const debouncedMinAge = useDebouncedState(minAge, 1000, () => pagination.goToPage(1));
  const debouncedMaxAge = useDebouncedState(maxAge, 1000, () => pagination.goToPage(1));

  // Cycle sort: null → "age" → "-age" → null
  function handleSortToggle() {
    setSortField((prev) => {
      if (prev === null) return "age";
      if (prev === "age") return "-age";
      return null;
    });
    pagination.goToPage(1);
  }

  // Build list params (no include_deleted — deleted uses separate endpoint)
  const listParams = useMemo<AdminPeopleListParams>(
    () => ({
      ...pagination.params,
      columns: apiColumns,
      family_id: familyFilter ?? undefined,
      search: debouncedSearch || undefined,
      search_name: debouncedSearchName || undefined,
      search_role: debouncedSearchRole || undefined,
      search_note: debouncedSearchNote || undefined,
      search_wish: debouncedSearchWish || undefined,
      min_age: debouncedMinAge !== "" ? parseInt(debouncedMinAge, 10) : undefined,
      max_age: debouncedMaxAge !== "" ? parseInt(debouncedMaxAge, 10) : undefined,
      sort: sortField || undefined,
    }),
    [
      pagination.params,
      apiColumns,
      familyFilter,
      debouncedSearch,
      debouncedSearchName,
      debouncedSearchRole,
      debouncedSearchNote,
      debouncedSearchWish,
      debouncedMinAge,
      debouncedMaxAge,
      sortField,
    ]
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
    rootKey: isDeletedView ? adminDeletedPeople : adminPeople,
    listFn: isDeletedView ? adminListDeletedPeople : adminListPeople,
    listParams,
    detailFn: adminGetPerson,
    createFn: isDeletedView ? undefined : adminCreatePerson,
    updateFn: isDeletedView ? undefined : adminUpdatePerson,
    deleteFn: isDeletedView ? undefined : adminDeletePerson,
    invalidationKeys: [isDeletedView ? adminDeletedPeople : adminPeople, adminPackingSlips, adminWishes],
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
      queryClient.invalidateQueries({ queryKey: adminWishes });
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
  const { families, familyMap, familiesLoading } = useFamiliesDropdown();

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

      <main className={`mx-auto px-4 py-8 sm:px-6 ${widthClass}`}>
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-violet-950">Manage People</h2>
          <div className="flex items-center gap-3">
            {!isDeletedView && <ColumnToggle resourceKey="adminPeople" />}
            {!isDeletedView && <Button onClick={openCreate}>+ Add Person</Button>}
          </div>
        </div>

        {/* Tabs */}
        <CrudTabs viewTab={viewTab} onChange={handleTabChange} />

        {/* Filters */}
        {!isDeletedView && (
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <select
              aria-label="Family filter"
              value={familyFilter ?? ""}
              onChange={(e) => {
                setFamilyFilter(e.target.value ? parseInt(e.target.value, 10) : null);
                pagination.goToPage(1);
              }}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
            >
              <option value="">All families</option>
              {families.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.family_name}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Search all fields…"
              aria-label="Search all fields"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
              autoComplete="off"
            />
            <input
              type="number"
              placeholder="Min age"
              aria-label="Minimum age"
              value={minAge}
              onChange={(e) => setMinAge(e.target.value)}
              className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
              autoComplete="off"
              min="0"
            />
            <input
              type="number"
              placeholder="Max age"
              aria-label="Maximum age"
              value={maxAge}
              onChange={(e) => setMaxAge(e.target.value)}
              className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
              autoComplete="off"
              min="0"
            />
          </div>
        )}

        {/* Tab panel content */}
        <div role="tabpanel">
          {/* Create form (active tab only) */}
          {showForm && (
            <PersonForm
              title="Add Person"
              initial={defaultPersonForm}
              isEdit={false}
              familyMap={familyMap}
              familyOptionsLoading={familiesLoading}
              onSubmit={handleCreate}
              onCancel={cancelForm}
              loading={!!createMut?.isPending}
            />
          )}

          {/* Table — always rendered so column headers / filters stay visible */}
          <Table>
            <TableHead>
              {visibleColumns.includes("display_id") && <Th>ID</Th>}
              {visibleColumns.includes("given_name") && (
                <Th>
                  <div className="flex flex-col gap-1">
                    <span>Name</span>
                    <input
                      type="text"
                      placeholder="Filter…"
                      aria-label="Filter by name"
                      value={searchName}
                      onChange={(e) => setSearchName(e.target.value)}
                      className="w-full rounded border border-gray-200 px-1.5 py-0.5 text-xs outline-none transition-colors focus:border-btn-start focus:ring-1 focus:ring-btn-start/20"
                      autoComplete="off"
                    />
                  </div>
                </Th>
              )}
              {visibleColumns.includes("age") && (
                <Th>
                  <button
                    type="button"
                    onClick={handleSortToggle}
                    className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-gray-500 transition-colors hover:text-gray-700"
                  >
                    Age
                    <span className="text-[10px]">{sortField === "age" ? "↑" : sortField === "-age" ? "↓" : "⇅"}</span>
                  </button>
                </Th>
              )}
              {visibleColumns.includes("wishes") && (
                <Th colSpan={2}>
                  <div className="flex flex-col gap-1">
                    <span>Wishes (Practical + Fun)</span>
                    <input
                      type="text"
                      placeholder="Filter wishes…"
                      aria-label="Filter by wishes"
                      value={searchWish}
                      onChange={(e) => setSearchWish(e.target.value)}
                      className="w-full rounded border border-gray-200 px-1.5 py-0.5 text-xs outline-none transition-colors focus:border-btn-start focus:ring-1 focus:ring-btn-start/20"
                      autoComplete="off"
                    />
                  </div>
                </Th>
              )}
              {visibleColumns.includes("family_id") && <Th>Family</Th>}
              {visibleColumns.includes("role") && (
                <Th>
                  <div className="flex flex-col gap-1">
                    <span>Role</span>
                    <input
                      type="text"
                      placeholder="Filter…"
                      aria-label="Filter by role"
                      value={searchRole}
                      onChange={(e) => setSearchRole(e.target.value)}
                      className="w-full rounded border border-gray-200 px-1.5 py-0.5 text-xs outline-none transition-colors focus:border-btn-start focus:ring-1 focus:ring-btn-start/20"
                      autoComplete="off"
                    />
                  </div>
                </Th>
              )}
              {visibleColumns.includes("note") && (
                <Th>
                  <div className="flex flex-col gap-1">
                    <span>Note</span>
                    <input
                      type="text"
                      placeholder="Filter…"
                      aria-label="Filter by note"
                      value={searchNote}
                      onChange={(e) => setSearchNote(e.target.value)}
                      className="w-full rounded border border-gray-200 px-1.5 py-0.5 text-xs outline-none transition-colors focus:border-btn-start focus:ring-1 focus:ring-btn-start/20"
                      autoComplete="off"
                    />
                  </div>
                </Th>
              )}
              {visibleColumns.includes("created_at") && <Th>Created</Th>}
              <Th>Actions</Th>
            </TableHead>
            <TableBody>
              {people.length === 0 ? (
                <Tr>
                  <Td
                    colSpan={visibleColumns.length + (visibleColumns.includes("wishes") ? 1 : 0) + 1}
                    className="!text-center !text-gray-400 py-12"
                  >
                    {isDeletedView ? "No deleted people." : "No people yet."}
                  </Td>
                </Tr>
              ) : (
                people.map((p) => (
                  <React.Fragment key={p.id}>
                    <Tr data-id={p.id}>
                      {visibleColumns.includes("display_id") && (
                        <Td className="whitespace-nowrap text-xs text-gray-400">
                          <DisplayId displayId={p.display_id} familyId={p.family_id} />
                        </Td>
                      )}
                      {visibleColumns.includes("given_name") && (
                        <Td className={p.deleted_at != null ? "text-gray-400" : ""}>{p.given_name}</Td>
                      )}
                      {visibleColumns.includes("age") && <Td>{p.age}</Td>}
                      {visibleColumns.includes("wishes") &&
                        (p.age >= 18 ? (
                          <WishCellAdult wishes={p.wishes} />
                        ) : (
                          <>
                            <WishCellType wishes={p.wishes} type="practical" />
                            <WishCellType wishes={p.wishes} type="fun" />
                          </>
                        ))}
                      {visibleColumns.includes("family_id") && (
                        <Td>
                          <Link
                            to={route.adminFamilyPeople(p.family_id)}
                            className="text-sm text-violet-600 transition-colors hover:text-violet-800"
                          >
                            {familyMap[p.family_id] || `ID ${p.family_id}`}
                          </Link>
                        </Td>
                      )}
                      {visibleColumns.includes("role") && <Td>{personRoleLabel(p.role)}</Td>}
                      {visibleColumns.includes("note") && <Td className="max-w-xs text-xs truncate">{p.note || "—"}</Td>}
                      {visibleColumns.includes("created_at") && (
                        <Td className="text-xs text-gray-500">{new Date(p.created_at).toLocaleDateString()}</Td>
                      )}
                      <Td>
                        <div className="flex gap-2">
                          {!isDeletedView && p.deleted_at == null && (
                            <>
                              <Button
                                variant="secondary"
                                size="sm"
                                className="px-3 py-1.5 text-xs"
                                onClick={() => (editingId === p.id ? cancelForm() : openEdit(p.id))}
                              >
                                {editingId === p.id ? "Done" : "Edit"}
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
                    {editingId === p.id && (
                      <Tr key={`${p.id}-edit`}>
                        <Td colSpan={visibleColumns.length + (visibleColumns.includes("wishes") ? 2 : 1)} className="!py-3">
                          <div className="rounded-xl bg-gray-50 p-4">
                            {detailLoading ? (
                              <div className="flex items-center justify-center gap-3 py-6 text-btn-start">
                                <Spinner size="sm" />
                                <span className="text-sm font-medium">Loading…</span>
                              </div>
                            ) : detail ? (
                              <PersonForm
                                title={`Edit Person #${detail.display_id}`}
                                initial={detail}
                                isEdit={true}
                                familyMap={familyMap}
                                familyOptionsLoading={familiesLoading}
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
                ))
              )}
            </TableBody>
          </Table>

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
