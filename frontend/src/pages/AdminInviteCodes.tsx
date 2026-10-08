/**
 * Admin — Invite Codes Management
 *
 * List, filter, revoke invite codes. New codes are generated from the
 * Referrers page (InviteGenerator).
 * Uses useCrudManager for list query and revoke mutation.
 */

import { Fragment, useMemo, useState } from "react";
import { ApprovalBadge } from "../components/ApprovalBadge";
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
import { useColumnOrder } from "../hooks/useColumnOrder";
import { useColumnVisibility } from "../hooks/useColumnVisibility";
import { useCrudManager } from "../hooks/useCrudManager";
import { useDebouncedState } from "../hooks/useDebouncedState";
import { getPaginationInfo, usePagination } from "../hooks/usePagination";
import { useTableWidth } from "../hooks/useTableWidth";
import { adminListInvites, adminRevokeInvite } from "../lib/api";
import { adminInvites } from "../lib/queryKeys";
import { formatDateTime } from "../lib/utils";
import type { InviteListParams } from "../types";

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function AdminInviteCodes() {
  const pagination = usePagination();

  const [showRedeemed, setShowRedeemed] = useState<boolean | undefined>(undefined);
  const [showExpired, setShowExpired] = useState<boolean | undefined>(undefined);
  const [revokeConfirm, setRevokeConfirm] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Column visibility + user column order
  const { visibleColumns, apiColumns } = useColumnVisibility("adminInvites");
  const { orderedKeys, reorder, moveBy, resetOrder, isDefaultOrder } = useColumnOrder("adminInvites", visibleColumns);
  const { widthClass } = useTableWidth("adminInvites");

  // Visible columns in the user's custom order (drives header + row render).
  const displayColumns = useMemo(() => orderedKeys.filter((k) => visibleColumns.includes(k)), [orderedKeys, visibleColumns]);

  const debouncedSearch = useDebouncedState(searchQuery, 1000, () => pagination.goToPage(1));

  const listParams = useMemo<InviteListParams>(
    () => ({
      ...pagination.params,
      columns: apiColumns,
      redeemed: showRedeemed ?? undefined,
      expired: showExpired ?? undefined,
      search: debouncedSearch || undefined,
    }),
    [pagination.params, apiColumns, showRedeemed, showExpired, debouncedSearch]
  );

  // useCrudManager for list + revoke
  const {
    listData,
    listLoading,
    deleteMut: revokeMut,
  } = useCrudManager({
    rootKey: adminInvites,
    listFn: adminListInvites,
    listParams,
    deleteFn: (id: number) => adminRevokeInvite(id).then(() => undefined),
    invalidationKeys: [adminInvites],
    entityName: "Invite code",
  });

  const pageInfo = useMemo(
    () => getPaginationInfo(listData?.total ?? 0, pagination.page, pagination.pageSize),
    [listData?.total, pagination.page, pagination.pageSize]
  );

  const invites = listData?.invites ?? [];

  if (listLoading) return <PageSpinner />;

  // Header cells per column key.
  const inviteHeaders: Record<string, React.ReactNode> = {
    code: "Code",
    family_limit: "Family Limit",
    locked_email: "Locked Email",
    created_by_admin_name: "Created By",
    created_at: "Created",
    redeemed: "Redeemed",
    referrer_approval_status: "Status",
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar title="Kindness is Magic" />

      <main className={`mx-auto px-4 py-8 sm:px-6 ${widthClass}`}>
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-violet-950">Invite Codes</h2>
          <div className="flex items-center gap-3">
            {!isDefaultOrder && (
              <Button variant="secondary" onClick={resetOrder}>
                Reset order
              </Button>
            )}
            <ColumnToggle resourceKey="adminInvites" />
          </div>
        </div>

        {/* Info note */}
        <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 px-5 py-3 text-sm text-blue-800">
          Email-locked codes are auto-approved when redeemed. Unlocked codes require manual approval.
        </div>

        {/* Filters */}
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="text"
            placeholder="Search by code or email…"
            aria-label="Search by code or email"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
            autoComplete="off"
          />
          <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={showRedeemed === true}
                onChange={(e) => setShowRedeemed(e.target.checked ? true : undefined)}
                className="h-4 w-4 rounded border-gray-300 text-violet-600 focus:ring-violet-500"
              />
              Redeemed only
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={showRedeemed === false}
                onChange={(e) => setShowRedeemed(e.target.checked ? false : undefined)}
                className="h-4 w-4 rounded border-gray-300 text-violet-600 focus:ring-violet-500"
              />
              Unredeemed only
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={showExpired === true}
                onChange={(e) => setShowExpired(e.target.checked ? true : undefined)}
                className="h-4 w-4 rounded border-gray-300 text-violet-600 focus:ring-violet-500"
              />
              Expired only
            </label>
          </div>
        </div>

        {/* Table */}
        {invites.length === 0 ? (
          <Card>
            <p className="py-8 text-center text-gray-400">No invite codes found.</p>
          </Card>
        ) : (
          <Table>
            <TableHead>
              {displayColumns.map((key) => (
                <DraggableTh key={key} unit={[key]} onReorder={reorder} onMoveBy={moveBy}>
                  {inviteHeaders[key]}
                </DraggableTh>
              ))}
              <Th>Actions</Th>
            </TableHead>
            <TableBody>
              {invites.map((invite) => {
                const inviteCells: Record<string, React.ReactNode> = {
                  code: <Td className="font-mono font-semibold">{invite.code}</Td>,
                  family_limit: <Td>{invite.family_limit}</Td>,
                  locked_email: <Td>{invite.locked_email ?? <span className="text-gray-400">—</span>}</Td>,
                  created_by_admin_name: <Td>{invite.created_by_admin_name ?? <span className="text-gray-400">—</span>}</Td>,
                  created_at: <Td className="whitespace-nowrap text-sm text-gray-500">{formatDateTime(invite.created_at)}</Td>,
                  redeemed: (
                    <Td>
                      {invite.redeemed ? (
                        <span className="text-sm text-gray-600">
                          Yes
                          {invite.redeemed_by_referrer_name && (
                            <span className="ml-1 text-gray-400">({invite.redeemed_by_referrer_name})</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-sm text-gray-400">No</span>
                      )}
                    </Td>
                  ),
                  referrer_approval_status: (
                    <Td>
                      {invite.redeemed && invite.referrer_approval_status ? (
                        <ApprovalBadge status={invite.referrer_approval_status} />
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </Td>
                  ),
                };
                return (
                  <Tr key={invite.id}>
                    {displayColumns.map((key) => (
                      <Fragment key={key}>{inviteCells[key]}</Fragment>
                    ))}
                    <Td>
                      {!invite.redeemed && (
                        <Button
                          variant="danger"
                          size="sm"
                          className="px-3 py-1.5 text-xs"
                          onClick={() => setRevokeConfirm(invite.id)}
                          disabled={revokeMut.isPending}
                        >
                          Revoke
                        </Button>
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

        {/* Revoke confirmation */}
        <ConfirmDialog
          open={revokeConfirm !== null}
          title={<>Revoke this invite code?</>}
          description="The code will expire immediately and can no longer be used."
          onConfirm={() => {
            if (revokeConfirm != null) {
              revokeMut.mutate(revokeConfirm);
              setRevokeConfirm(null);
            }
          }}
          onCancel={() => setRevokeConfirm(null)}
          loading={revokeMut.isPending}
          confirmLabel="Yes, revoke"
          loadingLabel="Revoking…"
          confirmVariant="danger"
        />

        {/* Errors */}
        <MutationErrors mutations={[revokeMut]} />
      </main>
    </div>
  );
}
