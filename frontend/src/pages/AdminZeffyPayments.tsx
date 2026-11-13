/**
 * Admin — Zeffy Payments (unmatched-payment reconciliation)
 *
 * Lists the dedicated campaign's mirrored payments (the local table — the
 * webhook, the hourly sync, and "Sync with Zeffy" keep it fresh). Unmatched
 * payments are shown by default (the admin banner's population) with a
 * "Show matched" toggle; "Match manually" opens a modal fed by the pending
 * cash claims grouped by donor (per-donor checkboxes + expected amount) and
 * marks the chosen claims paid. "Unmatch" (matched rows, behind a confirm
 * dialog) is the correction path: it reverts the payment's claims to
 * pending with a fresh payment window so the payment can be re-matched to
 * the right claims. "Seen" is the admin's "no action needed" acknowledgment
 * for payments that can't be matched (suppresses the dashboard banner).
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
import { PageError } from "../components/PageError";
import { Pagination } from "../components/Pagination";
import { PageSpinner } from "../components/Spinner";
import { Table, TableBody, TableHead, Td, Th, Tr } from "../components/Table";
import { useToast } from "../context/ToastContext";
import { useColumnOrder } from "../hooks/useColumnOrder";
import { useColumnVisibility } from "../hooks/useColumnVisibility";
import { getPaginationInfo, usePagination } from "../hooks/usePagination";
import { useTableWidth } from "../hooks/useTableWidth";
import {
  adminClearZeffyPaymentSeen,
  adminListZeffyPayments,
  adminListZeffyPendingClaims,
  adminMarkZeffyPaymentSeen,
  adminMatchZeffyPayment,
  adminSyncZeffyPayments,
  adminUnmatchZeffyPayment,
} from "../lib/api";
import { CASH_CLAIM_PAYMENT_HOURS } from "../lib/constants";
import { adminZeffyPayments, adminZeffyPendingClaims, adminZeffyUnmatchedSummary } from "../lib/queryKeys";
import { route } from "../lib/routes";
import { formatApiError, formatDateTime } from "../lib/utils";
import type { ZeffyPayment } from "../types";

/** Format raw Zeffy cents as dollars for admin display. */
function formatAmount(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function AdminZeffyPayments() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const pagination = usePagination({ defaultPageSize: 25, pageSizeOptions: [20, 25, 50, 100] });

  // Unmatched-only by default (the banner's population); the toggle shows
  // the full history (matched + seen rows).
  const [showMatched, setShowMatched] = useState(false);
  const [matchTarget, setMatchTarget] = useState<ZeffyPayment | null>(null);
  const [unmatchTarget, setUnmatchTarget] = useState<ZeffyPayment | null>(null);

  // Column visibility + user column order
  const { visibleColumns, apiColumns } = useColumnVisibility("adminZeffyPayments");
  const { orderedKeys, reorder, moveBy, resetOrder, isDefaultOrder } = useColumnOrder("adminZeffyPayments", visibleColumns);
  const { widthClass } = useTableWidth("adminZeffyPayments");

  const displayColumns = useMemo(() => orderedKeys.filter((k) => visibleColumns.includes(k)), [orderedKeys, visibleColumns]);

  const listParams = useMemo(
    () => ({ ...pagination.params, columns: apiColumns, show_matched: showMatched }),
    [pagination.params, apiColumns, showMatched]
  );

  const {
    data: listData,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: [...adminZeffyPayments, listParams],
    queryFn: () => adminListZeffyPayments(listParams),
    staleTime: 0, // live reconciliation view — always refetch when viewed
  });

  const pageInfo = useMemo(
    () => getPaginationInfo(listData?.total ?? 0, pagination.page, pagination.pageSize),
    [listData?.total, pagination.page, pagination.pageSize]
  );

  const payments = listData?.payments ?? [];

  // The page's "Sync with Zeffy" — pulls the campaign's payments into the
  // local mirror now (the hourly background sync does the same in the
  // background; the header refresh button only refetches local state).
  const syncMut = useMutation({
    mutationFn: adminSyncZeffyPayments,
    onSuccess: (result) => {
      toast.success(result.new_count > 0 ? `Found ${result.new_count} new payment${result.new_count === 1 ? "" : "s"}` : "Up to date");
      void queryClient.invalidateQueries({ queryKey: adminZeffyPayments });
      void queryClient.invalidateQueries({ queryKey: adminZeffyUnmatchedSummary });
    },
    onError: (err: unknown) => {
      toast.error(formatApiError(err, "Sync failed — Zeffy may be unreachable"));
    },
  });

  // The admin's "no action needed" acknowledgment (suppresses the banner).
  const markSeenMut = useMutation({
    mutationFn: (paymentId: string) => adminMarkZeffyPaymentSeen(paymentId),
    onSuccess: () => {
      toast.success("Payment marked seen");
      void queryClient.invalidateQueries({ queryKey: adminZeffyPayments });
      void queryClient.invalidateQueries({ queryKey: adminZeffyUnmatchedSummary });
    },
  });

  const clearSeenMut = useMutation({
    mutationFn: (paymentId: string) => adminClearZeffyPaymentSeen(paymentId),
    onSuccess: () => {
      toast.success("Payment back in the unmatched queue");
      void queryClient.invalidateQueries({ queryKey: adminZeffyPayments });
      void queryClient.invalidateQueries({ queryKey: adminZeffyUnmatchedSummary });
    },
  });

  // Correction path: revert the payment's claims to pending (fresh payment
  // window) so the payment can be re-matched to the right claims.
  const unmatchMut = useMutation({
    mutationFn: (paymentId: string) => adminUnmatchZeffyPayment(paymentId),
    onSuccess: (result) => {
      toast.success(
        `Payment unmatched — ${result.claim_ids.length} ${result.claim_ids.length === 1 ? "sponsorship" : "sponsorships"} back to pending`
      );
      setUnmatchTarget(null);
      // The payment flips to unmatched (list) and the claims re-enter the
      // pending pool (match-modal data) — invalidate both + the banner.
      void queryClient.invalidateQueries({ queryKey: adminZeffyPayments });
      void queryClient.invalidateQueries({ queryKey: adminZeffyPendingClaims });
      void queryClient.invalidateQueries({ queryKey: adminZeffyUnmatchedSummary });
    },
  });

  if (isLoading) return <PageSpinner />;

  if (isError) {
    return (
      <div className="min-h-screen bg-slate-50">
        <HeaderBar />
        <PageError error={error} heading="Unable to Load Zeffy Payments" fallback="Something went wrong. Please try again later." />
      </div>
    );
  }

  const paymentHeaders: Record<string, React.ReactNode> = {
    created_at: "Date",
    buyer_name: "Buyer",
    buyer_email: "Email",
    amount_cents: "Amount",
    currency: "Currency",
    receipt_url: "Receipt",
    matched: "Matched",
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar />

      <main className={`mx-auto px-4 py-8 sm:px-6 ${widthClass}`}>
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-violet-950">Zeffy Payments</h2>
          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={() => syncMut.mutate()} loading={syncMut.isPending}>
              Sync with Zeffy
            </Button>
            {!isDefaultOrder && (
              <Button variant="secondary" onClick={resetOrder}>
                Reset order
              </Button>
            )}
            <ColumnToggle resourceKey="adminZeffyPayments" />
          </div>
        </div>

        {/* Info note */}
        <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 px-5 py-3 text-sm text-blue-800">
          Succeeded payments on the dedicated sponsorship form. Payments that didn&apos;t auto-match to a donor&apos;s cart need a manual
          match below — the admin dashboard shows a banner while any are waiting. Use <em>Sync with Zeffy</em> to pull new payments
          immediately (a background sync also runs hourly).
        </div>

        {/* Filters */}
        <div className="mb-4 flex items-center gap-2">
          <label htmlFor="show-matched" className="flex cursor-pointer items-center gap-2 text-sm font-medium text-gray-700">
            <input
              id="show-matched"
              type="checkbox"
              checked={showMatched}
              onChange={(e) => {
                setShowMatched(e.target.checked);
                pagination.goToPage(1);
              }}
              className="h-4 w-4 rounded border-gray-300"
            />
            Show matched
          </label>
        </div>

        {/* Table */}
        {payments.length === 0 ? (
          <Card>
            <p className="py-8 text-center text-gray-400">{showMatched ? "No payments found." : "No unmatched payments."}</p>
          </Card>
        ) : (
          <Table>
            <TableHead>
              {displayColumns.map((key) => (
                <DraggableTh key={key} unit={[key]} onReorder={reorder} onMoveBy={moveBy}>
                  {paymentHeaders[key]}
                </DraggableTh>
              ))}
              <Th>Actions</Th>
            </TableHead>
            <TableBody>
              {payments.map((payment) => {
                const paymentCells: Record<string, React.ReactNode> = {
                  created_at: <Td className="whitespace-nowrap text-sm text-gray-500">{formatDateTime(payment.created_at)}</Td>,
                  buyer_name: (
                    <Td className="font-medium text-gray-900">{payment.buyer_name ?? <span className="text-gray-400">—</span>}</Td>
                  ),
                  buyer_email: <Td>{payment.buyer_email ?? <span className="text-gray-400">—</span>}</Td>,
                  amount_cents: <Td className="whitespace-nowrap font-semibold text-gray-900">{formatAmount(payment.amount_cents)}</Td>,
                  currency: <Td className="uppercase text-gray-500">{payment.currency}</Td>,
                  receipt_url: payment.receipt_url ? (
                    <Td>
                      <a
                        href={payment.receipt_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-btn-start hover:underline"
                      >
                        Receipt
                      </a>
                    </Td>
                  ) : (
                    <Td>
                      <span className="text-gray-400">—</span>
                    </Td>
                  ),
                  matched: (
                    <Td>
                      {payment.matched ? (
                        <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                          Matched
                        </span>
                      ) : payment.seen_at ? (
                        <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                          Seen
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">
                          Unmatched
                        </span>
                      )}
                      {payment.refund_status !== "none" && (
                        <span className="ml-1.5 inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">
                          Refunded
                        </span>
                      )}
                      {payment.matched && payment.claim_ids.length > 0 && (
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {payment.claim_ids.map((claimId) => (
                            <Link
                              key={claimId}
                              to={route.donorClaimDetail(claimId)}
                              className="text-xs font-medium text-btn-start hover:underline"
                            >
                              Sponsorship {claimId}
                            </Link>
                          ))}
                        </div>
                      )}
                    </Td>
                  ),
                };
                return (
                  <Tr key={payment.id}>
                    {displayColumns.map((key) => (
                      <Fragment key={key}>{paymentCells[key]}</Fragment>
                    ))}
                    <Td>
                      <div className="flex items-center gap-1.5">
                        {payment.matched ? (
                          <Button variant="secondary" className="px-3 py-1 text-xs" onClick={() => setUnmatchTarget(payment)}>
                            Unmatch
                          </Button>
                        ) : (
                          <>
                            <Button variant="secondary" className="px-3 py-1 text-xs" onClick={() => setMatchTarget(payment)}>
                              Match manually
                            </Button>
                            {payment.seen_at ? (
                              <Button
                                variant="ghost"
                                className="px-3 py-1 text-xs"
                                loading={clearSeenMut.isPending && clearSeenMut.variables === payment.id}
                                onClick={() => clearSeenMut.mutate(payment.id)}
                              >
                                Unseen
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                className="px-3 py-1 text-xs"
                                loading={markSeenMut.isPending && markSeenMut.variables === payment.id}
                                onClick={() => markSeenMut.mutate(payment.id)}
                              >
                                Seen
                              </Button>
                            )}
                          </>
                        )}
                      </div>
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
          pageSizeOptions={pagination.pageSizeOptions}
          onPageChange={pagination.goToPage}
          onPageSizeChange={pagination.setPageSize}
        />
      </main>

      {matchTarget && (
        <MatchPaymentModal
          payment={matchTarget}
          onClose={() => setMatchTarget(null)}
          onMatched={() => {
            void queryClient.invalidateQueries({ queryKey: adminZeffyPayments });
            void queryClient.invalidateQueries({ queryKey: adminZeffyUnmatchedSummary });
          }}
        />
      )}

      <ConfirmDialog
        open={unmatchTarget != null}
        title="Unmatch this payment?"
        description={
          unmatchTarget
            ? `The ${unmatchTarget.claim_ids.length} matched ${
                unmatchTarget.claim_ids.length === 1 ? "sponsorship" : "sponsorships"
              } go back to pending with a fresh ${CASH_CLAIM_PAYMENT_HOURS}-hour payment window. Use this to correct a wrong match, then re-match the payment to the right sponsorships.`
            : undefined
        }
        onConfirm={() => {
          if (unmatchTarget) unmatchMut.mutate(unmatchTarget.id);
        }}
        onCancel={() => setUnmatchTarget(null)}
        loading={unmatchMut.isPending}
        confirmLabel="Yes, unmatch"
        loadingLabel="Unmatching…"
      />
      <MutationErrors mutations={[unmatchMut, markSeenMut, clearSeenMut]} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Match modal                                                         */
/* ------------------------------------------------------------------ */

function MatchPaymentModal({ payment, onClose, onMatched }: { payment: ZeffyPayment; onClose: () => void; onMatched: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [selected, setSelected] = useState<Set<number>>(() => new Set());

  // Grouped pending cash claims (local read — works even when Zeffy is
  // unconfigured, which only matters for the payment list itself)
  const { data, isLoading, isError, error } = useQuery({
    queryKey: adminZeffyPendingClaims,
    queryFn: adminListZeffyPendingClaims,
  });

  const matchMut = useMutation({
    mutationFn: (claimIds: number[]) => adminMatchZeffyPayment(payment.id, claimIds),
    onSuccess: (_result, claimIds) => {
      toast.success(`Payment matched to ${claimIds.length} ${claimIds.length === 1 ? "sponsorship" : "sponsorships"}`);
      onMatched();
      void queryClient.invalidateQueries({ queryKey: adminZeffyPendingClaims });
      onClose();
    },
  });

  const toggleClaim = (claimId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(claimId)) next.delete(claimId);
      else next.add(claimId);
      return next;
    });
  };

  const selectDonorClaims = (claimIds: number[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const claimId of claimIds) {
        if (on) next.add(claimId);
        else next.delete(claimId);
      }
      return next;
    });
  };

  const allItems = (data?.donors ?? []).flatMap((donor) => donor.claims);
  const selectedTotalCents = allItems
    .filter((item) => selected.has(item.claim_id))
    .reduce((sum, item) => sum + item.line_total_usd * 100, 0);
  const exactMatch = selectedTotalCents === payment.amount_cents;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4" role="presentation">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl bg-white p-6 shadow-2xl" role="dialog" aria-modal="true">
        <h3 className="text-base font-semibold text-gray-900">Match payment manually</h3>
        <p className="mt-1 text-sm text-gray-600">
          {formatAmount(payment.amount_cents)} {payment.currency.toUpperCase()}
          {payment.buyer_email ? ` from ${payment.buyer_email}` : ""} · {formatDateTime(payment.created_at)}
        </p>

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
          {isLoading && <PageSpinner />}
          {isError && <p className="text-sm text-red-600">{formatApiError(error, "Could not load pending sponsorships.")}</p>}
          {!isLoading && !isError && (data?.donors.length ?? 0) === 0 && (
            <p className="text-sm text-gray-500">No pending cash sponsorships to match.</p>
          )}

          {(data?.donors ?? []).map((donor) => {
            const donorClaimIds = donor.claims.map((claim) => claim.claim_id);
            const allSelected = donorClaimIds.length > 0 && donorClaimIds.every((id) => selected.has(id));
            return (
              <div key={donor.donor_id} className="mb-4 rounded-lg border border-gray-200 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{donor.donor_display_name || donor.donor_email}</p>
                    {donor.donor_display_name != null && <p className="text-xs text-gray-500">{donor.donor_email}</p>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500">
                      {donor.item_count} {donor.item_count === 1 ? "item" : "items"} · Cart total:
                      <span className="font-semibold text-gray-900"> ${donor.total_usd}</span>
                    </span>
                    <label className="flex items-center gap-1.5 text-xs font-medium text-gray-700">
                      <input
                        type="checkbox"
                        aria-label={`Select all sponsorships for ${donor.donor_email}`}
                        checked={allSelected}
                        onChange={(e) => selectDonorClaims(donorClaimIds, e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      All
                    </label>
                  </div>
                </div>

                <ul className="mt-2 space-y-1.5">
                  {donor.claims.map((claim) => (
                    <li key={claim.claim_id} className="flex items-center justify-between gap-2 text-sm">
                      <label className="flex min-w-0 items-center gap-2">
                        <input
                          type="checkbox"
                          aria-label={`Match sponsorship ${claim.claim_id} (family ${claim.family.display_id})`}
                          checked={selected.has(claim.claim_id)}
                          onChange={() => toggleClaim(claim.claim_id)}
                          className="h-4 w-4 shrink-0 rounded border-gray-300"
                        />
                        <span className="truncate">
                          Family {claim.family.display_id}
                          {claim.includes_groceries ? " + groceries" : ""}
                        </span>
                      </label>
                      <span className="shrink-0 text-xs font-medium text-gray-600">${claim.line_total_usd}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        {/* Expected-amount hint */}
        {selected.size > 0 && (
          <p className={`mt-3 text-sm ${exactMatch ? "text-emerald-700" : "text-amber-700"}`}>
            {exactMatch
              ? "Selected total matches the payment amount."
              : `Selected total (${formatAmount(selectedTotalCents)}) differs from the payment amount — use your judgment.`}
          </p>
        )}

        <div className="mt-4 flex gap-3">
          <Button
            className="flex-1"
            onClick={() => matchMut.mutate(Array.from(selected))}
            loading={matchMut.isPending}
            disabled={selected.size === 0}
          >
            {matchMut.isPending ? "Matching…" : "Confirm match"}
          </Button>
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
        </div>
        <MutationErrors mutations={[matchMut]} />
      </div>
    </div>
  );
}
