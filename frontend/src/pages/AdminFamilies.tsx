/**
 * Admin — Manage Families
 *
 * List, create, edit, delete families.
 * Uses useCrudManager for data fetching and mutations.
 * Separate "Deleted" tab calls the /deleted endpoint.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ActionsDropdown } from "../components/ActionsDropdown";
import { ApprovalBadge } from "../components/ApprovalBadge";
import { Button } from "../components/Button";
import { ColumnToggle } from "../components/ColumnToggle";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { CrudTabs } from "../components/CrudTabs";
import { DisplayId } from "../components/DisplayId";
import { defaultFamilyForm } from "../components/defaults";
import { FamilyForm } from "../components/FamilyForm";
import { HeaderBar } from "../components/HeaderBar";
import { MutationErrors } from "../components/MutationErrors";
import { Pagination } from "../components/Pagination";
import { PageSpinner, Spinner } from "../components/Spinner";
import { Table, TableBody, TableHead, Td, Th, Tr } from "../components/Table";
import { useToast } from "../context/ToastContext";
import { useColumnVisibility } from "../hooks/useColumnVisibility";
import { useCrudManager } from "../hooks/useCrudManager";
import { useCrudTabs } from "../hooks/useCrudTabs";
import { useDebouncedState } from "../hooks/useDebouncedState";
import { useDeliveryUsers } from "../hooks/useDeliveryUsers";
import { getPaginationInfo, usePagination } from "../hooks/usePagination";
import { useTableWidth } from "../hooks/useTableWidth";
import {
  adminApproveWishes,
  adminCreateFamily,
  adminDeleteFamily,
  adminGetFamily,
  adminGetReferrersDropdown,
  adminListDeletedFamilies,
  adminListFamilies,
  adminResetWishState,
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
  adminReferrersDropdown,
  adminReviewQueue,
  adminWishes,
} from "../lib/queryKeys";
import { route } from "../lib/routes";
import { normalizeUpdatePayload } from "../lib/utils";
import type { AdminFamiliesListParams, FamilyDetail, FamilyPayload } from "../types";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function getLockLevelRowClass(deletedAt: string | null, wishLockLevel: string): string {
  if (deletedAt != null) return "";
  if (wishLockLevel === "admin") return "bg-emerald-50";
  if (wishLockLevel === "referrer") return "bg-amber-50";
  return "";
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function AdminFamilies() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const pagination = usePagination();
  const { viewTab, isDeletedView, handleTabChange } = useCrudTabs({ pagination });
  const [restoreConfirm, setRestoreConfirm] = useState<number | null>(null);
  const [resetConfirm, setResetConfirm] = useState<number | null>(null);
  const [fullyApproveConfirm, setFullyApproveConfirm] = useState<number | null>(null);
  const [verificationFilter, setVerificationFilter] = useState<string>("");
  const [lockLevelFilter, setLockLevelFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchName, setSearchName] = useState("");
  const [searchContact, setSearchContact] = useState("");
  const [searchPhone, setSearchPhone] = useState("");
  const [searchWish, setSearchWish] = useState("");
  const [minPersonCount, setMinPersonCount] = useState("");
  const [maxPersonCount, setMaxPersonCount] = useState("");
  const [sortField, setSortField] = useState<string | null>(null);
  const [lockEditConfirm, setLockEditConfirm] = useState<boolean>(false);
  const pendingPayload = useRef<FamilyPayload | null>(null);

  // Column visibility
  const { visibleColumns, apiColumns } = useColumnVisibility("adminFamilies");
  const { widthClass } = useTableWidth("adminFamilies");

  const debouncedSearch = useDebouncedState(searchQuery, 1000, () => pagination.goToPage(1));
  const debouncedSearchName = useDebouncedState(searchName, 1000, () => pagination.goToPage(1));
  const debouncedSearchContact = useDebouncedState(searchContact, 1000, () => pagination.goToPage(1));
  const debouncedSearchPhone = useDebouncedState(searchPhone, 1000, () => pagination.goToPage(1));
  const debouncedSearchWish = useDebouncedState(searchWish, 1000, () => pagination.goToPage(1));
  const debouncedMinPersonCount = useDebouncedState(minPersonCount, 1000, () => pagination.goToPage(1));
  const debouncedMaxPersonCount = useDebouncedState(maxPersonCount, 1000, () => pagination.goToPage(1));

  // Cycle sort: null → "person_count" → "-person_count" → null
  function handleSortToggle() {
    setSortField((prev) => {
      if (prev === null) return "person_count";
      if (prev === "person_count") return "-person_count";
      return null;
    });
    pagination.goToPage(1);
  }

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
      verification_status: verificationFilter || undefined,
      wish_lock_level: lockLevelFilter || undefined,
      min_person_count: debouncedMinPersonCount !== "" ? parseInt(debouncedMinPersonCount, 10) : undefined,
      max_person_count: debouncedMaxPersonCount !== "" ? parseInt(debouncedMaxPersonCount, 10) : undefined,
      sort: sortField || undefined,
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
      verificationFilter,
      lockLevelFilter,
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
      adminFamiliesDropdown,
    ],
    entityName: "Family",
  });

  const pageInfo = useMemo(
    () => getPaginationInfo(listData?.total ?? 0, pagination.page, pagination.pageSize),
    [listData?.total, pagination.page, pagination.pageSize]
  );

  // Referrers lookup (for dropdown + display)
  const { data: referrers, isLoading: referrersLoading } = useQuery({
    queryKey: adminReferrersDropdown,
    queryFn: () => adminGetReferrersDropdown(),
  });

  const referrerMap = useMemo((): Record<number, string> => {
    const map: Record<number, string> = {};
    (referrers ?? []).forEach((r) => {
      map[r.id] = r.name;
    });
    return map;
  }, [referrers]);

  // Delivery users lookup (for dropdown)
  const { deliveryUserMap, deliveryUsersLoading } = useDeliveryUsers();

  // Reset wish state mutation
  const resetMut = useMutation({
    mutationFn: adminResetWishState,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminFamilies });
      queryClient.invalidateQueries({ queryKey: adminReviewQueue });
      queryClient.invalidateQueries({ queryKey: adminPackingSlips });
      queryClient.invalidateQueries({ queryKey: adminWishes });
      toast.success("Wish lock reset — family can now edit their wishes");
    },
  });

  // Fully approve mutation (skips review flow)
  const fullyApproveMut = useMutation({
    mutationFn: adminApproveWishes,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminFamilies });
      queryClient.invalidateQueries({ queryKey: adminReviewQueue });
      queryClient.invalidateQueries({ queryKey: adminPackingSlips });
      queryClient.invalidateQueries({ queryKey: adminWishes });
      toast.success("Family fully approved and visible to donors");
    },
  });

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

  if (listLoading) return <PageSpinner />;

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar title="Kindness is Magic" />

      <main className={`mx-auto px-4 py-8 sm:px-6 ${widthClass}`}>
        {/* Header */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold text-violet-950">Manage Families</h2>
          <div className="flex items-center gap-3">
            {!isDeletedView && <ColumnToggle resourceKey="adminFamilies" />}
            {!isDeletedView && <Button onClick={openCreate}>+ Add Family</Button>}
          </div>
        </div>

        {/* Tabs */}
        <CrudTabs viewTab={viewTab} onChange={handleTabChange} />

        {/* Filters */}
        {!isDeletedView && (
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <select
              aria-label="Verification status filter"
              value={verificationFilter}
              onChange={(e) => {
                setVerificationFilter(e.target.value);
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
              value={lockLevelFilter}
              onChange={(e) => {
                setLockLevelFilter(e.target.value);
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
                value={minPersonCount}
                onChange={(e) => setMinPersonCount(e.target.value)}
                className="w-16 rounded-lg border border-gray-300 px-2 py-2 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
                autoComplete="off"
              />
              <span className="text-xs text-gray-400">—</span>
              <input
                type="number"
                min="0"
                placeholder="Max"
                aria-label="Maximum people"
                value={maxPersonCount}
                onChange={(e) => setMaxPersonCount(e.target.value)}
                className="w-16 rounded-lg border border-gray-300 px-2 py-2 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
                autoComplete="off"
              />
              <span className="text-xs text-gray-500">people</span>
            </div>
            <input
              type="text"
              placeholder="Search all fields…"
              aria-label="Search all fields"
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
            <FamilyForm
              title="Add Family"
              initial={defaultFamilyForm}
              isEdit={false}
              referrerMap={referrerMap}
              referrerOptionsLoading={referrersLoading}
              deliveryUserMap={deliveryUserMap}
              deliveryUsersLoading={deliveryUsersLoading}
              showReferrerNotes
              onSubmit={handleCreate}
              onCancel={cancelForm}
              loading={!!createMut?.isPending}
            />
          )}

          {/* Table — always rendered so column headers / filters stay visible */}
          <Table>
            <TableHead>
              {visibleColumns.includes("display_id") && <Th>ID</Th>}
              {visibleColumns.includes("family_name") && (
                <Th>
                  <div className="flex flex-col gap-1">
                    <span>Family Name</span>
                    <input
                      type="text"
                      placeholder="Filter…"
                      aria-label="Filter by family name"
                      value={searchName}
                      onChange={(e) => setSearchName(e.target.value)}
                      className="w-full rounded border border-gray-200 px-1.5 py-0.5 text-xs outline-none transition-colors focus:border-btn-start focus:ring-1 focus:ring-btn-start/20"
                      autoComplete="off"
                    />
                  </div>
                </Th>
              )}
              {visibleColumns.includes("family_wish") && (
                <Th>
                  <div className="flex flex-col gap-1">
                    <span>Family Wish</span>
                    <input
                      type="text"
                      placeholder="Filter…"
                      aria-label="Filter by family wish"
                      value={searchWish}
                      onChange={(e) => setSearchWish(e.target.value)}
                      className="w-full rounded border border-gray-200 px-1.5 py-0.5 text-xs outline-none transition-colors focus:border-btn-start focus:ring-1 focus:ring-btn-start/20"
                      autoComplete="off"
                    />
                  </div>
                </Th>
              )}
              {visibleColumns.includes("contact_name") && (
                <Th>
                  <div className="flex flex-col gap-1">
                    <span>Contact</span>
                    <input
                      type="text"
                      placeholder="Filter…"
                      aria-label="Filter by contact name"
                      value={searchContact}
                      onChange={(e) => setSearchContact(e.target.value)}
                      className="w-full rounded border border-gray-200 px-1.5 py-0.5 text-xs outline-none transition-colors focus:border-btn-start focus:ring-1 focus:ring-btn-start/20"
                      autoComplete="off"
                    />
                  </div>
                </Th>
              )}
              {visibleColumns.includes("referrer_id") && <Th>Referrer</Th>}
              {visibleColumns.includes("delivery") && <Th>Delivery</Th>}
              {visibleColumns.includes("claim") && <Th>Claim</Th>}
              {visibleColumns.includes("phone_number") && (
                <Th>
                  <div className="flex flex-col gap-1">
                    <span>Phone</span>
                    <input
                      type="text"
                      placeholder="Filter…"
                      aria-label="Filter by phone number"
                      value={searchPhone}
                      onChange={(e) => setSearchPhone(e.target.value)}
                      className="w-full rounded border border-gray-200 px-1.5 py-0.5 text-xs outline-none transition-colors focus:border-btn-start focus:ring-1 focus:ring-btn-start/20"
                      autoComplete="off"
                    />
                  </div>
                </Th>
              )}
              {visibleColumns.includes("person_count") && (
                <Th>
                  <button
                    type="button"
                    onClick={handleSortToggle}
                    className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-gray-500 transition-colors hover:text-gray-700"
                  >
                    Person Count
                    <span className="text-[10px]">{sortField === "person_count" ? "↑" : sortField === "-person_count" ? "↓" : "⇅"}</span>
                  </button>
                </Th>
              )}
              {visibleColumns.includes("verification_status") && <Th>Verification</Th>}
              {visibleColumns.includes("pickup_window") && <Th>Pickup Window</Th>}
              {visibleColumns.includes("wish_lock_level") && <Th>Lock Level</Th>}
              {visibleColumns.includes("wish_review_requested_at") && <Th>Review Requested</Th>}
              {visibleColumns.includes("wish_rejection_reason") && <Th>Rejection Reason</Th>}
              <Th>Actions</Th>
            </TableHead>
            <TableBody>
              {families.length === 0 ? (
                <Tr>
                  <Td colSpan={visibleColumns.length + 1} className="!text-center !text-gray-400 py-12">
                    {isDeletedView ? "No deleted families." : "No families yet."}
                  </Td>
                </Tr>
              ) : (
                families.map((f) => (
                  <React.Fragment key={f.id}>
                    <Tr data-id={f.id} className={getLockLevelRowClass(f.deleted_at, f.wish_lock_level)}>
                      {visibleColumns.includes("display_id") && (
                        <Td className="whitespace-nowrap text-xs text-gray-400">
                          <DisplayId displayId={f.display_id} familyId={f.id} referrerId={f.referrer_id} />
                        </Td>
                      )}
                      {visibleColumns.includes("family_name") && (
                        <Td className={f.deleted_at != null ? "text-gray-400" : ""}>
                          {f.family_name}
                          {f.deleted_at == null && f.referrer_notes != null && (
                            <span className="ml-1 text-xs" title="Has internal notes">
                              📝
                            </span>
                          )}
                          {f.deleted_at == null && !isDeletedView && f.wish_lock_level === "admin" && (
                            <Link
                              to={route.familyWishList(f.id)}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label="Wish List"
                              className="ml-1 text-xs text-gray-400 transition-colors hover:text-violet-600"
                              title="Wish List"
                            >
                              📄
                            </Link>
                          )}
                        </Td>
                      )}
                      {visibleColumns.includes("family_wish") && <Td className="max-w-xs truncate">{f.family_wish ?? ""}</Td>}
                      {visibleColumns.includes("contact_name") && <Td>{f.contact_name}</Td>}
                      {visibleColumns.includes("referrer_id") && (
                        <Td>
                          {f.referrer_id != null ? (
                            <Link
                              to={route.adminReferrerFamilies(f.referrer_id)}
                              className="text-sm text-violet-600 transition-colors hover:text-violet-800"
                            >
                              {f.referrer_name || referrerMap[f.referrer_id] || `ID ${f.referrer_id}`}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </Td>
                      )}
                      {visibleColumns.includes("delivery") && (
                        <Td>{f.delivery_user_name || (f.delivery_user_id != null ? `ID ${f.delivery_user_id}` : "—")}</Td>
                      )}
                      {visibleColumns.includes("claim") && (
                        <Td>
                          {f.claim_status != null ? (
                            <ClaimBadge
                              status={f.claim_status}
                              commitmentType={f.claim_commitment_type ?? ""}
                              donorName={f.claim_donor_name ?? undefined}
                              claimId={f.claim_id ?? undefined}
                            />
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </Td>
                      )}
                      {visibleColumns.includes("phone_number") && <Td>{f.phone_number || "—"}</Td>}
                      {visibleColumns.includes("person_count") && <Td>{f.person_count ?? 0}</Td>}
                      {visibleColumns.includes("verification_status") && (
                        <Td>
                          <ApprovalBadge status={f.verification_status} />
                        </Td>
                      )}
                      {visibleColumns.includes("pickup_window") && <Td className="text-xs">{f.pickup_window || "—"}</Td>}
                      {visibleColumns.includes("wish_lock_level") && (
                        <Td>
                          <span className="text-xs capitalize">{f.wish_lock_level}</span>
                        </Td>
                      )}
                      {visibleColumns.includes("wish_review_requested_at") && (
                        <Td className="text-xs text-gray-500">
                          {f.wish_review_requested_at ? new Date(f.wish_review_requested_at).toLocaleDateString() : "—"}
                        </Td>
                      )}
                      {visibleColumns.includes("wish_rejection_reason") && (
                        <Td className="max-w-xs text-xs text-gray-500 truncate">{f.wish_rejection_reason || "—"}</Td>
                      )}
                      <Td>
                        <div className="flex gap-2">
                          {!isDeletedView && f.deleted_at == null && (
                            <Link
                              to={route.adminFamilyPeople(f.id)}
                              className="inline-flex items-center rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700"
                            >
                              Manage
                            </Link>
                          )}
                          {!isDeletedView && f.deleted_at == null && (
                            <>
                              <Button
                                variant="secondary"
                                size="sm"
                                className="px-3 py-1.5 text-xs"
                                onClick={() => (editingId === f.id ? cancelForm() : openEdit(f.id))}
                              >
                                {editingId === f.id ? "Done" : "Edit"}
                              </Button>
                              <ActionsDropdown
                                items={[
                                  {
                                    label: "View Packing Slip",
                                    onClick: () => navigate(route.adminPackingSlips([f.id])),
                                  },
                                  ...(f.wish_lock_level !== "family"
                                    ? [
                                        {
                                          label: "Reset Lock",
                                          variant: "secondary" as const,
                                          onClick: () => setResetConfirm(f.id),
                                        },
                                      ]
                                    : []),
                                  ...(f.wish_lock_level !== "admin"
                                    ? [
                                        {
                                          label: "Fully Approve",
                                          onClick: () => setFullyApproveConfirm(f.id),
                                        },
                                      ]
                                    : []),
                                  {
                                    label: "Delete",
                                    variant: "danger" as const,
                                    onClick: () => confirmDelete(f.id),
                                  },
                                ]}
                                disabled={deleteMut?.isPending || resetMut.isPending || fullyApproveMut.isPending}
                              />
                            </>
                          )}
                          {isDeletedView && (
                            <Button
                              variant="secondary"
                              size="sm"
                              className="px-3 py-1.5 text-xs"
                              onClick={() => setRestoreConfirm(f.id)}
                              disabled={restoreMut?.isPending}
                            >
                              Restore
                            </Button>
                          )}
                        </div>
                      </Td>
                    </Tr>
                    {editingId === f.id && (
                      <Tr key={`${f.id}-edit`}>
                        <Td colSpan={visibleColumns.length + 1} className="!py-3">
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

          {/* Reset wish lock confirmation */}
          <ConfirmDialog
            open={resetConfirm !== null}
            title={
              <>
                Reset wish lock for family <strong>#{resetConfirm}</strong>?
              </>
            }
            description="This will unlock the family's wishes so they can edit them again. Any admin approval will be removed."
            onConfirm={() => {
              if (resetConfirm != null) {
                resetMut.mutate(resetConfirm);
                setResetConfirm(null);
              }
            }}
            onCancel={() => setResetConfirm(null)}
            loading={resetMut.isPending}
            confirmLabel="Yes, reset"
            loadingLabel="Resetting…"
            confirmVariant="secondary"
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

/* ------------------------------------------------------------------ */
/* Claim Badge (admin families table)                                 */
/* ------------------------------------------------------------------ */

interface ClaimBadgeProps {
  status: string;
  commitmentType: string;
  donorName?: string;
  claimId?: number;
}

function ClaimBadge({ status, commitmentType, donorName, claimId }: ClaimBadgeProps) {
  const colorMap: Record<string, string> = {
    active: "bg-emerald-100 text-emerald-800 border-emerald-200",
    fulfilled: "bg-gray-100 text-gray-600 border-gray-200",
  };
  const cls = colorMap[status] ?? "bg-blue-100 text-blue-800 border-blue-200";

  if (claimId != null) {
    return (
      <Link
        to={route.donorClaimDetail(claimId)}
        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${cls} cursor-pointer transition-colors hover:opacity-80`}
      >
        {status} — {commitmentType}
        {donorName && <span className="text-[11px] opacity-75">({donorName})</span>}
      </Link>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${cls}`}>
      {status} — {commitmentType}
      {donorName && <span className="text-[11px] opacity-75">({donorName})</span>}
    </span>
  );
}
