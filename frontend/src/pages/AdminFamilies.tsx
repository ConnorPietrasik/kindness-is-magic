/**
 * Admin — Manage Families
 *
 * List, create, edit, delete families.
 * Uses useCrudManager for data fetching and mutations.
 * Separate "Deleted" tab calls the /deleted endpoint.
 */

import React, { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AdminEmailComposer } from "../components/AdminEmailComposer";
import { Button } from "../components/Button";
import { ClearViewButton } from "../components/ClearViewButton";
import { ColumnToggle } from "../components/ColumnToggle";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { CrudTabs } from "../components/CrudTabs";
import { DraggableTh } from "../components/DraggableTh";
import { defaultFamilyForm } from "../components/defaults";
import { FamilyForm } from "../components/FamilyForm";
import { FamilyTableRow } from "../components/FamilyTableRow";
import { HeaderBar } from "../components/HeaderBar";
import { MutationErrors } from "../components/MutationErrors";
import { Pagination } from "../components/Pagination";
import { PageSpinner, Spinner } from "../components/Spinner";
import { Table, TableBody, TableHead, Td, Th, Tr } from "../components/Table";
import { useColumnOrder } from "../hooks/useColumnOrder";
import { useColumnVisibility } from "../hooks/useColumnVisibility";
import { useCrudManager } from "../hooks/useCrudManager";
import { useCrudTabs } from "../hooks/useCrudTabs";
import { useDebouncedState } from "../hooks/useDebouncedState";
import { useDeliveryUsers } from "../hooks/useDeliveryUsers";
import { useReferrersDropdown } from "../hooks/useDropdowns";
import { getPaginationInfo, usePageClamp, usePagination } from "../hooks/usePagination";
import { listViewKey, usePersistentState } from "../hooks/usePersistentState";
import { useTableWidth } from "../hooks/useTableWidth";
import { useWishLockActions } from "../hooks/useWishLockActions";
import {
  adminCreateFamily,
  adminDeleteFamily,
  adminGetFamily,
  adminListDeletedFamilies,
  adminListFamilies,
  adminRestoreFamily,
  adminUpdateFamily,
} from "../lib/api";
import {
  adminDeletedFamilies,
  adminDeletedPeople,
  adminFamilies,
  adminFamiliesDropdown,
  adminPackingSlips,
  adminPeople,
  adminWishCards,
  adminWishes,
} from "../lib/queryKeys";
import { route } from "../lib/routes";
import { getLockLevelRowClass, normalizeUpdatePayload, parseNonNegativeInt, sanitizeNonNegativeInt } from "../lib/utils";
import type { AdminFamiliesListParams, FamilyDetail, FamilyPayload } from "../types";

/* ------------------------------------------------------------------ */
/* Persisted view state                                                */
/* ------------------------------------------------------------------ */

interface AdminFamiliesView {
  search: string;
  searchName: string;
  searchContact: string;
  searchPhone: string;
  searchWish: string;
  minPersonCount: string;
  maxPersonCount: string;
  verificationStatus: string;
  lockLevel: string;
  sortField: string | null;
  newestFirst: boolean;
}

const DEFAULT_VIEW: AdminFamiliesView = {
  search: "",
  searchName: "",
  searchContact: "",
  searchPhone: "",
  searchWish: "",
  minPersonCount: "",
  maxPersonCount: "",
  verificationStatus: "",
  lockLevel: "",
  sortField: null,
  newestFirst: false,
};

const VERIFICATION_STATUSES = ["pending", "verified", "rejected"] as const;
const LOCK_LEVELS = ["family", "referrer", "admin"] as const;
const SORT_FIELDS = ["person_count", "-person_count"] as const;

function sanitizeView(raw: unknown): Partial<AdminFamiliesView> {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
  return {
    search: str(r.search),
    searchName: str(r.searchName),
    searchContact: str(r.searchContact),
    searchPhone: str(r.searchPhone),
    searchWish: str(r.searchWish),
    minPersonCount: sanitizeNonNegativeInt(r.minPersonCount),
    maxPersonCount: sanitizeNonNegativeInt(r.maxPersonCount),
    verificationStatus: (VERIFICATION_STATUSES as readonly string[]).includes(r.verificationStatus as string)
      ? (r.verificationStatus as string)
      : undefined,
    lockLevel: (LOCK_LEVELS as readonly string[]).includes(r.lockLevel as string) ? (r.lockLevel as string) : undefined,
    sortField: (SORT_FIELDS as readonly string[]).includes(r.sortField as string) ? (r.sortField as string) : null,
    newestFirst: r.newestFirst === true,
  };
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function AdminFamilies() {
  const navigate = useNavigate();
  const pagination = usePagination({ storageKey: "adminFamilies" });
  const { viewTab, isDeletedView, handleTabChange } = useCrudTabs({ pagination, storageKey: "adminFamilies" });
  const [view, setView] = usePersistentState(listViewKey("adminFamilies", "filters"), DEFAULT_VIEW, sanitizeView);
  const [restoreConfirm, setRestoreConfirm] = useState<number | null>(null);
  const [lockEditConfirm, setLockEditConfirm] = useState<boolean>(false);
  // Row whose "Send email" action was chosen (drives the page-level composer)
  const [sendEmailFamily, setSendEmailFamily] = useState<FamilyDetail | null>(null);
  const pendingPayload = useRef<FamilyPayload | null>(null);

  // Column visibility + user column order
  const { visibleColumns, apiColumns } = useColumnVisibility("adminFamilies");
  const { orderedKeys, reorder, moveBy, resetOrder, isDefaultOrder } = useColumnOrder("adminFamilies", visibleColumns);
  const { widthClass } = useTableWidth("adminFamilies");

  // Visible columns in the user's custom order (drives header + row render).
  const displayColumns = useMemo(() => orderedKeys.filter((k) => visibleColumns.includes(k)), [orderedKeys, visibleColumns]);

  const debouncedSearch = useDebouncedState(view.search, 1000, () => pagination.goToPage(1));
  const debouncedSearchName = useDebouncedState(view.searchName, 1000, () => pagination.goToPage(1));
  const debouncedSearchContact = useDebouncedState(view.searchContact, 1000, () => pagination.goToPage(1));
  const debouncedSearchPhone = useDebouncedState(view.searchPhone, 1000, () => pagination.goToPage(1));
  const debouncedSearchWish = useDebouncedState(view.searchWish, 1000, () => pagination.goToPage(1));
  const debouncedMinPersonCount = useDebouncedState(view.minPersonCount, 1000, () => pagination.goToPage(1));
  const debouncedMaxPersonCount = useDebouncedState(view.maxPersonCount, 1000, () => pagination.goToPage(1));

  // Cycle sort: null → "person_count" → "-person_count" → null
  function handleSortToggle() {
    setView((prev) => {
      if (prev.sortField === null) return { ...prev, newestFirst: false, sortField: "person_count" };
      if (prev.sortField === "person_count") return { ...prev, newestFirst: false, sortField: "-person_count" };
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
    view.searchContact !== "" ||
    view.searchPhone !== "" ||
    view.searchWish !== "" ||
    view.minPersonCount !== "" ||
    view.maxPersonCount !== "" ||
    view.verificationStatus !== "" ||
    view.lockLevel !== "" ||
    view.sortField !== null ||
    view.newestFirst ||
    isDeletedView ||
    pagination.page !== pagination.defaultPage ||
    pagination.pageSize !== pagination.defaultPageSize;

  // Build list params (no include_deleted — deleted uses separate endpoint)
  const listParams = useMemo<AdminFamiliesListParams>(
    () => ({
      ...pagination.params,
      columns: apiColumns,
      search: debouncedSearch || undefined,
      search_name: debouncedSearchName || undefined,
      search_contact: debouncedSearchContact || undefined,
      search_phone: debouncedSearchPhone || undefined,
      search_wish: debouncedSearchWish || undefined,
      verification_status: view.verificationStatus || undefined,
      wish_lock_level: view.lockLevel || undefined,
      min_person_count: parseNonNegativeInt(debouncedMinPersonCount),
      max_person_count: parseNonNegativeInt(debouncedMaxPersonCount),
      sort: view.newestFirst ? "-created_at" : view.sortField || undefined,
    }),
    [
      pagination.params,
      apiColumns,
      debouncedSearch,
      debouncedSearchName,
      debouncedSearchContact,
      debouncedSearchPhone,
      debouncedSearchWish,
      debouncedMinPersonCount,
      debouncedMaxPersonCount,
      view.verificationStatus,
      view.lockLevel,
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
    rootKey: isDeletedView ? adminDeletedFamilies : adminFamilies,
    listFn: isDeletedView ? adminListDeletedFamilies : adminListFamilies,
    listParams,
    detailFn: adminGetFamily,
    createFn: isDeletedView ? undefined : adminCreateFamily,
    updateFn: isDeletedView ? undefined : adminUpdateFamily,
    deleteFn: isDeletedView ? undefined : adminDeleteFamily,
    restoreFn: adminRestoreFamily,
    invalidationKeys: [
      adminFamilies,
      adminDeletedFamilies,
      adminPeople,
      adminDeletedPeople,
      adminPackingSlips,
      adminWishes,
      adminWishCards,
      adminFamiliesDropdown,
    ],
    entityName: "Family",
  });

  const pageInfo = useMemo(
    () => getPaginationInfo(listData?.total ?? 0, pagination.page, pagination.pageSize),
    [listData?.total, pagination.page, pagination.pageSize]
  );

  // A persisted page can be stale (the list shrank since it was saved) —
  // once the response reports its total, clamp to the last valid page.
  usePageClamp(pageInfo.totalPages, pagination.page, pagination.goToPage);

  // Referrers lookup (for dropdown + display)
  const { referrerMap, referrersLoading } = useReferrersDropdown();

  // Delivery users lookup (for dropdown)
  const { deliveryUserMap, deliveryUsersLoading } = useDeliveryUsers();

  // Wish-lock row actions (unapprove / fully approve)
  const { resetMut, fullyApproveMut, onResetLock, onFullyApprove, confirmDialogs } = useWishLockActions();

  function handleCreate(formData: FamilyPayload) {
    createMut?.mutate(formData);
  }

  function handleUpdate(formData: FamilyPayload) {
    if (!editingId) return;
    const payload = normalizeUpdatePayload(formData, detail as FamilyDetail) as FamilyPayload;
    // If family is admin-locked, ask for confirmation
    if (detail?.wish_lock_level === "admin") {
      pendingPayload.current = payload;
      setLockEditConfirm(true);
      return;
    }
    updateMut?.mutate({ id: editingId, data: payload });
  }

  function handleUpdateConfirmed() {
    setLockEditConfirm(false);
    if (editingId && pendingPayload.current) {
      updateMut?.mutate({ id: editingId, data: pendingPayload.current });
      pendingPayload.current = null;
    }
  }

  const families = listData?.families ?? [];

  // Look up the row the action came from (the prefill + context label need its
  // contact_email / display fields, not just the id)
  function handleSendEmail(id: number) {
    const fam = families.find((f) => f.id === id);
    if (fam) setSendEmailFamily(fam);
  }

  if (listLoading) return <PageSpinner />;

  // Header cells per column key (filter inputs / sort button stay inline).
  const familyHeaders: Record<string, React.ReactNode> = {
    display_id: "ID",
    family_name: (
      <div className="flex flex-col gap-1">
        <span>Family Name</span>
        <input
          type="text"
          placeholder="Filter…"
          aria-label="Filter by family name"
          value={view.searchName}
          onChange={(e) => setView((v) => ({ ...v, searchName: e.target.value }))}
          className="w-full rounded border border-gray-200 px-1.5 py-0.5 text-xs outline-none transition-colors focus:border-btn-start focus:ring-1 focus:ring-btn-start/20"
          autoComplete="off"
        />
      </div>
    ),
    family_wish: (
      <div className="flex flex-col gap-1">
        <span>Family Wish</span>
        <input
          type="text"
          placeholder="Filter…"
          aria-label="Filter by family wish"
          value={view.searchWish}
          onChange={(e) => setView((v) => ({ ...v, searchWish: e.target.value }))}
          className="w-full rounded border border-gray-200 px-1.5 py-0.5 text-xs outline-none transition-colors focus:border-btn-start focus:ring-1 focus:ring-btn-start/20"
          autoComplete="off"
        />
      </div>
    ),
    bio: "Bio",
    contact_name: (
      <div className="flex flex-col gap-1">
        <span>Contact</span>
        <input
          type="text"
          placeholder="Filter…"
          aria-label="Filter by contact name"
          value={view.searchContact}
          onChange={(e) => setView((v) => ({ ...v, searchContact: e.target.value }))}
          className="w-full rounded border border-gray-200 px-1.5 py-0.5 text-xs outline-none transition-colors focus:border-btn-start focus:ring-1 focus:ring-btn-start/20"
          autoComplete="off"
        />
      </div>
    ),
    referrer_id: "Referrer",
    delivery: "Delivery",
    claim: "Sponsorship",
    cash_only: "Cash Only",
    referrer_notes: "Referrer Notes",
    phone_number: (
      <div className="flex flex-col gap-1">
        <span>Phone</span>
        <input
          type="text"
          placeholder="Filter…"
          aria-label="Filter by phone number"
          value={view.searchPhone}
          onChange={(e) => setView((v) => ({ ...v, searchPhone: e.target.value }))}
          className="w-full rounded border border-gray-200 px-1.5 py-0.5 text-xs outline-none transition-colors focus:border-btn-start focus:ring-1 focus:ring-btn-start/20"
          autoComplete="off"
        />
      </div>
    ),
    person_count: (
      <button
        type="button"
        onClick={handleSortToggle}
        className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-gray-500 transition-colors hover:text-gray-700"
      >
        Person Count
        <span className="text-[10px]">{view.sortField === "person_count" ? "↑" : view.sortField === "-person_count" ? "↓" : "⇅"}</span>
      </button>
    ),
    verification_status: "Verification",
    wish_lock_level: "Lock Level",
    wish_review_requested_at: "Review Requested",
    wish_rejection_reason: "Rejection Reason",
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar />

      <main className={`mx-auto px-4 py-8 sm:px-6 ${widthClass}`}>
        {/* Header */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold text-violet-950">Manage Families</h2>
          <div className="flex items-center gap-3">
            <ClearViewButton isNonDefault={isViewNonDefault} onClear={handleClearView} />
            {!isDeletedView && !isDefaultOrder && (
              <Button variant="secondary" onClick={resetOrder}>
                Reset order
              </Button>
            )}
            {!isDeletedView && <ColumnToggle resourceKey="adminFamilies" />}
            {!isDeletedView && <Button onClick={openCreate}>+ Add family</Button>}
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
              aria-label="Verification status filter"
              value={view.verificationStatus}
              onChange={(e) => {
                setView((v) => ({ ...v, verificationStatus: e.target.value }));
                pagination.goToPage(1);
              }}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
            >
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="verified">Verified</option>
              <option value="rejected">Rejected</option>
            </select>
            <select
              aria-label="Lock level filter"
              value={view.lockLevel}
              onChange={(e) => {
                setView((v) => ({ ...v, lockLevel: e.target.value }));
                pagination.goToPage(1);
              }}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
            >
              <option value="">All lock levels</option>
              <option value="family">Family</option>
              <option value="referrer">Referrer</option>
              <option value="admin">Admin</option>
            </select>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min="0"
                placeholder="Min"
                aria-label="Minimum people"
                value={view.minPersonCount}
                onChange={(e) => setView((v) => ({ ...v, minPersonCount: e.target.value }))}
                className="w-16 rounded-lg border border-gray-300 px-2 py-2 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
                autoComplete="off"
              />
              <span className="text-xs text-gray-400">—</span>
              <input
                type="number"
                min="0"
                placeholder="Max"
                aria-label="Maximum people"
                value={view.maxPersonCount}
                onChange={(e) => setView((v) => ({ ...v, maxPersonCount: e.target.value }))}
                className="w-16 rounded-lg border border-gray-300 px-2 py-2 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
                autoComplete="off"
              />
              <span className="text-xs text-gray-500">people</span>
            </div>
            <input
              type="text"
              placeholder="Search all fields…"
              aria-label="Search all fields"
              value={view.search}
              onChange={(e) => setView((v) => ({ ...v, search: e.target.value }))}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
              autoComplete="off"
            />
          </div>
        )}

        {/* Tab panel content */}
        <div role="tabpanel">
          {/* Create form (active tab only) */}
          {showForm && (
            <FamilyForm
              title="Add Family"
              initial={defaultFamilyForm}
              isEdit={false}
              referrerMap={referrerMap}
              referrerOptionsLoading={referrersLoading}
              deliveryUserMap={deliveryUserMap}
              deliveryUsersLoading={deliveryUsersLoading}
              showReferrerNotes
              showCashOnly
              onSubmit={handleCreate}
              onCancel={cancelForm}
              loading={!!createMut?.isPending}
            />
          )}

          {/* Table — always rendered so column headers / filters stay visible */}
          <Table>
            <TableHead>
              {displayColumns.map((key) => (
                <DraggableTh key={key} unit={[key]} onReorder={reorder} onMoveBy={moveBy}>
                  {familyHeaders[key]}
                </DraggableTh>
              ))}
              <Th>Actions</Th>
            </TableHead>
            <TableBody>
              {families.length === 0 ? (
                <Tr>
                  <Td colSpan={displayColumns.length + 1} className="!text-center !text-gray-400 py-12">
                    {isDeletedView ? "No deleted families." : "No families yet."}
                  </Td>
                </Tr>
              ) : (
                families.map((f) => (
                  <React.Fragment key={f.id}>
                    <Tr data-id={f.id} className={getLockLevelRowClass(f)}>
                      <FamilyTableRow
                        family={f}
                        visibleColumns={displayColumns}
                        isDeletedView={isDeletedView}
                        isEditing={editingId === f.id}
                        referrerMap={referrerMap}
                        showPackingSlipAction
                        showDeliverySlipAction
                        onSendEmail={handleSendEmail}
                        onEdit={(id) => (editingId === id ? cancelForm() : openEdit(id))}
                        onDelete={(id) => confirmDelete(id)}
                        onRestore={(id) => setRestoreConfirm(id)}
                        onResetLock={onResetLock}
                        onFullyApprove={onFullyApprove}
                        onViewPackingSlip={(id) => navigate(route.adminPackingSlips([id]))}
                        onViewDeliverySlip={(id) => navigate(route.adminDeliverySlips([id]))}
                        isDeleting={deleteMut?.isPending ?? false}
                        isRestoring={restoreMut.isPending}
                        isLockActionPending={resetMut.isPending || fullyApproveMut.isPending}
                      />
                    </Tr>
                    {editingId === f.id && (
                      <Tr key={`${f.id}-edit`}>
                        <Td colSpan={displayColumns.length + 1} className="!py-3">
                          <div className="rounded-xl bg-gray-50 p-4">
                            {detailLoading ? (
                              <div className="flex items-center justify-center gap-3 py-6 text-btn-start">
                                <Spinner size="sm" />
                                <span className="text-sm font-medium">Loading…</span>
                              </div>
                            ) : detail ? (
                              <FamilyForm
                                title={`Edit Family #${detail.display_id}`}
                                initial={detail}
                                isEdit={true}
                                referrerMap={referrerMap}
                                referrerOptionsLoading={referrersLoading}
                                deliveryUserMap={deliveryUserMap}
                                deliveryUsersLoading={deliveryUsersLoading}
                                showReferrerNotes
                                showCashOnly
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

          {/* Lock edit confirmation */}
          <ConfirmDialog
            open={lockEditConfirm}
            title="Edit admin-approved family?"
            description="This family is fully approved and visible to donors. Changes will be immediately visible. Are you sure you want to proceed?"
            onConfirm={handleUpdateConfirmed}
            onCancel={() => {
              setLockEditConfirm(false);
              pendingPayload.current = null;
            }}
            loading={updateMut?.isPending}
            confirmLabel="Yes, update"
            loadingLabel="Updating…"
            confirmVariant="primary"
          />

          {/* Unapprove / fully approve confirmations (shared via useWishLockActions) */}
          {confirmDialogs}

          {/* Send email — one composer for the whole table, prefilled per row */}
          <AdminEmailComposer
            open={sendEmailFamily !== null}
            contextLabel={
              sendEmailFamily ? `Family ${sendEmailFamily.display_id ?? sendEmailFamily.id} — ${sendEmailFamily.family_name}` : null
            }
            context={
              sendEmailFamily?.family_wish ? (
                <p>
                  <span className="font-medium text-gray-900">Family wish:</span> {sendEmailFamily.family_wish}
                </p>
              ) : null
            }
            prefilledRecipient={sendEmailFamily?.contact_email ?? null}
            recipientOptions={sendEmailFamily?.contact_email ? [{ email: sendEmailFamily.contact_email, label: "Family contact" }] : null}
            onClose={() => setSendEmailFamily(null)}
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
          mutations={[createMut, updateMut, deleteMut, restoreMut, resetMut, fullyApproveMut].filter(
            (m): m is NonNullable<typeof m> => m != null
          )}
        />
      </main>
    </div>
  );
}
