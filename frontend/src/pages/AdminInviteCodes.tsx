/**
 * Admin — Invite Codes Management
 *
 * List, filter, revoke invite codes. Generate new codes inline.
 * Replaces the standalone /admin/invite-referrer page.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ApprovalBadge } from "../components/ApprovalBadge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ErrorBox } from "../components/ErrorBox";
import { FormField } from "../components/FormField";
import { BackLink, HeaderBar } from "../components/HeaderBar";
import { MutationErrors } from "../components/MutationErrors";
import { Pagination } from "../components/Pagination";
import { PageSpinner } from "../components/Spinner";
import { Table, TableBody, TableHead, Td, Th, Tr } from "../components/Table";
import { usePagination } from "../hooks/usePagination";
import { adminListInvites, adminRevokeInvite, createReferrerInvite, type InviteListParams } from "../lib/api";
import { formatApiError } from "../lib/utils";
import type { ReferrerInviteResponse } from "../types";

const INVITES_KEY = ["adminInvites"];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function AdminInviteCodes() {
  const queryClient = useQueryClient();
  const pagination = usePagination();

  const [showRedeemed, setShowRedeemed] = useState<boolean | undefined>(undefined);
  const [showExpired, setShowExpired] = useState<boolean | undefined>(undefined);
  const [showGenerator, setShowGenerator] = useState(false);
  const [revokeConfirm, setRevokeConfirm] = useState<number | null>(null);

  const listParams = useMemo<InviteListParams>(
    () => ({
      ...pagination.params,
      redeemed: showRedeemed ?? undefined,
      expired: showExpired ?? undefined,
    }),
    [pagination.params, showRedeemed, showExpired]
  );

  const { data: listData, isLoading } = useQuery({
    queryKey: [...INVITES_KEY, listParams],
    queryFn: () => adminListInvites(listParams),
  });

  const revokeMut = useMutation({
    mutationFn: adminRevokeInvite,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INVITES_KEY });
    },
  });

  const totalPages = listData ? Math.ceil(listData.total / pagination.pageSize) || 0 : 0;
  const invites = listData?.invites ?? [];

  if (isLoading) return <PageSpinner />;

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar title="Kindness is Magic" left={<BackLink />} />

      <main className="mx-auto max-w-[1100px] px-4 py-8 sm:px-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-violet-950">Invite Codes</h2>
          <Button onClick={() => setShowGenerator(!showGenerator)}>{showGenerator ? "Hide Generator" : "+ Generate New"}</Button>
        </div>

        {/* Info note */}
        <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 px-5 py-3 text-sm text-blue-800">
          Email-locked codes are auto-approved when redeemed. Unlocked codes require manual approval.
        </div>

        {/* Generate new code form */}
        {showGenerator && <InviteGenerator />}

        {/* Filters */}
        <div className="mb-4 flex flex-wrap items-center gap-4 text-sm text-gray-600">
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

        {/* Table */}
        {invites.length === 0 ? (
          <Card>
            <p className="py-8 text-center text-gray-400">No invite codes found.</p>
          </Card>
        ) : (
          <Table>
            <TableHead>
              <Th>Code</Th>
              <Th>Family Limit</Th>
              <Th>Locked Email</Th>
              <Th>Created By</Th>
              <Th>Created</Th>
              <Th>Redeemed</Th>
              <Th>Status</Th>
              <Th>Actions</Th>
            </TableHead>
            <TableBody>
              {invites.map((invite) => (
                <Tr key={invite.id}>
                  <Td className="font-mono font-semibold">{invite.code}</Td>
                  <Td>{invite.family_limit}</Td>
                  <Td>{invite.locked_email ?? <span className="text-gray-400">—</span>}</Td>
                  <Td>{invite.created_by_admin_name ?? <span className="text-gray-400">—</span>}</Td>
                  <Td className="whitespace-nowrap text-sm text-gray-500">{formatDateTime(invite.created_at)}</Td>
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
                  <Td>
                    {invite.redeemed && invite.referrer_approval_status ? (
                      <ApprovalBadge status={invite.referrer_approval_status} />
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </Td>
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
          totalPages={totalPages}
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
  const [familyLimit, setFamilyLimit] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [invite, setInvite] = useState<ReferrerInviteResponse | null>(null);

  const createMut = useMutation({
    mutationFn: (data: { family_limit: number; email: string | null }) => createReferrerInvite(data),
    onSuccess: (data) => {
      setInvite(data);
      queryClient.invalidateQueries({ queryKey: INVITES_KEY });
    },
    onError: (err: unknown) => {
      setError(formatApiError(err, "Failed to create invite."));
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setInvite(null);

    const limit = parseInt(familyLimit, 10);
    if (Number.isNaN(limit) || limit < 1 || limit > 999) {
      setError("Family limit must be between 1 and 999.");
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

      {error && <ErrorBox message={error} className="mb-4" />}

      {/* Success display */}
      {invite && (
        <div className="mb-4 rounded-lg border-2 border-green-200 bg-green-50/50 p-4">
          <p className="mb-2 text-sm font-medium text-green-800">Invite Code Generated</p>
          <div className="mb-2 text-2xl font-mono font-bold tracking-wider text-brand-dark">{invite.code}</div>
          <div className="flex gap-4 text-sm text-green-700">
            <span>Family limit: {invite.family_limit}</span>
            <span>Expires: {formatDateTime(invite.expires_at)}</span>
          </div>
          {invite.email_sent !== null && (
            <p className={`mt-2 text-sm ${invite.email_sent ? "text-green-700" : "text-yellow-700"}`}>
              {invite.email_sent ? "Email sent successfully." : `Email not sent: ${invite.email_send_reason ?? "unknown"}`}
            </p>
          )}
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
        <div>
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
          <p className="mt-1 text-xs text-gray-400">Including an email locks this invite to that address</p>
        </div>
        <Button type="submit" loading={createMut.isPending} className="sm:ml-auto">
          {createMut.isPending ? "Generating…" : "Generate"}
        </Button>
      </form>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
