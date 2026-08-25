/**
 * Admin — Invite Codes Management
 *
 * List, filter, revoke invite codes. Generate new codes inline.
 * Uses useCrudManager for list query and revoke mutation.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ApprovalBadge } from "../components/ApprovalBadge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ColumnToggle } from "../components/ColumnToggle";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FormField } from "../components/FormField";
import { HeaderBar } from "../components/HeaderBar";
import { MutationErrors } from "../components/MutationErrors";
import { Pagination } from "../components/Pagination";
import { PageSpinner } from "../components/Spinner";
import { Table, TableBody, TableHead, Td, Th, Tr } from "../components/Table";
import { useToast } from "../context/ToastContext";
import { useColumnVisibility } from "../hooks/useColumnVisibility";
import { useCrudManager } from "../hooks/useCrudManager";
import { useDebouncedState } from "../hooks/useDebouncedState";
import { getPaginationInfo, usePagination } from "../hooks/usePagination";
import { useTableWidth } from "../hooks/useTableWidth";
import { adminListInvites, adminRevokeInvite, createReferrerInvite } from "../lib/api";
import { adminInvites } from "../lib/queryKeys";
import { formatApiError, formatDateTime } from "../lib/utils";
import type { InviteListParams, ReferrerInviteResponse } from "../types";

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function AdminInviteCodes() {
  const pagination = usePagination();
  const [searchParams] = useSearchParams();

  const [showRedeemed, setShowRedeemed] = useState<boolean | undefined>(undefined);
  const [showExpired, setShowExpired] = useState<boolean | undefined>(undefined);
  // ?generate=1 opens the generator (e.g. navigation from the referrers page)
  const [showGenerator, setShowGenerator] = useState(searchParams.get("generate") === "1");
  const generateParamOpen = searchParams.get("generate") === "1";

  useEffect(() => {
    // Covers the param appearing while the page is already mounted (same route,
    // search change only), where the useState initializer has already run.
    if (generateParamOpen) setShowGenerator(true);
  }, [generateParamOpen]);
  const [revokeConfirm, setRevokeConfirm] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Column visibility
  const { visibleColumns, apiColumns } = useColumnVisibility("adminInvites");
  const { widthClass } = useTableWidth("adminInvites");

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

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar title="Kindness is Magic" />

      <main className={`mx-auto px-4 py-8 sm:px-6 ${widthClass}`}>
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-violet-950">Invite Codes</h2>
          <div className="flex items-center gap-3">
            <ColumnToggle resourceKey="adminInvites" />
            <Button onClick={() => setShowGenerator(!showGenerator)}>{showGenerator ? "Hide Generator" : "+ Generate New"}</Button>
          </div>
        </div>

        {/* Info note */}
        <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 px-5 py-3 text-sm text-blue-800">
          Email-locked codes are auto-approved when redeemed. Unlocked codes require manual approval.
        </div>

        {/* Generate new code form */}
        {showGenerator && <InviteGenerator />}

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
              {visibleColumns.includes("code") && <Th>Code</Th>}
              {visibleColumns.includes("family_limit") && <Th>Family Limit</Th>}
              {visibleColumns.includes("locked_email") && <Th>Locked Email</Th>}
              {visibleColumns.includes("created_by_admin_name") && <Th>Created By</Th>}
              {visibleColumns.includes("created_at") && <Th>Created</Th>}
              {visibleColumns.includes("redeemed") && <Th>Redeemed</Th>}
              {visibleColumns.includes("referrer_approval_status") && <Th>Status</Th>}
              <Th>Actions</Th>
            </TableHead>
            <TableBody>
              {invites.map((invite) => (
                <Tr key={invite.id}>
                  {visibleColumns.includes("code") && <Td className="font-mono font-semibold">{invite.code}</Td>}
                  {visibleColumns.includes("family_limit") && <Td>{invite.family_limit}</Td>}
                  {visibleColumns.includes("locked_email") && <Td>{invite.locked_email ?? <span className="text-gray-400">—</span>}</Td>}
                  {visibleColumns.includes("created_by_admin_name") && (
                    <Td>{invite.created_by_admin_name ?? <span className="text-gray-400">—</span>}</Td>
                  )}
                  {visibleColumns.includes("created_at") && (
                    <Td className="whitespace-nowrap text-sm text-gray-500">{formatDateTime(invite.created_at)}</Td>
                  )}
                  {visibleColumns.includes("redeemed") && (
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
                  )}
                  {visibleColumns.includes("referrer_approval_status") && (
                    <Td>
                      {invite.redeemed && invite.referrer_approval_status ? (
                        <ApprovalBadge status={invite.referrer_approval_status} />
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </Td>
                  )}
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
              ))}
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

/* ------------------------------------------------------------------ */
/* InviteGenerator — inline form for creating new invite codes         */
/* ------------------------------------------------------------------ */
function InviteGenerator() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [familyLimit, setFamilyLimit] = useState("");
  const [email, setEmail] = useState("");
  const [invite, setInvite] = useState<ReferrerInviteResponse | null>(null);

  const createMut = useMutation({
    mutationFn: (data: { family_limit: number; email: string | null }) => createReferrerInvite(data),
    onSuccess: (data) => {
      setInvite(data);
      queryClient.invalidateQueries({ queryKey: adminInvites });
      if (data.email_error) {
        toast.info(data.email_error);
      }
    },
    onError: (err: unknown) => {
      toast.error(formatApiError(err, "Failed to create invite."));
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setInvite(null);

    const limit = parseInt(familyLimit, 10);
    if (Number.isNaN(limit) || limit < 1 || limit > 999) {
      toast.error("Family limit must be between 1 and 999.");
      return;
    }

    createMut.mutate({
      family_limit: limit,
      email: email.trim() || null,
    });
  };

  return (
    <Card className="mb-6 border border-gray-200">
      <h3 className="mb-3 text-base font-semibold text-gray-900">Generate Invite Code</h3>
      <p className="mb-4 text-sm text-gray-500">
        Create a one-time invite code that allows someone to self-register as a referrer. The code expires after 24 hours.
      </p>

      {/* Success display */}
      {invite && (
        <div className="mb-4 rounded-lg border-2 border-green-200 bg-green-50/50 p-4">
          <p className="mb-2 text-sm font-medium text-green-800">Invite Code Generated</p>
          <div className="mb-2 text-2xl font-mono font-bold tracking-wider text-brand-dark">{invite.code}</div>
          <div className="flex gap-4 text-sm text-green-700">
            <span>Family limit: {invite.family_limit}</span>
            <span>Expires: {formatDateTime(invite.expires_at)}</span>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <FormField
          label="Family Limit"
          type="number"
          fieldProps={{
            value: familyLimit,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setFamilyLimit(e.target.value),
            required: true,
            min: 1,
            max: 999,
            placeholder: "e.g. 10",
            autoComplete: "off",
          }}
        />
        <FormField
          label="Email (optional)"
          type="email"
          fieldProps={{
            value: email,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value),
            placeholder: "referrer@example.com",
            autoComplete: "off",
          }}
        />
        <Button type="submit" loading={createMut.isPending} className="sm:ml-auto">
          {createMut.isPending ? "Generating\u2026" : "Generate"}
        </Button>
      </form>
      <p className="mt-3 text-xs text-gray-400">Including an email locks this invite to that address</p>
    </Card>
  );
}
