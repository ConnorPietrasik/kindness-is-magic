/**
 * EmailCampaignsTab — list badges/columns for drafts and scheduled
 * campaigns, and the detail's draft + scheduled actions (send now, edit,
 * delete). API calls are mocked; a real QueryClient is used.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import type { EmailCampaignDetailResponse, EmailCampaignSummary } from "../types";
import { EmailCampaignsTab } from "./EmailCampaignsTab";

const draftCampaign: EmailCampaignSummary = {
  id: 1,
  subject: "Draft campaign",
  roles: ["donor"],
  segments: ["families_not_submitted_for_review"],
  status: "draft",
  total_recipients: 0,
  sent_count: 0,
  failed_count: 0,
  pending_count: 0,
  canceled_count: 0,
  created_at: "2026-01-01T00:00:00Z",
  completed_at: null,
  scheduled_for: null,
  sender_name: "Admin",
};

const scheduledCampaign: EmailCampaignSummary = {
  id: 2,
  subject: "Scheduled campaign",
  roles: [],
  segments: [],
  status: "pending",
  total_recipients: 4,
  sent_count: 0,
  failed_count: 0,
  pending_count: 4,
  canceled_count: 0,
  created_at: "2026-01-01T00:00:00Z",
  completed_at: null,
  scheduled_for: "2030-01-15T09:30:00Z",
  sender_name: "Admin",
};

const segmentOnlyCampaign: EmailCampaignSummary = {
  id: 3,
  subject: "Segment-only campaign",
  roles: [],
  segments: ["donors_unfulfilled_gift_claims"],
  status: "pending",
  total_recipients: 2,
  sent_count: 0,
  failed_count: 0,
  pending_count: 2,
  canceled_count: 0,
  created_at: "2026-01-01T00:00:00Z",
  completed_at: null,
  scheduled_for: "2030-02-01T09:00:00Z",
  sender_name: "Admin",
};

// A scheduled campaign the worker hasn't reached yet: no recipient rows —
// the selection is resolved when it becomes due (pending, total 0).
const unresolvedScheduledCampaign: EmailCampaignSummary = {
  id: 4,
  subject: "Unresolved scheduled",
  roles: [],
  segments: ["families_not_submitted_for_review"],
  status: "pending",
  total_recipients: 0,
  sent_count: 0,
  failed_count: 0,
  pending_count: 0,
  canceled_count: 0,
  created_at: "2026-01-01T00:00:00Z",
  completed_at: null,
  scheduled_for: "2030-03-01T09:00:00Z",
  sender_name: "Admin",
};

const listResponse = { campaigns: [scheduledCampaign, segmentOnlyCampaign, draftCampaign, unresolvedScheduledCampaign] };

function draftDetailResponse(): EmailCampaignDetailResponse {
  return {
    campaign: { ...draftCampaign, message: "Draft body", extra_emails: ["a@example.com"] },
    recipients: [],
    total: 0,
    page: 1,
    page_size: 50,
    total_pages: 0,
  };
}

function scheduledDetailResponse(): EmailCampaignDetailResponse {
  return {
    campaign: { ...scheduledCampaign, message: "Scheduled body", extra_emails: ["b@example.com"] },
    recipients: [
      {
        id: 1,
        email: "b@example.com",
        source: "manual",
        status: "pending",
        failure_reason: null,
        sent_at: null,
        user_display_name: null,
      },
    ],
    total: 4,
    page: 1,
    page_size: 50,
    total_pages: 1,
  };
}

function unresolvedDetailResponse(): EmailCampaignDetailResponse {
  return {
    campaign: { ...unresolvedScheduledCampaign, message: "Unresolved body", extra_emails: [] },
    recipients: [],
    total: 0,
    page: 1,
    page_size: 50,
    total_pages: 0,
  };
}

function mockDetail() {
  vi.spyOn(api, "adminGetEmailCampaign").mockImplementation((_id) =>
    Promise.resolve(
      _id === draftCampaign.id
        ? draftDetailResponse()
        : _id === unresolvedScheduledCampaign.id
          ? unresolvedDetailResponse()
          : scheduledDetailResponse()
    )
  );
}

function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ToastContainer>
        <EmailCampaignsTab />
      </ToastContainer>
    </QueryClientProvider>
  );
}

describe("EmailCampaignsTab list", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    cleanup();
  });

  it("shows draft and scheduled badges, and the scheduled time", async () => {
    vi.spyOn(api, "adminListEmailCampaigns").mockResolvedValue(listResponse);
    renderTab();

    const draftRow = await screen.findByRole("row", { name: /Draft campaign/ });
    const scheduledRow = screen.getByRole("row", { name: /Scheduled campaign/ });
    const segmentOnlyRow = screen.getByRole("row", { name: /Segment-only campaign/ });

    // Badges (testid-scoped — bare text also matches the Progress cell).
    expect(within(draftRow).getByTestId("campaign-status-badge")).toHaveTextContent("Draft");
    expect(within(scheduledRow).getByTestId("campaign-status-badge")).toHaveTextContent("Scheduled");
    // Drafts show no delivery progress ("Draft" appears in both the badge
    // and the Progress cell); the scheduled time is its own column.
    expect(within(draftRow).getAllByText("Draft").length).toBeGreaterThanOrEqual(2);
    expect(scheduledRow).toHaveTextContent(/0\/4 sent/);
    expect(scheduledRow).toHaveTextContent(/2030/);
    // The state-groups cell shows the compact label (full label on hover;
    // "—" when none).
    const segCell = within(draftRow).getByText("Unsubmitted families");
    expect(segCell).toHaveAttribute("title", "Families that haven't submitted for review");
    expect(within(scheduledRow).getByText("—")).toBeInTheDocument();
    // The roles cell only says "manual only" when no roles AND no state
    // groups are selected — a segment-only selection shows "—".
    expect(within(scheduledRow).getByText("manual only")).toBeInTheDocument();
    expect(within(segmentOnlyRow).getByText("—")).toBeInTheDocument();
    expect(within(segmentOnlyRow).queryByText("manual only")).not.toBeInTheDocument();
    // An unresolved scheduled campaign (no rows yet) shows no progress
    // numbers — "0/0 sent" would be a lie.
    const unresolvedRow = screen.getByRole("row", { name: /Unresolved scheduled/ });
    expect(within(unresolvedRow).getByTestId("campaign-status-badge")).toHaveTextContent("Scheduled");
    expect(within(unresolvedRow).getByText("At send time")).toBeInTheDocument();
  });

  it("the gear toggles column visibility on the list", async () => {
    vi.spyOn(api, "adminListEmailCampaigns").mockResolvedValue(listResponse);
    const user = userEvent.setup();
    renderTab();
    await screen.findByRole("row", { name: /Draft campaign/ });

    // All seven columns render by default, in registry order.
    for (const label of ["Subject", "Roles", "State groups", "Progress", "Status", "Scheduled", "Created"]) {
      expect(screen.getByRole("columnheader", { name: label })).toBeInTheDocument();
    }

    // Uncheck a column via the gear and apply — its header disappears.
    await user.click(screen.getByLabelText("Toggle columns"));
    await user.click(screen.getByLabelText("Scheduled"));
    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(screen.queryByRole("columnheader", { name: "Scheduled" })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Subject" })).toBeInTheDocument();
  });
});

describe("EmailCampaignsTab detail", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    cleanup();
  });

  it("draft: live recipient count, send now, and delete with confirm", async () => {
    vi.spyOn(api, "adminListEmailCampaigns").mockResolvedValue(listResponse);
    mockDetail();
    const preview = vi
      .spyOn(api, "adminPreviewEmailCampaign")
      .mockResolvedValue({ total: 3, by_role: { donor: 2 }, by_segment: {}, manual: 1 });
    const send = vi.spyOn(api, "adminSendEmailCampaign").mockResolvedValue({ ...draftCampaign, status: "pending" });
    const del = vi.spyOn(api, "adminDeleteEmailCampaign").mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderTab();

    const draftRow = await screen.findByRole("row", { name: /Draft campaign/ });
    await user.click(within(draftRow).getByRole("button", { name: "Draft campaign" }));

    // Detail: draft badge, live count from the preview, no recipient table.
    expect(screen.getByTestId("campaign-status-badge")).toHaveTextContent("Draft");
    expect(await screen.findByText("Will send to 3")).toBeInTheDocument();
    // The draft's live preview is keyed on the stored selection (roles +
    // segments + manual addresses).
    expect(preview).toHaveBeenCalledWith({
      roles: ["donor"],
      segments: ["families_not_submitted_for_review"],
      extra_emails: ["a@example.com"],
    });
    // The detail's meta shows the stored state groups.
    expect(screen.getByText("State groups")).toBeInTheDocument();
    expect(screen.getByText("Families that haven't submitted for review")).toBeInTheDocument();
    expect(screen.getByText(/Recipients are finalized when the campaign is sent/)).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Email" })).not.toBeInTheDocument();

    // Send now activates the draft.
    await user.click(screen.getByRole("button", { name: "Send now" }));
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith(1);

    // Delete asks for confirmation first.
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText(/Delete this draft\?/)).toBeInTheDocument();
    expect(del).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Yes, delete" }));
    await vi.waitFor(() => expect(del).toHaveBeenCalledTimes(1));
    expect(del).toHaveBeenCalledWith(1);
  });

  it("scheduled: shows the time, and send now clears it", async () => {
    vi.spyOn(api, "adminListEmailCampaigns").mockResolvedValue(listResponse);
    mockDetail();
    const update = vi.spyOn(api, "adminUpdateEmailCampaign").mockResolvedValue({ ...scheduledCampaign, scheduled_for: null });
    vi.spyOn(api, "adminSendEmailCampaign");
    const user = userEvent.setup();
    renderTab();

    const scheduledRow = await screen.findByRole("row", { name: /Scheduled campaign/ });
    await user.click(within(scheduledRow).getByRole("button", { name: "Scheduled campaign" }));

    expect(screen.getByTestId("campaign-status-badge")).toHaveTextContent("Scheduled");
    expect(screen.getByText("Scheduled for")).toBeInTheDocument();

    // Send now clears the stored time (the campaign is already queued — no
    // /send call).
    await user.click(screen.getByRole("button", { name: "Send now" }));
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith(2, { scheduled_for: "" });
  });

  it("unresolved scheduled: estimate + finalized-at-send note, no recipient table", async () => {
    vi.spyOn(api, "adminListEmailCampaigns").mockResolvedValue(listResponse);
    mockDetail();
    const preview = vi
      .spyOn(api, "adminPreviewEmailCampaign")
      .mockResolvedValue({ total: 2, by_role: {}, by_segment: { families_not_submitted_for_review: 2 }, manual: 0 });
    const user = userEvent.setup();
    renderTab();

    const row = await screen.findByRole("row", { name: /Unresolved scheduled/ });
    await user.click(within(row).getByRole("button", { name: "Unresolved scheduled" }));

    expect(screen.getByTestId("campaign-status-badge")).toHaveTextContent("Scheduled");
    // Live estimate keyed on the stored selection (an estimate — the
    // snapshot freezes when the campaign sends).
    expect(await screen.findByText(/~2 today — finalized when it sends/)).toBeInTheDocument();
    expect(preview).toHaveBeenCalledWith({
      roles: [],
      segments: ["families_not_submitted_for_review"],
      extra_emails: [],
    });
    // The finalized-at-send note replaces the recipient audit (no rows yet).
    expect(screen.getByText(/Recipients are finalized when the campaign sends/)).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Email" })).not.toBeInTheDocument();
    // Send now clears the time — the campaign becomes due immediately.
    expect(screen.getByRole("button", { name: "Send now" })).toBeInTheDocument();
  });
});
