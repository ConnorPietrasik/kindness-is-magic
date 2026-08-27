import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import { formatDateTime } from "../lib/utils";
import type { ReferrerDetail, ReferrerInviteEmailItem } from "../types";
import ReferrerFamilyInvites from "./ReferrerFamilyInvites";

/* ------------------------------------------------------------------ */
/* Fixtures & helpers                                                  */
/* ------------------------------------------------------------------ */

function makeReferrer(overrides: Partial<ReferrerDetail> = {}): ReferrerDetail {
  return {
    id: 1,
    name: "Jane Smith",
    family_limit: 5,
    phone_number: "",
    family_invite_code: "KFI-ABC123",
    family_count: 0,
    approval_status: "approved",
    approved_by_admin_name: null,
    approved_at: null,
    created_at: "2025-01-01T00:00:00Z",
    deleted_at: null,
    invite_count: 0,
    ...overrides,
  };
}

function makeInviteEmail(overrides: Partial<ReferrerInviteEmailItem>): ReferrerInviteEmailItem {
  return {
    id: 10,
    recipient_email: "family@example.com",
    status: "sent",
    failure_reason: null,
    sent_at: "2025-06-01T12:00:00Z",
    ...overrides,
  };
}

const createQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

function wrap(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ToastContainer>
        <MemoryRouter initialEntries={["/referrer/family-invites"]}>
          <Routes>
            <Route path="/referrer/family-invites" element={children} />
          </Routes>
        </MemoryRouter>
      </ToastContainer>
    </QueryClientProvider>
  );
}

function renderPage(referrer: ReferrerDetail, inviteEmails: ReferrerInviteEmailItem[] = []) {
  const qc = createQueryClient();

  vi.spyOn(api, "getReferrerMe").mockResolvedValue(referrer);
  vi.spyOn(api, "listPendingFamilies").mockResolvedValue([]);
  vi.spyOn(api, "listReferrerInviteEmails").mockResolvedValue(inviteEmails);
  vi.spyOn(api, "sendReferrerFamilyInvite").mockResolvedValue({ message: "sent" });

  render(<ReferrerFamilyInvites />, { wrapper: wrap(qc) });
  return qc;
}

/** The dialog's submit button (the card button shares the same label). */
function getDialogSubmitButton() {
  const form = screen.getByRole("button", { name: "Cancel" }).closest("form")!;
  return form.querySelector("button[type='submit']") as HTMLButtonElement;
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe("ReferrerFamilyInvites — invite email limit", () => {
  beforeEach(() => {
    vi.spyOn(api, "getReferrerMe").mockClear();
    vi.spyOn(api, "listPendingFamilies").mockClear();
    vi.spyOn(api, "listReferrerInviteEmails").mockClear();
    vi.spyOn(api, "sendReferrerFamilyInvite").mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows invites used and an enabled send button below the limit", async () => {
    renderPage(makeReferrer({ family_limit: 5, invite_count: 2 }));

    await waitFor(() => {
      expect(screen.getByText("2 of 5 invites used")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Send Invite" })).toBeEnabled();
    expect(screen.queryByText(/reached your limit of 5 invite emails/)).not.toBeInTheDocument();
  });

  it("disables the send button when the limit is reached", async () => {
    renderPage(makeReferrer({ family_limit: 5, invite_count: 5 }));

    await waitFor(() => {
      expect(screen.getByText("5 of 5 invites used")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Send Invite" })).toBeDisabled();
  });

  it("shows the limit note and does not open the dialog when the limit is reached", async () => {
    const user = userEvent.setup();
    renderPage(makeReferrer({ family_limit: 3, invite_count: 3 }));

    await waitFor(() => {
      expect(screen.getByText(/reached your limit of 3 invite emails/)).toBeInTheDocument();
    });
    expect(
      screen.getByText(/only up to 3 families can be accepted under your referral\. An admin can reset your sent invites\./)
    ).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Send Invite" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Send Invite" }));
    expect(screen.queryByText("Send Family Invite")).not.toBeInTheDocument();
  });

  it("opens the dialog when below the limit", async () => {
    const user = userEvent.setup();
    renderPage(makeReferrer({ family_limit: 5, invite_count: 4 }));

    await waitFor(() => {
      expect(screen.getByText("4 of 5 invites used")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Send Invite" }));

    await waitFor(() => {
      expect(screen.getByText("Send Family Invite")).toBeInTheDocument();
    });
  });

  it("closes the dialog, shows a toast, and refreshes referrerMe on successful send", async () => {
    const user = userEvent.setup();
    renderPage(makeReferrer({ family_limit: 5, invite_count: 2 }));

    await waitFor(() => {
      expect(screen.getByText("2 of 5 invites used")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Send Invite" }));
    await waitFor(() => {
      expect(screen.getByText("Send Family Invite")).toBeInTheDocument();
    });

    await user.type(screen.getByPlaceholderText("family@example.com"), "family@example.com");
    await user.click(getDialogSubmitButton());

    await waitFor(() => {
      expect(api.sendReferrerFamilyInvite).toHaveBeenCalledWith("family@example.com", expect.anything());
    });

    // Dialog closes and the success toast is shown
    await waitFor(() => {
      expect(screen.queryByText("Send Family Invite")).not.toBeInTheDocument();
    });
    expect(await screen.findByText("Invite email sent successfully!")).toBeInTheDocument();

    // referrerMe is invalidated so the limit state updates immediately
    await waitFor(() => {
      expect(api.getReferrerMe).toHaveBeenCalledTimes(2);
    });
  });
});

describe("ReferrerFamilyInvites — sent invites history", () => {
  beforeEach(() => {
    vi.spyOn(api, "getReferrerMe").mockClear();
    vi.spyOn(api, "listPendingFamilies").mockClear();
    vi.spyOn(api, "listReferrerInviteEmails").mockClear();
    vi.spyOn(api, "sendReferrerFamilyInvite").mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows the empty state when no invites have been sent", async () => {
    renderPage(makeReferrer(), []);

    await waitFor(() => {
      expect(screen.getByText("No invite emails sent yet.")).toBeInTheDocument();
    });
    expect(screen.queryByRole("columnheader", { name: "Recipient" })).not.toBeInTheDocument();
  });

  it("renders one row per invite with recipient, status, and sent date", async () => {
    renderPage(makeReferrer({ invite_count: 3 }), [
      makeInviteEmail({ id: 1, recipient_email: "alice@example.com", status: "sent", sent_at: "2025-06-01T12:00:00Z" }),
      makeInviteEmail({
        id: 2,
        recipient_email: "bob@example.com",
        status: "failed",
        failure_reason: "SMTP error: connection refused",
        sent_at: "2025-06-02T09:30:00Z",
      }),
      makeInviteEmail({ id: 3, recipient_email: "carol@example.com", status: "reset", sent_at: "2025-06-03T15:45:00Z" }),
    ]);

    await waitFor(() => {
      expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    });

    // Sent row
    const sentRow = screen.getByText("alice@example.com").closest("tr")!;
    expect(sentRow).toHaveTextContent("Sent");
    expect(sentRow).toHaveTextContent(formatDateTime("2025-06-01T12:00:00Z"));

    // Failed row — status includes the failure reason
    const failedRow = screen.getByText("bob@example.com").closest("tr")!;
    expect(failedRow).toHaveTextContent("Failed — SMTP error: connection refused");
    expect(failedRow).toHaveTextContent(formatDateTime("2025-06-02T09:30:00Z"));

    // Reset row
    const resetRow = screen.getByText("carol@example.com").closest("tr")!;
    expect(resetRow).toHaveTextContent("Reset (not counted)");
    expect(resetRow).toHaveTextContent(formatDateTime("2025-06-03T15:45:00Z"));
  });

  it("refreshes the sent invites list after a successful send", async () => {
    const user = userEvent.setup();
    renderPage(makeReferrer({ family_limit: 5, invite_count: 2 }), [makeInviteEmail({ id: 1, recipient_email: "old@example.com" })]);

    await waitFor(() => {
      expect(screen.getByText("old@example.com")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Send Invite" }));
    await waitFor(() => {
      expect(screen.getByText("Send Family Invite")).toBeInTheDocument();
    });

    await user.type(screen.getByPlaceholderText("family@example.com"), "new@example.com");
    await user.click(getDialogSubmitButton());

    await waitFor(() => {
      expect(api.sendReferrerFamilyInvite).toHaveBeenCalledWith("new@example.com", expect.anything());
    });

    // referrerInviteEmails is invalidated so the new invite shows up
    await waitFor(() => {
      expect(api.listReferrerInviteEmails).toHaveBeenCalledTimes(2);
    });
  });
});
