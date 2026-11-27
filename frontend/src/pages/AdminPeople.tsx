/**
 * Admin — Manage People
 *
 * List, create, edit, delete people.
 * Uses useCrudManager for data fetching and mutations.
 * Separate "Deleted" tab calls the /deleted endpoint.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import React, { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ActionsDropdown } from "../components/ActionsDropdown";
import { Button } from "../components/Button";
import { ClearViewButton } from "../components/ClearViewButton";
import { ColumnToggle } from "../components/ColumnToggle";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { CrudTabs } from "../components/CrudTabs";
import { DisplayId } from "../components/DisplayId";
import { DraggableTh } from "../components/DraggableTh";
import { defaultPersonForm } from "../components/defaults";
import { HeaderBar } from "../components/HeaderBar";
import { MutationErrors } from "../components/MutationErrors";
import { Pagination } from "../components/Pagination";
import { PersonForm } from "../components/PersonForm";
import { PageSpinner, Spinner } from "../components/Spinner";
import { Table, TableBody, TableHead, Td, Th, Tr } from "../components/Table";
import { WishCellAdult, WishCellType } from "../components/WishCell";
import { useToast } from "../context/ToastContext";
import { useColumnOrder } from "../hooks/useColumnOrder";
import { useColumnVisibility } from "../hooks/useColumnVisibility";
import { useCrudManager } from "../hooks/useCrudManager";
import { useCrudTabs } from "../hooks/useCrudTabs";
import { useDebouncedState } from "../hooks/useDebouncedState";
import { useFamiliesDropdown } from "../hooks/useDropdowns";
import { getPaginationInfo, usePageClamp, usePagination } from "../hooks/usePagination";
import { listViewKey, usePersistentState } from "../hooks/usePersistentState";
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
import { adminDeletedPeople, adminFamilies, adminPackingSlips, adminPeople, adminWishCards, adminWishes } from "../lib/queryKeys";
import { route } from "../lib/routes";
import { normalizeUpdatePayload, parseNonNegativeInt, sanitizeNonNegativeInt } from "../lib/utils";
import type { AdminPeopleListParams, PersonPayload } from "../types";
import { personRoleLabel } from "../types";

/**
 * True when restore-person failed because the person's family is soft-deleted.
 * The backend returns a user-facing message (restore_person in
 * admin_people.py), so this substring must stay in sync with that detail —
 * this page converts that specific failure into the family-restore dialog.
 */
function isFamilyDeletedError(error: unknown): boolean {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === "string" && detail.includes("family has already been deleted");
}

/* ------------------------------------------------------------------ */
/* Persisted view state                                                */
/* ------------------------------------------------------------------ */

interface AdminPeopleView {
  search: string;
  searchName: string;
  searchRole: string;
  searchNote: string;
  searchWish: string;
  minAge: string;
  maxAge: string;
  familyId: number | null;
  sortField: string | null;
  newestFirst: boolean;
}

const DEFAULT_VIEW: AdminPeopleView = {
  search: "",
  searchName: "",
  searchRole: "",
  searchNote: "",
  searchWish: "",
  minAge: "",
  maxAge: "",
  familyId: null,
  sortField: null,
  newestFirst: false,
};

const SORT_FIELDS = ["age", "-age"] as const;

function sanitizeView(raw: unknown): Partial<AdminPeopleView> {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
  return {
    search: str(r.search),
    searchName: str(r.searchName),
    searchRole: str(r.searchRole),
    searchNote: str(r.searchNote),
    searchWish: str(r.searchWish),
    minAge: sanitizeNonNegativeInt(r.minAge),
    maxAge: sanitizeNonNegativeInt(r.maxAge),
    familyId: typeof r.familyId === "number" && Number.isInteger(r.familyId) && r.familyId >= 1 ? r.familyId : null,
    sortField: (SORT_FIELDS as readonly string[]).includes(r.sortField as string) ? (r.sortField as string) : null,
    newestFirst: r.newestFirst === true,
  };
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function AdminPeople() {
  const pagination = usePagination({ storageKey: "adminPeople" });
  const { viewTab, isDeletedView, handleTabChange } = useCrudTabs({ pagination, storageKey: "adminPeople" });
  const [view, setView] = usePersistentState(listViewKey("adminPeople", "filters"), DEFAULT_VIEW, sanitizeView);
  const [restoreConfirm, setRestoreConfirm] = useState<number | null>(null);
  const [pendingFamilyRestore, setPendingFamilyRestore] = useState<{ personId: number; familyId: number } | null>(null);

  // Column visibility + user column order
  const { visibleColumns, apiColumns } = useColumnVisibility("adminPeople");
  const { orderedKeys, reorder, moveBy, resetOrder, isDefaultOrder } = useColumnOrder("adminPeople", visibleColumns);
  const { widthClass } = useTableWidth("adminPeople");

  // Visible columns in the user's custom order (drives header + row render).
  const displayColumns = useMemo(() => orderedKeys.filter((k) => visibleColumns.includes(k)), [orderedKeys, visibleColumns]);

  const debouncedSearch = useDebouncedState(view.search, 1000, () => pagination.goToPage(1));
  const debouncedSearchName = useDebouncedState(view.searchName, 1000, () => pagination.goToPage(1));
  const debouncedSearchRole = useDebouncedState(view.searchRole, 1000, () => pagination.goToPage(1));
  const debouncedSearchNote = useDebouncedState(view.searchNote, 1000, () => pagination.goToPage(1));
  const debouncedSearchWish = useDebouncedState(view.searchWish, 1000, () => pagination.goToPage(1));
  const debouncedMinAge = useDebouncedState(view.minAge, 1000, () => pagination.goToPage(1));
  const debouncedMaxAge = useDebouncedState(view.maxAge, 1000, () => pagination.goToPage(1));

  // Cycle sort: null → "age" → "-age" → null
  function handleSortToggle() {
    setView((prev) => {
      if (prev.sortField === null) return { ...prev, newestFirst: false, sortField: "age" };
      if (prev.sortField === "age") return { ...prev, newestFirst: false, sortField: "-age" };
      return { ...prev, newestFirst: false, sortField: null };
    });
    pagination.goToPage(1);
  }

  // "Newest first" and the column sort share the single `sort` param — enabling
  // one clears the other.
  function handleNewestToggle() {
    setView((prev) => ({ ...prev, newestFirst: !prev.newestFirst, sortField: null }));
    pagination.goToPage(1);
  }

  function handleClearView() {
    setView(DEFAULT_VIEW);
    handleTabChange("active"); // also resets pagination to page 1
    pagination.reset(); // also resets the page size
  }

  const isViewNonDefault =
    view.search !== "" ||
    view.searchName !== "" ||
    view.searchRole !== "" ||
    view.searchNote !== "" ||
    view.searchWish !== "" ||
    view.minAge !== "" ||
    view.maxAge !== "" ||
    view.familyId !== null ||
    view.sortField !== null ||
    view.newestFirst ||
    isDeletedView ||
    pagination.page !== pagination.defaultPage ||
    pagination.pageSize !== pagination.defaultPageSize;

  // Build list params (no include_deleted — deleted uses separate endpoint)
  const listParams = useMemo<AdminPeopleListParams>(
    () => ({
      ...pagination.params,
      columns: apiColumns,
      family_id: view.familyId ?? undefined,
      search: debouncedSearch || undefined,
      search_name: debouncedSearchName || undefined,
      search_role: debouncedSearchRole || undefined,
      search_note: debouncedSearchNote || undefined,
      search_wish: debouncedSearchWish || undefined,
      min_age: parseNonNegativeInt(debouncedMinAge),
      max_age: parseNonNegativeInt(debouncedMaxAge),
      sort: view.newestFirst ? "-created_at" : view.sortField || undefined,
    }),
    [
      pagination.params,
      apiColumns,
      view.familyId,
      debouncedSearch,
      debouncedSearchName,
      debouncedSearchRole,
      debouncedSearchNote,
      debouncedSearchWish,
      debouncedMinAge,
      debouncedMaxAge,
      view.sortField,
      view.newestFirst,
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
    invalidationKeys: [isDeletedView ? adminDeletedPeople : adminPeople, adminPackingSlips, adminWishes, adminWishCards],
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
      queryClient.invalidateQueries({ queryKey: adminWishCards });
      queryClient.invalidateQueries({ queryKey: adminWishes });
      toast.success("Person restored");
    },
    onError: (error) => {
      if (isFamilyDeletedError(error) && restoreConfirm != null) {
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
      queryClient.invalidateQueries({ queryKey: adminWishCards });
      toast.success("Family restored");
    },
  });

  const pageInfo = useMemo(
    () => getPaginationInfo(listData?.total ?? 0, pagination.page, pagination.pageSize),
    [listData?.total, pagination.page, pagination.pageSize]
  );

  // A persisted page can be stale (the list shrank since it was saved) —
  // once the response reports its total, clamp to the last valid page.
  usePageClamp(pageInfo.totalPages, pagination.page, pagination.goToPage);

  // Families lookup (for dropdown + display)
  const { families, familyMap, familiesLoading, familiesError } = useFamiliesDropdown();

  // A saved family filter can point at a family that's since been soft-deleted
  // (or created on another machine) — drop it once the dropdown loads, so the
  // select can't sit blank with an invisible active filter. A failed
  // dropdown fetch is NOT evidence the family is gone — keep the value.
  useEffect(() => {
    if (familiesLoading || familiesError) return;
    setView((prev) => (prev.familyId != null && !families.some((f) => f.id === prev.familyId) ? { ...prev, familyId: null } : prev));
  }, [families, familiesLoading, familiesError, setView]);

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

  // Header cells per column key (filter inputs / sort button stay inline).
  const peopleHeaders: Record<string, React.ReactNode> = {
    display_id: "ID",
    given_name: (
      <div className="flex flex-col gap-1">
        <span>Name</span>
        <input
          type="text"
          placeholder="Filter…"
          aria-label="Filter by name"
          value={view.searchName}
          onChange={(e) => setView((v) => ({ ...v, searchName: e.target.value }))}
          className="w-full rounded border border-gray-200 px-1.5 py-0.5 text-xs outline-none transition-colors focus:border-btn-start focus:ring-1 focus:ring-btn-start/20"
          autoComplete="off"
        />
      </div>
    ),
    age: (
      <button
        type="button"
        onClick={handleSortToggle}
        className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-gray-500 transition-colors hover:text-gray-700"
      >
        Age
        <span className="text-[10px]">{view.sortField === "age" ? "↑" : view.sortField === "-age" ? "↓" : "⇅"}</span>
      </button>
    ),
    wishes: (
      <div className="flex flex-col gap-1">
        <span>Wishes (Practical + Fun)</span>
        <input
          type="text"
          placeholder="Filter wishes…"
          aria-label="Filter by wishes"
          value={view.searchWish}
          onChange={(e) => setView((v) => ({ ...v, searchWish: e.target.value }))}
          className="w-full rounded border border-gray-200 px-1.5 py-0.5 text-xs outline-none transition-colors focus:border-btn-start focus:ring-1 focus:ring-btn-start/20"
          autoComplete="off"
        />
      </div>
    ),
    family_id: "Family",
    role: (
      <div className="flex flex-col gap-1">
        <span>Role</span>
        <input
          type="text"
          placeholder="Filter…"
          aria-label="Filter by role"
          value={view.searchRole}
          onChange={(e) => setView((v) => ({ ...v, searchRole: e.target.value }))}
          className="w-full rounded border border-gray-200 px-1.5 py-0.5 text-xs outline-none transition-colors focus:border-btn-start focus:ring-1 focus:ring-btn-start/20"
          autoComplete="off"
        />
      </div>
    ),
    note: (
      <div className="flex flex-col gap-1">
        <span>Note</span>
        <input
          type="text"
          placeholder="Filter…"
          aria-label="Filter by note"
          value={view.searchNote}
          onChange={(e) => setView((v) => ({ ...v, searchNote: e.target.value }))}
          className="w-full rounded border border-gray-200 px-1.5 py-0.5 text-xs outline-none transition-colors focus:border-btn-start focus:ring-1 focus:ring-btn-start/20"
          autoComplete="off"
        />
      </div>
    ),
    created_at: "Created",
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar />

      <main className={`mx-auto px-4 py-8 sm:px-6 ${widthClass}`}>
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-violet-950">Manage People</h2>
          <div className="flex items-center gap-3">
            <ClearViewButton isNonDefault={isViewNonDefault} onClear={handleClearView} />
            {!isDeletedView && !isDefaultOrder && (
              <Button variant="secondary" onClick={resetOrder}>
                Reset order
              </Button>
            )}
            {!isDeletedView && <ColumnToggle resourceKey="adminPeople" />}
            {!isDeletedView && <Button onClick={openCreate}>+ Add person</Button>}
          </div>
        </div>

        {/* Tabs */}
        <CrudTabs viewTab={viewTab} onChange={handleTabChange} />

        {/* Filters */}
        {!isDeletedView && (
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button
              type="button"
              variant={view.newestFirst ? "primary" : "secondary"}
              aria-pressed={view.newestFirst}
              onClick={handleNewestToggle}
            >
              Newest first
            </Button>
            <select
              aria-label="Family filter"
              value={view.familyId ?? ""}
              onChange={(e) => {
                setView((v) => ({ ...v, familyId: e.target.value ? parseInt(e.target.value, 10) : null }));
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
              value={view.search}
              onChange={(e) => setView((v) => ({ ...v, search: e.target.value }))}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
              autoComplete="off"
            />
            <input
              type="number"
              placeholder="Min age"
              aria-label="Minimum age"
              value={view.minAge}
              onChange={(e) => setView((v) => ({ ...v, minAge: e.target.value }))}
              className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
              autoComplete="off"
              min="0"
            />
            <input
              type="number"
              placeholder="Max age"
              aria-label="Maximum age"
              value={view.maxAge}
              onChange={(e) => setView((v) => ({ ...v, maxAge: e.target.value }))}
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
              {displayColumns.map((key) => (
                <DraggableTh key={key} unit={[key]} colSpan={key === "wishes" ? 2 : undefined} onReorder={reorder} onMoveBy={moveBy}>
                  {peopleHeaders[key]}
                </DraggableTh>
              ))}
              <Th>Actions</Th>
            </TableHead>
            <TableBody>
              {people.length === 0 ? (
                <Tr>
                  <Td
                    colSpan={displayColumns.length + (displayColumns.includes("wishes") ? 1 : 0) + 1}
                    className="!text-center !text-gray-400 py-12"
                  >
                    {isDeletedView ? "No deleted people." : "No people yet."}
                  </Td>
                </Tr>
              ) : (
                people.map((p) => {
                  const personCells: Record<string, React.ReactNode> = {
                    display_id: (
                      <Td className="whitespace-nowrap text-xs text-gray-400">
                        <DisplayId displayId={p.display_id} familyId={p.family_id} />
                      </Td>
                    ),
                    given_name: <Td className={p.deleted_at != null ? "text-gray-400" : ""}>{p.given_name}</Td>,
                    age: <Td>{p.age}</Td>,
                    // "wishes" is one logical column — adults get a single
                    // colSpan=2 cell, children get one cell per wish type.
                    wishes:
                      p.age >= 18 ? (
                        <WishCellAdult wishes={p.wishes} />
                      ) : (
                        <>
                          <WishCellType wishes={p.wishes} type="practical" />
                          <WishCellType wishes={p.wishes} type="fun" />
                        </>
                      ),
                    family_id: (
                      <Td>
                        <Link
                          to={route.adminFamilyPeople(p.family_id)}
                          className="text-sm text-violet-600 transition-colors hover:text-violet-800"
                        >
                          {familyMap[p.family_id] || `ID ${p.family_id}`}
                        </Link>
                      </Td>
                    ),
                    role: <Td>{personRoleLabel(p.role)}</Td>,
                    note: <Td className="max-w-xs text-xs truncate">{p.note || "—"}</Td>,
                    created_at: <Td className="text-xs text-gray-500">{new Date(p.created_at).toLocaleDateString()}</Td>,
                  };
                  return (
                    <React.Fragment key={p.id}>
                      <Tr data-id={p.id}>
                        {displayColumns.map((key) => (
                          <Fragment key={key}>{personCells[key]}</Fragment>
                        ))}
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
                          <Td colSpan={displayColumns.length + (displayColumns.includes("wishes") ? 2 : 1)} className="!py-3">
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
                  );
                })
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

        {/* Errors (suppress the family-deleted message — handled by the family-restore dialog) */}
        <MutationErrors
          mutations={[
            createMut,
            updateMut,
            deleteMut,
            {
              ...personRestoreMut,
              error: personRestoreMut.error && isFamilyDeletedError(personRestoreMut.error) ? null : personRestoreMut.error,
            },
            familyRestoreMut,
          ].filter((m): m is NonNullable<typeof m> => m != null)}
        />
      </main>
    </div>
  );
}
