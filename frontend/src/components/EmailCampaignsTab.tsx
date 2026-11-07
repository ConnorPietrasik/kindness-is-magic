/**
 * EmailCampaignsTab — the "Campaigns" tab of the admin Emails page
 *
 * List of every campaign with live delivery progress (the list refetches on
 * an interval while any campaign is still delivering), a "New email
 * campaign" dialog, and a per-campaign detail view with the paginated
 * recipient audit + cancel.
 *
 * Delivery is paced by the background worker (one recipient per cycle), so
 * a freshly created campaign ticks forward over time — hence the periodic
 * refetch while work remains.
 *
 * Rendered by AdminEmails (the page owns the shell and the tabs); the tab
 * is max-width 4xl via the page wrapper, so there is no page chrome here.
 * The detail view is an in-tab sub-view (not a separate route).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useDebouncedState } from "../hooks/useDebouncedState";
import { getPaginationInfo, usePagination } from "../hooks/usePagination";
import { adminCancelEmailCampaign, adminGetEmailCampaign, adminListEmailCampaigns } from "../lib/api";
import { adminEmailCampaign, adminEmailCampaigns } from "../lib/queryKeys";
import { formatDateTime } from "../lib/utils";
import type { EmailCampaignRecipientSummary, EmailCampaignStatus } from "../types";
import { AdminCampaignDialog } from "./AdminCampaignDialog";
import { Button } from "./Button";
import { Card } from "./Card";
import { MutationErrors } from "./MutationErrors";
import { Pagination } from "./Pagination";
import { PageSpinner } from "./Spinner";
import { Table, TableBody, TableHead, Td, Tr } from "./Table";

/** status → badge (label + pill classes). "Sending" rows tick over time. */
const STATUS_BADGES = {
  pending: { label: "Queued", className: "bg-gray-100 text-gray-600" },
  sending: { label: "Sending", className: "bg-blue-100 text-blue-700" },
  completed: { label: "Completed", className: "bg-green-100 text-green-700" },
  canceled: { label: "Canceled", className: "bg-gray-100 text-gray-400" },
} as const satisfies Record<EmailCampaignStatus, { label: string; className: string }>;

/** recipient status → inline cell (failure reason shown inline). */
function RecipientStatusCell({ recipient }: { recipient: EmailCampaignRecipientSummary }) {
  switch (recipient.status) {
    case "sent":
      return <span className="text-green-700">Sent</span>;
    case "failed":
      return <span className="text-red-600">Failed{recipient.failure_reason ? ` — ${recipient.failure_reason}` : ""}</span>;
    case "canceled":
      return <span className="text-gray-400">Canceled</span>;
    default:
      return <span className="text-gray-500">Pending</span>;
  }
}

/** Small sent/failed progress bar with a count label. */
function CampaignProgress({ sent, failed, total }: { sent: number; failed: number; total: number }) {
  const done = sent + failed;
  const pct = total === 0 ? 0 : Math.min(100, Math.round((done / total) * 100));
  return (
    <div className="min-w-[140px]">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
        <div className="h-full rounded-full bg-btn-start transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-xs text-gray-500">
        {done}/{total} sent
        {failed > 0 ? ` · ${failed} failed` : ""}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Detail view (recipient audit + cancel) — an in-tab sub-view         */
/* ------------------------------------------------------------------ */

function CampaignDetail({ campaignId, onBack }: { campaignId: number; onBack: () => void }) {
  const queryClient = useQueryClient();
  const pagination = usePagination({ defaultPageSize: 50, pageSizeOptions: [20, 50, 100, 200] });
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearch = useDebouncedState(searchQuery, 1000, () => pagination.goToPage(1));

  const { data, isLoading } = useQuery({
    queryKey: [...adminEmailCampaign(campaignId), pagination.params, debouncedSearch || undefined],
    queryFn: () => adminGetEmailCampaign(campaignId, { ...pagination.params, search: debouncedSearch || undefined }),
    staleTime: 0, // progress ticks forward while delivering — always refetch when viewed
    // Live progress: poll while this campaign is still delivering.
    refetchInterval: (query) => {
      const status = query.state.data?.campaign.status;
      return status === "pending" || status === "sending" ? 5000 : false;
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => adminCancelEmailCampaign(campaignId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminEmailCampaigns });
    },
  });

  if (isLoading) return <PageSpinner />;
  if (!data) return null;

  const { campaign } = data;
  const badge = STATUS_BADGES[campaign.status];
  const isActive = campaign.status === "pending" || campaign.status === "sending";

  const pageInfo = getPaginationInfo(data.total, pagination.page, pagination.pageSize);

  return (
    <>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={onBack}>
            ← Back
          </Button>
          <h2 className="text-xl font-bold text-violet-950">{campaign.subject}</h2>
          <span data-testid="campaign-status-badge" className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.className}`}>
            {badge.label}
          </span>
        </div>
        {isActive && (
          <Button variant="danger" onClick={() => cancelMutation.mutate()} loading={cancelMutation.isPending}>
            Cancel campaign
          </Button>
        )}
      </div>

      {/* Campaign meta + message body */}
      <Card className="mb-6">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-gray-400">Roles</dt>
            <dd className="font-medium text-gray-800">{campaign.roles.length > 0 ? campaign.roles.join(", ") : "—"}</dd>
          </div>
          <div>
            <dt className="text-gray-400">Recipients</dt>
            <dd className="font-medium text-gray-800">
              {campaign.sent_count}/{campaign.total_recipients} sent
              {campaign.failed_count > 0 ? ` · ${campaign.failed_count} failed` : ""}
              {campaign.canceled_count > 0 ? ` · ${campaign.canceled_count} canceled` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-gray-400">Created</dt>
            <dd className="font-medium text-gray-800">{formatDateTime(campaign.created_at)}</dd>
          </div>
          <div>
            <dt className="text-gray-400">Sender</dt>
            <dd className="font-medium text-gray-800">{campaign.sender_name ?? "—"}</dd>
          </div>
        </dl>
        <div className="mt-4 border-t border-gray-100 pt-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-400">Message</div>
          <div className="whitespace-pre-wrap text-sm text-gray-800">{campaign.message}</div>
        </div>
      </Card>

      {/* Recipient audit */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-700">Recipients</h3>
        <input
          type="text"
          placeholder="Search by email…"
          aria-label="Search recipients by email"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-64 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
          autoComplete="off"
        />
      </div>
      <Table>
        <TableHead>
          <th>Email</th>
          <th>Name</th>
          <th>Source</th>
          <th>Status</th>
          <th>Sent</th>
        </TableHead>
        <TableBody>
          {data.recipients.length === 0 ? (
            <Tr>
              <Td className="py-8 text-center text-gray-400" colSpan={5}>
                No recipients match.
              </Td>
            </Tr>
          ) : (
            data.recipients.map((recipient) => (
              <Tr key={recipient.id}>
                <Td className="font-medium text-gray-900">{recipient.email}</Td>
                <Td>{recipient.user_display_name ?? <span className="text-gray-400">—</span>}</Td>
                <Td className="capitalize">{recipient.source}</Td>
                <Td>
                  <RecipientStatusCell recipient={recipient} />
                </Td>
                <Td className="whitespace-nowrap text-sm text-gray-500">{formatDateTime(recipient.sent_at)}</Td>
              </Tr>
            ))
          )}
        </TableBody>
      </Table>
      <Pagination
        page={pagination.page}
        totalPages={pageInfo.totalPages}
        total={data.total}
        pageSize={pagination.pageSize}
        onPageChange={pagination.goToPage}
        onPageSizeChange={pagination.setPageSize}
      />

      {/* Errors */}
      <MutationErrors mutations={[cancelMutation]} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Tab (list view + create dialog)                                     */
/* ------------------------------------------------------------------ */

export function EmailCampaignsTab() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Refetch while any campaign is still delivering so the progress ticks
  // forward; idle once everything is terminal.
  const { data, isLoading } = useQuery({
    queryKey: adminEmailCampaigns,
    queryFn: adminListEmailCampaigns,
    refetchInterval: (query) => {
      const campaigns = query.state.data?.campaigns ?? [];
      return campaigns.some((c) => c.status === "pending" || c.status === "sending") ? 5000 : false;
    },
  });

  if (selectedId !== null) {
    return <CampaignDetail campaignId={selectedId} onBack={() => setSelectedId(null)} />;
  }

  if (isLoading) return <PageSpinner />;

  const campaigns = data?.campaigns ?? [];

  return (
    <>
      {/* Create action (Compose lives in the page header, for all tabs) */}
      <div className="mb-4 flex items-center justify-end">
        <Button onClick={() => setDialogOpen(true)}>+ New campaign</Button>
      </div>

      {/* Info note */}
      <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 px-5 py-3 text-sm text-blue-800">
        A campaign emails every account in the selected roles (plus any extra addresses you add), delivered slowly over time so it doesn't
        look like spam. Cancel any time — un-sent recipients are skipped.
      </div>

      {/* Table */}
      {campaigns.length === 0 ? (
        <Card>
          <p className="py-8 text-center text-gray-400">No email campaigns yet. Create one to send a batch email to selected roles.</p>
        </Card>
      ) : (
        <Table>
          <TableHead>
            <th>Subject</th>
            <th>Roles</th>
            <th>Progress</th>
            <th>Status</th>
            <th>Created</th>
          </TableHead>
          <TableBody>
            {campaigns.map((campaign) => {
              const badge = STATUS_BADGES[campaign.status];
              return (
                <Tr key={campaign.id} className="cursor-pointer" onClick={() => setSelectedId(campaign.id)}>
                  <Td className="max-w-[220px]">
                    {/* Text button (not just a row click) so the detail is reachable by keyboard */}
                    <button
                      type="button"
                      onClick={() => setSelectedId(campaign.id)}
                      className="block w-full truncate text-left font-medium text-gray-900 hover:underline"
                    >
                      {campaign.subject}
                    </button>
                  </Td>
                  <Td className="text-gray-600">{campaign.roles.length > 0 ? campaign.roles.join(", ") : "manual only"}</Td>
                  <Td>
                    <CampaignProgress sent={campaign.sent_count} failed={campaign.failed_count} total={campaign.total_recipients} />
                  </Td>
                  <Td>
                    <span
                      data-testid="campaign-status-badge"
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                  </Td>
                  <Td className="whitespace-nowrap text-sm text-gray-500">{formatDateTime(campaign.created_at)}</Td>
                </Tr>
              );
            })}
          </TableBody>
        </Table>
      )}

      <AdminCampaignDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </>
  );
}
