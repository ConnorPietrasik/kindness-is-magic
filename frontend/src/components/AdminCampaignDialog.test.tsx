import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import type { EmailCampaignDetail, EmailCampaignSummary } from "../types";
import { AdminCampaignDialog, parseManualEmails } from "./AdminCampaignDialog";

/** A minimal campaign summary for create/send mock responses. */
const summary: EmailCampaignSummary = {
  id: 1,
  subject: "S",
  roles: [],
  status: "pending",
  total_recipients: 1,
  sent_count: 0,
  failed_count: 0,
  pending_count: 1,
  canceled_count: 0,
  created_at: "2026-01-01T00:00:00Z",
  completed_at: null,
  scheduled_for: null,
  sender_name: null,
};

function renderDialog(props: { campaign?: EmailCampaignDetail } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ToastContainer>
        <AdminCampaignDialog open onClose={vi.fn()} campaign={props.campaign} />
      </ToastContainer>
    </QueryClientProvider>
  );
  return queryClient;
}

/** Fill the dialog with a valid manual-address selection + message. */
async function fillSelection(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Extra email addresses (optional)"), "a@example.com");
  await user.type(screen.getByLabelText("Message"), "Body");
}

describe("parseManualEmails", () => {
  it("splits on newlines", () => {
    expect(parseManualEmails("a@example.com\nb@example.com\nc@example.com")).toEqual(["a@example.com", "b@example.com", "c@example.com"]);
  });

  it("splits on commas and semicolons", () => {
    expect(parseManualEmails("a@example.com, b@example.com; c@example.com")).toEqual(["a@example.com", "b@example.com", "c@example.com"]);
  });

  it("trims, lowercases, and dedupes case-insensitively", () => {
    expect(parseManualEmails("  A@Example.com \n a@example.com ,B@Example.com")).toEqual(["a@example.com", "b@example.com"]);
  });

  it("drops empties (extra separators, blank lines, leading/trailing commas)", () => {
    expect(parseManualEmails("\n,\n a@example.com ,,  \n")).toEqual(["a@example.com"]);
  });

  it("returns an empty array for blank input", () => {
    expect(parseManualEmails("")).toEqual([]);
    expect(parseManualEmails("   \n  , \n")).toEqual([]);
  });
});

describe("AdminCampaignDialog preview", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("shows a non-blocking note when the preview fails (e.g. an invalid address)", async () => {
    vi.spyOn(api, "adminPreviewEmailCampaign").mockRejectedValue(new Error("422"));
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ToastContainer>
          <AdminCampaignDialog open onClose={vi.fn()} />
        </ToastContainer>
      </QueryClientProvider>
    );

    await user.type(screen.getByLabelText("Extra email addresses (optional)"), "not-an-email");
    await user.type(screen.getByLabelText("Message"), "Body");

    // The failed preview (a 422 on the invalid address) never blocks create.
    await screen.findByText(/Preview unavailable/, {}, { timeout: 5000 });
    expect(screen.getByRole("button", { name: "Create campaign" })).toBeEnabled();
  });

  it("shows the total plus the per-role/manual breakdown once the preview resolves", async () => {
    vi.spyOn(api, "adminPreviewEmailCampaign").mockResolvedValue({ total: 5, by_role: { donor: 2, admin: 3 }, manual: 0 });
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ToastContainer>
          <AdminCampaignDialog open onClose={vi.fn()} />
        </ToastContainer>
      </QueryClientProvider>
    );

    await user.click(screen.getByRole("checkbox", { name: "Donors" }));
    await user.click(screen.getByRole("checkbox", { name: "Admins" }));

    // The preview fires after the 500ms debounce.
    await screen.findByText(/Will send to/, {}, { timeout: 2000 });
    expect(screen.getByText(/2 donors, 3 admins/)).toBeInTheDocument();
  });
});

describe("AdminCampaignDialog Escape", () => {
  afterEach(() => {
    cleanup();
  });

  it("closes on Escape even when focus is outside the dialog", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ToastContainer>
          <AdminCampaignDialog open onClose={onClose} />
        </ToastContainer>
      </QueryClientProvider>
    );

    // userEvent keys from document.activeElement (the body — outside the
    // dialog). A bubbling backdrop-only handler would miss this; the
    // window-level listener must catch it.
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("AdminCampaignDialog delivery modes (create)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("save as draft stores the selection without sending, with the picked time", async () => {
    vi.spyOn(api, "adminPreviewEmailCampaign").mockResolvedValue({ total: 1, by_role: {}, manual: 1 });
    const create = vi.spyOn(api, "adminCreateEmailCampaign").mockResolvedValue({ ...summary, status: "draft" });
    const user = userEvent.setup();
    renderDialog();

    await fillSelection(user);
    const sendAt = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    expect(sendAt).toBeTruthy();
    await user.type(sendAt, "2030-01-15T09:30");

    await user.click(screen.getByRole("button", { name: "Save as draft" }));
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        extra_emails: ["a@example.com"],
        save_as_draft: true,
        scheduled_for: expect.stringMatching(/^2030-01-15T\d{2}:\d{2}:\d{2}Z$/),
      })
    );
  });

  it("a picked time relabels the primary button and schedules the campaign", async () => {
    vi.spyOn(api, "adminPreviewEmailCampaign").mockResolvedValue({ total: 1, by_role: {}, manual: 1 });
    const create = vi.spyOn(api, "adminCreateEmailCampaign").mockResolvedValue(summary);
    const user = userEvent.setup();
    renderDialog();

    await fillSelection(user);
    const sendAt = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    await user.type(sendAt, "2030-01-15T09:30");

    // No time → "Create campaign"; a time → "Schedule campaign".
    expect(screen.queryByRole("button", { name: "Create campaign" })).not.toBeInTheDocument();
    const schedule = screen.getByRole("button", { name: "Schedule campaign" });
    await user.click(schedule);
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        save_as_draft: false,
        scheduled_for: expect.stringMatching(/^2030-01-15T\d{2}:\d{2}:\d{2}Z$/),
      })
    );
  });

  it("an empty time creates an immediate campaign", async () => {
    vi.spyOn(api, "adminPreviewEmailCampaign").mockResolvedValue({ total: 1, by_role: {}, manual: 1 });
    const create = vi.spyOn(api, "adminCreateEmailCampaign").mockResolvedValue(summary);
    const user = userEvent.setup();
    renderDialog();

    await fillSelection(user);
    await user.click(screen.getByRole("button", { name: "Create campaign" }));
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        save_as_draft: false,
        scheduled_for: null,
      })
    );
  });

  it("a picked time in the past creates an immediate campaign (the backend 422s a past time)", async () => {
    vi.spyOn(api, "adminPreviewEmailCampaign").mockResolvedValue({ total: 1, by_role: {}, manual: 1 });
    const create = vi.spyOn(api, "adminCreateEmailCampaign").mockResolvedValue(summary);
    const user = userEvent.setup();
    renderDialog();

    await fillSelection(user);
    const sendAt = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    await user.type(sendAt, "2020-01-15T09:30");

    // A past time is due now: the label stays "Create campaign" (no
    // schedule) and the time is dropped from the payload (null = ASAP).
    expect(screen.getByRole("button", { name: "Create campaign" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create campaign" }));
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        save_as_draft: false,
        scheduled_for: null,
      })
    );
  });
});

describe("AdminCampaignDialog edit mode", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  const draft: EmailCampaignDetail = {
    id: 7,
    subject: "Old subject",
    roles: [],
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
    message: "Old body",
    extra_emails: ["a@example.com"],
  };

  it("prefills the form from the campaign", () => {
    renderDialog({ campaign: draft });
    expect((screen.getByLabelText("Subject") as HTMLInputElement).value).toBe("Old subject");
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe("Old body");
    expect((screen.getByLabelText("Extra email addresses (optional)") as HTMLTextAreaElement).value).toBe("a@example.com");
    // Create-mode buttons are gone; edit-mode buttons are in.
    expect(screen.queryByRole("button", { name: "Create campaign" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save & send now" })).toBeInTheDocument();
  });

  it("save changes sends a minimal patch (unchanged fields omitted)", async () => {
    vi.spyOn(api, "adminPreviewEmailCampaign").mockResolvedValue({ total: 1, by_role: {}, manual: 1 });
    const update = vi.spyOn(api, "adminUpdateEmailCampaign").mockResolvedValue({ ...summary, status: "draft" });
    const send = vi.spyOn(api, "adminSendEmailCampaign");
    const user = userEvent.setup();
    renderDialog({ campaign: draft });

    const message = screen.getByLabelText("Message") as HTMLTextAreaElement;
    await user.clear(message);
    await user.type(message, "New body");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const call = update.mock.calls[0];
    expect(call?.[0]).toBe(7);
    const patch = call?.[1];
    // Unchanged fields are omitted from the patch — including the arrays
    // (compared by content, so the fresh parsed list doesn't count as a
    // change).
    expect(patch).toEqual({ message: "New body" });
    // Save changes never sends.
    expect(send).not.toHaveBeenCalled();
  });

  it("save & send now patches, then activates the draft", async () => {
    vi.spyOn(api, "adminPreviewEmailCampaign").mockResolvedValue({ total: 1, by_role: {}, manual: 1 });
    vi.spyOn(api, "adminUpdateEmailCampaign").mockResolvedValue({ ...summary, status: "draft" });
    const send = vi.spyOn(api, "adminSendEmailCampaign").mockResolvedValue(summary);
    const user = userEvent.setup();
    renderDialog({ campaign: draft });

    const message = screen.getByLabelText("Message") as HTMLTextAreaElement;
    await user.clear(message);
    await user.type(message, "New body");
    await user.click(screen.getByRole("button", { name: "Save & send now" }));

    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith(7);
  });

  it("picking a past time on a scheduled draft clears the stored time and sends", async () => {
    vi.spyOn(api, "adminPreviewEmailCampaign").mockResolvedValue({ total: 1, by_role: {}, manual: 1 });
    const update = vi.spyOn(api, "adminUpdateEmailCampaign").mockResolvedValue({ ...summary, status: "draft" });
    const send = vi.spyOn(api, "adminSendEmailCampaign").mockResolvedValue(summary);
    const user = userEvent.setup();
    const scheduledDraft: EmailCampaignDetail = { ...draft, id: 11, status: "draft", scheduled_for: "2030-01-15T09:30:00Z" };
    renderDialog({ campaign: scheduledDraft });

    // The picker is prefilled with the stored (future) time — repick one
    // in the past.
    const sendAt = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    await user.clear(sendAt);
    await user.type(sendAt, "2020-01-15T09:30");

    // A past time = send-as-soon-as-possible: the patch clears the stored
    // time ("" — null would be a no-op on update) and the draft is then
    // activated.
    await user.click(screen.getByRole("button", { name: "Save & send now" }));
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith(11, { scheduled_for: "" });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith(11);
  });

  it("an activated campaign offers only save changes (no send action)", async () => {
    vi.spyOn(api, "adminPreviewEmailCampaign").mockResolvedValue({ total: 1, by_role: {}, manual: 1 });
    const update = vi.spyOn(api, "adminUpdateEmailCampaign").mockResolvedValue(summary);
    const send = vi.spyOn(api, "adminSendEmailCampaign");
    const user = userEvent.setup();
    const scheduled: EmailCampaignDetail = { ...draft, id: 9, status: "pending", scheduled_for: "2030-01-15T09:30:00Z" };
    renderDialog({ campaign: scheduled });

    // An activated campaign is never "sent" from the dialog (/send only
    // applies to drafts) — so there is no "Save & send now", just the
    // single "Save changes" (the detail's "Send now" clears the time).
    expect(screen.queryByRole("button", { name: "Save & send now" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save & schedule" })).not.toBeInTheDocument();

    // Clearing the picker clears the stored time in the patch — the same
    // effect as the detail's "Send now".
    const sendAt = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    expect(sendAt!.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    await user.clear(sendAt);

    // No other change — the time clear is the only patch entry.
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    // subject/message and the unchanged arrays are omitted; only the time
    // clear remains ("" vs the stored time — normalizeUpdatePayload's
    // datetime comparison flags it).
    expect(update).toHaveBeenCalledWith(9, { scheduled_for: "" });
    expect(send).not.toHaveBeenCalled();
  });

  it("a blanked message disables the save buttons in edit mode", async () => {
    vi.spyOn(api, "adminPreviewEmailCampaign").mockResolvedValue({ total: 1, by_role: {}, manual: 1 });
    const update = vi.spyOn(api, "adminUpdateEmailCampaign");
    const send = vi.spyOn(api, "adminSendEmailCampaign");
    const user = userEvent.setup();
    renderDialog({ campaign: draft });

    const message = screen.getByLabelText("Message") as HTMLTextAreaElement;
    await user.clear(message);

    // A blank message 422s on the update route — the buttons disable
    // instead of letting the submit fail.
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save & send now" })).toBeDisabled();
    expect(update).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
