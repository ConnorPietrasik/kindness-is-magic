/**
 * EmailCampaignsTab — the "Campaigns" tab of the admin Emails page
 *
 * List of every campaign (drafts, scheduled, delivering, terminal) with
 * live delivery progress (the list refetches on an interval while any
 * campaign is still delivering or waiting for its send time), a "New email
 * campaign" dialog, and a per-campaign detail view with the paginated
 * recipient audit + cancel. Drafts can be edited, sent, or deleted from
 * the detail; a scheduled campaign can be sent now (the stored time is
 * cleared).
 *
 * Delivery is paced by the background worker (one recipient per cycle), so
 * a freshly created campaign ticks forward over time — hence the periodic
 * refetch while work remains.
 *
 * Rendered by AdminEmails (the page owns the shell, the tabs, and the
 * per-tab table width); the list's columns are registry-driven (toggle +
 * drag-reorder via the gear, like the other admin tables).
 * The detail view is an in-tab sub-view (not a separate route).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type React from "react";
import { Fragment, useMemo, useState } from "react";
import { useColumnOrder } from "../hooks/useColumnOrder";
import { useColumnVisibility } from "../hooks/useColumnVisibility";
import { useDebouncedState } from "../hooks/useDebouncedState";
import { getPaginationInfo, usePagination } from "../hooks/usePagination";
import {
  adminCancelEmailCampaign,
  adminDeleteEmailCampaign,
  adminGetEmailCampaign,
  adminListEmailCampaigns,
  adminPreviewEmailCampaign,
  adminSendEmailCampaign,
  adminUpdateEmailCampaign,
} from "../lib/api";
import { adminEmailCampaign, adminEmailCampaignPreview, adminEmailCampaigns } from "../lib/queryKeys";
import { formatDateTime } from "../lib/utils";
import type { EmailCampaignRecipientSummary, EmailCampaignStatus, EmailCampaignSummary, RecipientSegment } from "../types";
import { AdminCampaignDialog, SEGMENT_OPTIONS } from "./AdminCampaignDialog";
import { Button } from "./Button";
import { Card } from "./Card";
import { ColumnToggle } from "./ColumnToggle";
import { ConfirmDialog } from "./ConfirmDialog";
import { DraggableTh } from "./DraggableTh";
import { MutationErrors } from "./MutationErrors";
import { Pagination } from "./Pagination";
import { PageSpinner } from "./Spinner";
import { Table, TableBody, TableHead, Td, Tr } from "./Table";

/** status → badge (label + pill classes). "Sending" rows tick over time. */
const STATUS_BADGES = {
  draft: { label: "Draft", className: "bg-amber-100 text-amber-700" },
  pending: { label: "Queued", className: "bg-gray-100 text-gray-600" },
  sending: { label: "Sending", className: "bg-blue-100 text-blue-700" },
  completed: { label: "Completed", className: "bg-green-100 text-green-700" },
  canceled: { label: "Canceled", className: "bg-gray-100 text-gray-400" },
} as const satisfies Record<EmailCampaignStatus, { label: string; className: string }>;

/** The "Scheduled" state is a queued campaign with a stored send time. */
function statusBadge(campaign: EmailCampaignSummary): { label: string; className: string } {
  if (campaign.status === "pending" && campaign.scheduled_for) {
    return { label: "Scheduled", className: "bg-violet-100 text-violet-700" };
  }
  return STATUS_BADGES[campaign.status];
}

/** List header cell per column key (registry-driven render). */
const CAMPAIGN_HEADERS: Record<string, React.ReactNode> = {
  subject: "Subject",
  roles: "Roles",
  state_groups: "State groups",
  progress: "Progress",
  status: "Status",
  scheduled_for: "Scheduled",
  created_at: "Created",
};

/** Stored segment values → the shared full labels (", " -joined) — detail
 * view, where the sentences have room. */
function segmentLabels(segments: RecipientSegment[]): string {
  return segments.map((s) => SEGMENT_OPTIONS.find((o) => o.value === s)?.label ?? s).join(", ");
}

/** Table cell: compact labels, full label on hover (", " -joined). */
function segmentShortLabels(segments: RecipientSegment[]): React.ReactNode {
  return segments.map((s, i) => {
    const opt = SEGMENT_OPTIONS.find((o) => o.value === s);
    return (
      <span key={s}>
        {i > 0 ? ", " : null}
        <span title={opt?.label ?? s}>{opt?.shortLabel ?? s}</span>
      </span>
    );
  });
}

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
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const debouncedSearch = useDebouncedState(searchQuery, 1000, () => pagination.goToPage(1));

  const { data, isLoading } = useQuery({
    queryKey: [...adminEmailCampaign(campaignId), pagination.params, debouncedSearch || undefined],
    queryFn: () => adminGetEmailCampaign(campaignId, { ...pagination.params, search: debouncedSearch || undefined }),
    staleTime: 0, // progress ticks forward while delivering — always refetch when viewed
    // Live progress: poll while this campaign is still delivering (or
    // waiting for its send time — both are "pending").
    refetchInterval: (query) => {
      const status = query.state.data?.campaign.status;
      return status === "pending" || status === "sending" ? 5000 : false;
    },
  });

  // Drafts and unresolved scheduled campaigns have no recipient rows yet
  // — show the live blast size with the same read-only preview the compose
  // dialog uses, keyed on the stored selection. Whenever resolution is
  // still ahead it is an estimate: the snapshot freezes when the campaign
  // sends.
  const { data: selectionPreview } = useQuery({
    queryKey: adminEmailCampaignPreview({
      roles: data?.campaign.roles ?? [],
      segments: data?.campaign.segments ?? [],
      extra_emails: data?.campaign.extra_emails ?? [],
    }),
    queryFn: () =>
      adminPreviewEmailCampaign({
        roles: data!.campaign.roles,
        segments: data!.campaign.segments,
        extra_emails: data!.campaign.extra_emails,
      }),
    enabled: data?.campaign.status === "draft" || (data?.campaign.status === "pending" && data.campaign.total_recipients === 0),
  });

  const cancelMutation = useMutation({
    mutationFn: () => adminCancelEmailCampaign(campaignId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminEmailCampaigns });
    },
  });

  // Draft: activate — the recipient snapshot is frozen at this moment.
  const sendNowMutation = useMutation({
    mutationFn: () => adminSendEmailCampaign(campaignId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminEmailCampaigns });
    },
  });

  // Scheduled: clear the stored time — the worker sends ASAP.
  const clearScheduleMutation = useMutation({
    mutationFn: () => adminUpdateEmailCampaign(campaignId, { scheduled_for: "" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminEmailCampaigns });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => adminDeleteEmailCampaign(campaignId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminEmailCampaigns });
      onBack();
    },
  });

  if (isLoading) return <PageSpinner />;
  if (!data) return null;

  const { campaign } = data;
  const badge = statusBadge(campaign);
  const isDraft = campaign.status === "draft";
  const isScheduled = campaign.status === "pending" && campaign.scheduled_for !== null;
  // A scheduled campaign that the worker hasn't reached yet: no recipient
  // rows — the selection is resolved when it becomes due.
  const isUnresolved = campaign.status === "pending" && campaign.total_recipients === 0;
  const isActive = campaign.status === "pending" || campaign.status === "sending";
  // Same editability rule as the backend: nothing settled, not terminal.
  const isEditable =
    campaign.status === "draft" || (campaign.status === "pending" && campaign.sent_count === 0 && campaign.failed_count === 0);

  const pageInfo = getPaginationInfo(data.total, pagination.page, pagination.pageSize);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={onBack}>
            ← Back
          </Button>
          <h2 className="text-xl font-bold text-violet-950">{campaign.subject}</h2>
          <span data-testid="campaign-status-badge" className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.className}`}>
            {badge.label}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isEditable && (
            <Button variant="secondary" onClick={() => setEditOpen(true)}>
              Edit
            </Button>
          )}
          {isDraft && (
            <Button onClick={() => sendNowMutation.mutate()} loading={sendNowMutation.isPending}>
              Send now
            </Button>
          )}
          {isScheduled && (
            <Button onClick={() => clearScheduleMutation.mutate()} loading={clearScheduleMutation.isPending}>
              Send now
            </Button>
          )}
          {isActive && (
            <Button variant="danger" onClick={() => cancelMutation.mutate()} loading={cancelMutation.isPending}>
              Cancel campaign
            </Button>
          )}
          {isDraft && (
            <Button variant="danger" onClick={() => setDeleteOpen(true)} loading={deleteMutation.isPending}>
              Delete
            </Button>
          )}
        </div>
      </div>

      {/* Campaign meta + message body */}
      <Card className="mb-6">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-gray-400">Roles</dt>
            <dd className="font-medium text-gray-800">{campaign.roles.length > 0 ? campaign.roles.join(", ") : "—"}</dd>
          </div>
          <div>
            <dt className="text-gray-400">State groups</dt>
            <dd className="font-medium text-gray-800">{campaign.segments.length > 0 ? segmentLabels(campaign.segments) : "—"}</dd>
          </div>
          <div>
            <dt className="text-gray-400">Recipients</dt>
            <dd className="font-medium text-gray-800">
              {isDraft || isUnresolved ? (
                selectionPreview ? (
                  isDraft ? (
                    <>Will send to {selectionPreview.total}</>
                  ) : (
                    <>~{selectionPreview.total} today — finalized when it sends</>
                  )
                ) : (
                  "Counting…"
                )
              ) : (
                <>
                  {campaign.sent_count}/{campaign.total_recipients} sent
                  {campaign.failed_count > 0 ? ` · ${campaign.failed_count} failed` : ""}
                  {campaign.canceled_count > 0 ? ` · ${campaign.canceled_count} canceled` : ""}
                </>
              )}
            </dd>
          </div>
          {isScheduled && (
            <div>
              <dt className="text-gray-400">Scheduled for</dt>
              <dd className="font-medium text-gray-800">{formatDateTime(campaign.scheduled_for)}</dd>
            </div>
          )}
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

      {isDraft ? (
        <Card className="mb-6">
          <p className="py-4 text-sm text-gray-500">
            Recipients are finalized when the campaign is sent — the exact list of people is frozen at that moment. Use{" "}
            <strong>Send now</strong> to queue delivery, or <strong>Edit</strong> the draft first. While it is a draft it can also be
            deleted.
          </p>
        </Card>
      ) : isUnresolved ? (
        <Card className="mb-6">
          <p className="py-4 text-sm text-gray-500">
            Recipients are finalized when the campaign sends — the exact list of people is frozen at that moment, so state groups match who
            is in that state then.
          </p>
        </Card>
      ) : (
        <>
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
        </>
      )}

      {/* Edit (prefilled) — drafts and not-yet-delivering campaigns */}
      <AdminCampaignDialog open={editOpen} onClose={() => setEditOpen(false)} campaign={campaign} />

      <ConfirmDialog
        open={deleteOpen}
        title="Delete this draft?"
        description="The draft will be permanently removed. Nothing has been sent, so there is no record to keep."
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setDeleteOpen(false)}
        loading={deleteMutation.isPending}
        confirmLabel="Yes, delete"
      />

      {/* Errors */}
      <MutationErrors mutations={[cancelMutation, sendNowMutation, clearScheduleMutation, deleteMutation]} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Tab (list view + create dialog)                                     */
/* ------------------------------------------------------------------ */

export function EmailCampaignsTab() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Column visibility + user column order (client-side rendering only — the
  // campaign list takes no `columns` param: a handful-of-rows table, see the
  // module doc's deliberate deviation from the admin list-endpoint convention).
  const { visibleColumns } = useColumnVisibility("adminEmailCampaigns");
  const { orderedKeys, reorder, moveBy, resetOrder, isDefaultOrder } = useColumnOrder("adminEmailCampaigns", visibleColumns);

  // Visible columns in the user's custom order (drives header + row render).
  const displayColumns = useMemo(() => orderedKeys.filter((k) => visibleColumns.includes(k)), [orderedKeys, visibleColumns]);

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
      {/* Create + table controls (Compose lives in the page header, for all tabs) */}
      <div className="mb-4 flex items-center justify-end gap-3">
        {!isDefaultOrder && (
          <Button variant="secondary" onClick={resetOrder}>
            Reset order
          </Button>
        )}
        <ColumnToggle resourceKey="adminEmailCampaigns" />
        <Button onClick={() => setDialogOpen(true)}>+ New campaign</Button>
      </div>

      {/* Info note */}
      <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 px-5 py-3 text-sm text-blue-800">
        A campaign emails every account in the selected roles and state groups (plus any extra addresses you add), delivered slowly over
        time so it doesn't look like spam. Schedule it for a later time — its recipients are finalized when it sends — or save it as a
        draft, which won't send until you open it and send it. Cancel any time — un-sent recipients are skipped.
      </div>

      {/* Table */}
      {campaigns.length === 0 ? (
        <Card>
          <p className="py-8 text-center text-gray-400">
            No email campaigns yet. Create one to send a batch email to selected roles or state groups.
          </p>
        </Card>
      ) : (
        <Table>
          <TableHead>
            {displayColumns.map((key) => (
              <DraggableTh key={key} unit={[key]} onReorder={reorder} onMoveBy={moveBy}>
                {CAMPAIGN_HEADERS[key]}
              </DraggableTh>
            ))}
          </TableHead>
          <TableBody>
            {campaigns.map((campaign) => {
              const badge = statusBadge(campaign);
              const cells: Record<string, React.ReactNode> = {
                subject: (
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
                ),
                roles: (
                  <Td className="text-gray-600">
                    {campaign.roles.length > 0 ? campaign.roles.join(", ") : campaign.segments.length > 0 ? "—" : "manual only"}
                  </Td>
                ),
                state_groups: (
                  <Td className="text-gray-600">{campaign.segments.length > 0 ? segmentShortLabels(campaign.segments) : "—"}</Td>
                ),
                progress: (
                  <Td>
                    {campaign.status === "draft" ? (
                      <span className="text-sm text-gray-400">Draft</span>
                    ) : campaign.status === "pending" && campaign.total_recipients === 0 ? (
                      <span className="text-sm text-gray-400">At send time</span>
                    ) : (
                      <CampaignProgress sent={campaign.sent_count} failed={campaign.failed_count} total={campaign.total_recipients} />
                    )}
                  </Td>
                ),
                status: (
                  <Td>
                    <span
                      data-testid="campaign-status-badge"
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                  </Td>
                ),
                scheduled_for: (
                  <Td className="whitespace-nowrap text-sm text-gray-500">
                    {campaign.scheduled_for ? formatDateTime(campaign.scheduled_for) : "—"}
                  </Td>
                ),
                created_at: <Td className="whitespace-nowrap text-sm text-gray-500">{formatDateTime(campaign.created_at)}</Td>,
              };
              return (
                <Tr key={campaign.id} className="cursor-pointer" onClick={() => setSelectedId(campaign.id)}>
                  {displayColumns.map((key) => (
                    <Fragment key={key}>{cells[key]}</Fragment>
                  ))}
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
