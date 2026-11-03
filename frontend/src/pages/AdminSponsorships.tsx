/**
 * Admin — Sponsorships
 *
 * Every sponsorship (claim) — active and cancelled. The only admin surface
 * that lists sponsorships as entities: the donor list is per-donor, family
 * pages show a claim badge, and the Zeffy page only sees unpaid claims.
 * Cancelled sponsorships (donor/admin cancels, lapsed payment windows) are
 * invisible everywhere else — GET-by-id 404s them — so this page is also
 * the audit view for cancellations after money was taken and the lookup
 * for the restore endpoint.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type React from "react";
import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ColumnToggle } from "../components/ColumnToggle";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DraggableTh } from "../components/DraggableTh";
import { HeaderBar } from "../components/HeaderBar";
import { MutationErrors } from "../components/MutationErrors";
import { Pagination } from "../components/Pagination";
import { PageSpinner } from "../components/Spinner";
import { Table, TableBody, TableHead, Td, Th, Tr } from "../components/Table";
import { useToast } from "../context/ToastContext";
import { useColumnOrder } from "../hooks/useColumnOrder";
import { useColumnVisibility } from "../hooks/useColumnVisibility";
import { useDebouncedState } from "../hooks/useDebouncedState";
import { getPaginationInfo, usePagination } from "../hooks/usePagination";
import { useTableWidth } from "../hooks/useTableWidth";
import { adminListClaims, adminRestoreClaim } from "../lib/api";
import { adminClaims, familyWishList, publicFamilies } from "../lib/queryKeys";
import { route } from "../lib/routes";
import { formatDateTime } from "../lib/utils";
import { type AdminClaim, type AdminClaimsListParams, type ClaimFamilyInfo, isPendingCash } from "../types";

const STATUS_FILTERS: { value: "" | "active" | "cancelled"; label: string }[] = [
  { value: "", label: "All" },
  { value: "active", label: "Active" },
  { value: "cancelled", label: "Cancelled" },
];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

/**
 * A non-enumerable family (e.g. soft-deleted) has no stable display ID —
 * display IDs are positions among *active* families — so show the raw PK,
 * the only stable identifier left.
 */
function familyLabel(fam: Pick<ClaimFamilyInfo, "id" | "display_id">): string {
  return fam.display_id === "0" ? `#${fam.id}` : fam.display_id;
}

export default function AdminSponsorships() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const pagination = usePagination({ defaultPageSize: 50, pageSizeOptions: [20, 50, 100, 200] });
  const [statusFilter, setStatusFilter] = useState<"" | "active" | "cancelled">("");
  const [searchQuery, setSearchQuery] = useState("");

  // Column visibility + user column order
  const { visibleColumns, apiColumns } = useColumnVisibility("adminSponsorships");
  const { orderedKeys, reorder, moveBy, resetOrder, isDefaultOrder } = useColumnOrder("adminSponsorships", visibleColumns);
  const { widthClass } = useTableWidth("adminSponsorships");

  // Visible columns in the user's custom order (drives header + row render).
  const displayColumns = useMemo(() => orderedKeys.filter((k) => visibleColumns.includes(k)), [orderedKeys, visibleColumns]);

  // Claim whose restore is awaiting confirmation (null = closed)
  const [restoreConfirm, setRestoreConfirm] = useState<AdminClaim | null>(null);

  const debouncedSearch = useDebouncedState(searchQuery, 1000, () => pagination.goToPage(1));

  const listParams = useMemo<AdminClaimsListParams>(
    () => ({
      ...pagination.params,
      columns: apiColumns,
      status: statusFilter || undefined,
      search: debouncedSearch || undefined,
    }),
    [pagination.params, apiColumns, statusFilter, debouncedSearch]
  );

  const { data: listData, isLoading } = useQuery({
    queryKey: [...adminClaims, listParams],
    queryFn: () => adminListClaims(listParams),
    staleTime: 0, // mutable list — always refetch when viewed (global default is 5min)
  });

  const pageInfo = useMemo(
    () => getPaginationInfo(listData?.total ?? 0, pagination.page, pagination.pageSize),
    [listData?.total, pagination.page, pagination.pageSize]
  );

  const claims = listData?.claims ?? [];

  const restoreMut = useMutation({
    mutationFn: (claimId: number) => adminRestoreClaim(claimId),
    onSuccess: (restored) => {
      // Restoring re-claims the family — refresh the public lists too
      queryClient.invalidateQueries({ queryKey: adminClaims });
      queryClient.invalidateQueries({ queryKey: publicFamilies });
      queryClient.invalidateQueries({ queryKey: familyWishList(restored.family.id) });
    },
  });

  if (isLoading) return <PageSpinner />;

  /** Restorable on the server: cash + unpaid (cancelled is implied by the row). */
  const isRestorable = (claim: AdminClaim) => claim.commitment_type === "cash" && claim.paid_at == null;

  const restoreHint = (claim: AdminClaim) =>
    claim.commitment_type === "gifts" ? "Gift sponsorships cannot be restored" : "Paid sponsorships cannot be restored";

  // Header cells per column key.
  const sponsorshipHeaders: Record<string, React.ReactNode> = {
    donor_email: "Donor",
    family: "Family",
    commitment: "Commitment",
    sponsorship_status: "Status",
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar />

      <main className={`mx-auto px-4 py-8 sm:px-6 ${widthClass}`}>
        {/* Header */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold text-violet-950">Sponsorships</h2>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="text"
              placeholder="Search by donor email or family name…"
              aria-label="Search by donor email or family name"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-72 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
              autoComplete="off"
            />
            <select
              aria-label="Sponsorship status filter"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as "" | "active" | "cancelled");
                pagination.goToPage(1);
              }}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
            >
              {STATUS_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
            {!isDefaultOrder && (
              <Button variant="secondary" onClick={resetOrder}>
                Reset order
              </Button>
            )}
            <ColumnToggle resourceKey="adminSponsorships" />
          </div>
        </div>

        {/* Info note */}
        <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 px-5 py-3 text-sm text-blue-800">
          All sponsorships — active and cancelled (cancelled includes lapsed cash payment windows). Cancelled sponsorships are hidden
          everywhere else; restoring an unpaid cash one re-opens it with a fresh payment window. Paid sponsorships cannot be cancelled or
          restored.
        </div>

        {/* Table */}
        {claims.length === 0 ? (
          <Card>
            <p className="py-8 text-center text-gray-400">No sponsorships.</p>
          </Card>
        ) : (
          <Table>
            <TableHead>
              {displayColumns.map((key) => (
                <DraggableTh key={key} unit={[key]} onReorder={reorder} onMoveBy={moveBy}>
                  {sponsorshipHeaders[key]}
                </DraggableTh>
              ))}
              <Th>Actions</Th>
            </TableHead>
            <TableBody>
              {claims.map((claim) => {
                const claimCells: Record<string, React.ReactNode> = {
                  donor_email: <Td className="font-medium text-gray-900">{claim.donor_email}</Td>,
                  family: (
                    <Td className="text-sm">
                      <div className="text-gray-900">{claim.family_name}</div>
                      <div className="mt-0.5 text-[11px] text-gray-500">{familyLabel(claim.family)}</div>
                    </Td>
                  ),
                  commitment: (
                    <Td>
                      <div>
                        <span className="text-sm capitalize text-gray-700">{claim.commitment_type}</span>
                        {claim.commitment_type === "cash" && (
                          <p className="mt-0.5 text-[11px] text-gray-500">
                            {claim.paid_at != null ? `Paid ${formatDateTime(claim.paid_at)}` : "Unpaid"}
                          </p>
                        )}
                      </div>
                    </Td>
                  ),
                  sponsorship_status: (
                    <Td className="whitespace-nowrap text-sm">
                      {claim.deleted_at != null ? (
                        <span className="text-gray-500">Cancelled {formatDateTime(claim.deleted_at)}</span>
                      ) : isPendingCash(claim) ? (
                        <span className="font-medium text-amber-600">Awaiting payment</span>
                      ) : claim.fulfilled_at != null ? (
                        <span className="font-medium text-emerald-600">Fulfilled</span>
                      ) : (
                        <span className="font-medium text-blue-600">Active</span>
                      )}
                    </Td>
                  ),
                };
                return (
                  <Tr key={claim.id}>
                    {displayColumns.map((key) => (
                      <Fragment key={key}>{claimCells[key]}</Fragment>
                    ))}
                    <Td>
                      {claim.deleted_at != null ? (
                        <Button
                          variant="secondary"
                          disabled={!isRestorable(claim)}
                          title={isRestorable(claim) ? undefined : restoreHint(claim)}
                          onClick={() => setRestoreConfirm(claim)}
                        >
                          Restore
                        </Button>
                      ) : (
                        <Link
                          to={route.donorClaimDetail(claim.id)}
                          className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
                        >
                          View
                        </Link>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </TableBody>
          </Table>
        )}

        {/* Pagination */}
        <Pagination
          page={pagination.page}
          totalPages={pageInfo.totalPages}
          total={listData?.total ?? 0}
          pageSize={pagination.pageSize}
          onPageChange={pagination.goToPage}
          onPageSizeChange={pagination.setPageSize}
        />

        {/* Restore confirmation */}
        <ConfirmDialog
          open={restoreConfirm !== null}
          title={
            <>
              Restore sponsorship <strong>{restoreConfirm?.family_name}</strong>?
            </>
          }
          description="The sponsorship is re-opened with a fresh payment window and the family becomes claimed again. If the family was sponsored or deleted in the meantime, the restore will fail."
          onConfirm={() => {
            if (restoreConfirm != null) {
              const name = restoreConfirm.family_name;
              restoreMut.mutate(restoreConfirm.id, { onSuccess: () => toast.success(`Sponsorship ${name} restored`) });
              setRestoreConfirm(null);
            }
          }}
          onCancel={() => setRestoreConfirm(null)}
          loading={restoreMut.isPending}
          confirmLabel="Restore"
          loadingLabel="Restoring…"
          confirmVariant="success"
        />

        {/* Errors */}
        <MutationErrors mutations={[restoreMut]} />
      </main>
    </div>
  );
}
