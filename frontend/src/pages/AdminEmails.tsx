/**
 * Admin — Sent Email Log
 *
 * Read-only paginated log of every email the app has sent (all kinds and
 * statuses). Filter by recipient search, kind, and status. No mutations —
 * a plain useQuery instead of useCrudManager.
 */

import { useQuery } from "@tanstack/react-query";
import type React from "react";
import { Fragment, useMemo, useState } from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ColumnToggle } from "../components/ColumnToggle";
import { DraggableTh } from "../components/DraggableTh";
import { HeaderBar } from "../components/HeaderBar";
import { Pagination } from "../components/Pagination";
import { PageSpinner } from "../components/Spinner";
import { Table, TableBody, TableHead, Td, Tr } from "../components/Table";
import { useColumnOrder } from "../hooks/useColumnOrder";
import { useColumnVisibility } from "../hooks/useColumnVisibility";
import { useDebouncedState } from "../hooks/useDebouncedState";
import { getPaginationInfo, usePagination } from "../hooks/usePagination";
import { useTableWidth } from "../hooks/useTableWidth";
import { adminListSentEmails } from "../lib/api";
import { adminSentEmails } from "../lib/queryKeys";
import { formatDateTime, formatEmailStatus } from "../lib/utils";
import type { AdminEmailsListParams, EmailKind, EmailStatus } from "../types";

/** kind → display label. Shared by the table cells and the filter dropdown. */
export const KIND_LABELS: Record<EmailKind, string> = {
  family_invite: "Family Invite",
  referrer_invite: "Referrer Invite",
  password_reset: "Password Reset",
  family_pending: "Family Pending Verification",
  family_verified: "Family Verified",
  family_rejected: "Family Rejected",
  referrer_approved: "Referrer Approved",
  referrer_rejected: "Referrer Rejected",
  claim_confirmation: "Sponsorship Confirmation",
  admin_failure_notice: "Admin Failure Notice",
};

const STATUS_OPTIONS: EmailStatus[] = ["sent", "failed", "reset"];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function AdminEmails() {
  const pagination = usePagination({ defaultPageSize: 50, pageSizeOptions: [20, 50, 100, 200] });

  const [searchQuery, setSearchQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<EmailKind | "">("");
  const [statusFilter, setStatusFilter] = useState<EmailStatus | "">("");

  // Column visibility + user column order
  const { visibleColumns, apiColumns } = useColumnVisibility("adminSentEmails");
  const { orderedKeys, reorder, moveBy, resetOrder, isDefaultOrder } = useColumnOrder("adminSentEmails", visibleColumns);
  const { widthClass } = useTableWidth("adminSentEmails");

  // Visible columns in the user's custom order (drives header + row render).
  const displayColumns = useMemo(() => orderedKeys.filter((k) => visibleColumns.includes(k)), [orderedKeys, visibleColumns]);

  const debouncedSearch = useDebouncedState(searchQuery, 1000, () => pagination.goToPage(1));

  const listParams = useMemo<AdminEmailsListParams>(
    () => ({
      ...pagination.params,
      columns: apiColumns,
      search: debouncedSearch || undefined,
      kind: kindFilter || undefined,
      status: statusFilter || undefined,
    }),
    [pagination.params, apiColumns, debouncedSearch, kindFilter, statusFilter]
  );

  const { data: listData, isLoading } = useQuery({
    queryKey: [...adminSentEmails, listParams],
    queryFn: () => adminListSentEmails(listParams),
    staleTime: 0, // read-only audit log — always refetch when viewed (global default is 5min)
  });

  const pageInfo = useMemo(
    () => getPaginationInfo(listData?.total ?? 0, pagination.page, pagination.pageSize),
    [listData?.total, pagination.page, pagination.pageSize]
  );

  const emails = listData?.emails ?? [];

  if (isLoading) return <PageSpinner />;

  // Header cells per column key.
  const emailHeaders: Record<string, React.ReactNode> = {
    recipient_email: "Recipient",
    kind: "Kind",
    status: "Status",
    sender_name: "Sender",
    sent_at: "Sent",
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar title="Kindness is Magic" />

      <main className={`mx-auto px-4 py-8 sm:px-6 ${widthClass}`}>
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-violet-950">Sent Emails</h2>
          <div className="flex items-center gap-3">
            {!isDefaultOrder && (
              <Button variant="secondary" onClick={resetOrder}>
                Reset order
              </Button>
            )}
            <ColumnToggle resourceKey="adminSentEmails" />
          </div>
        </div>

        {/* Info note */}
        <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 px-5 py-3 text-sm text-blue-800">
          Every email send attempt the app has made. “Reset” rows were cleared by an admin and no longer count toward invite limits.
        </div>

        {/* Filters */}
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="text"
            placeholder="Search by recipient email…"
            aria-label="Search by recipient email"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
            autoComplete="off"
          />
          <select
            aria-label="Kind filter"
            value={kindFilter}
            onChange={(e) => {
              setKindFilter(e.target.value as EmailKind | "");
              pagination.goToPage(1);
            }}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
          >
            <option value="">All kinds</option>
            {Object.entries(KIND_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            aria-label="Status filter"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as EmailStatus | "");
              pagination.goToPage(1);
            }}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {formatEmailStatus(s, null)}
              </option>
            ))}
          </select>
        </div>

        {/* Table */}
        {emails.length === 0 ? (
          <Card>
            <p className="py-8 text-center text-gray-400">No sent emails found.</p>
          </Card>
        ) : (
          <Table>
            <TableHead>
              {displayColumns.map((key) => (
                <DraggableTh key={key} unit={[key]} onReorder={reorder} onMoveBy={moveBy}>
                  {emailHeaders[key]}
                </DraggableTh>
              ))}
            </TableHead>
            <TableBody>
              {emails.map((email) => {
                const emailCells: Record<string, React.ReactNode> = {
                  recipient_email: <Td className="font-medium text-gray-900">{email.recipient_email}</Td>,
                  kind: <Td>{KIND_LABELS[email.kind]}</Td>,
                  status: <Td>{formatEmailStatus(email.status, email.failure_reason)}</Td>,
                  sender_name: <Td>{email.sender_name ?? <span className="text-gray-400">—</span>}</Td>,
                  sent_at: <Td className="whitespace-nowrap text-sm text-gray-500">{formatDateTime(email.sent_at)}</Td>,
                };
                return (
                  <Tr key={email.id}>
                    {displayColumns.map((key) => (
                      <Fragment key={key}>{emailCells[key]}</Fragment>
                    ))}
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
      </main>
    </div>
  );
}
