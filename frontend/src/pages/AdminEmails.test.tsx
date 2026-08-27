import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import { formatDateTime } from "../lib/utils";
import type { EmailKind, SentEmailSummary } from "../types";
import AdminEmails, { KIND_LABELS } from "./AdminEmails";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const emptyListResponse = { emails: [], total: 0, page: 1, page_size: 50, total_pages: 0 };

const wrap = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={["/admin/emails"]}>
      <QueryClientProvider client={queryClient}>
        <ToastContainer>
          <AdminEmails />
        </ToastContainer>
      </QueryClientProvider>
    </MemoryRouter>
  );
};

function makeEmail(overrides: Partial<SentEmailSummary>): SentEmailSummary {
  return {
    id: 1,
    recipient_email: "family@example.com",
    kind: "family_invite",
    status: "sent",
    failure_reason: null,
    sent_at: "2025-06-01T12:00:00Z",
    sender_name: "Jane Smith",
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe("KIND_LABELS", () => {
  const ALL_KINDS: EmailKind[] = [
    "family_invite",
    "referrer_invite",
    "password_reset",
    "family_pending",
    "family_approved",
    "referrer_approved",
    "referrer_rejected",
    "claim_confirmation",
    "admin_failure_notice",
  ];

  it("has a display label for every email kind", () => {
    for (const kind of ALL_KINDS) {
      expect(KIND_LABELS[kind]).toBeTruthy();
    }
    // No stale/extra kinds in the map
    expect(Object.keys(KIND_LABELS).sort()).toEqual([...ALL_KINDS].sort());
  });
});

describe("AdminEmails", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
    localStorage.clear();
  });

  it("renders one row per email with recipient, kind, status, sender, and sent date", async () => {
    vi.spyOn(api, "adminListSentEmails").mockResolvedValue({
      emails: [
        makeEmail({ id: 1, recipient_email: "alice@example.com", kind: "family_invite", status: "sent", sender_name: "Jane Smith" }),
        makeEmail({
          id: 2,
          recipient_email: "bob@example.com",
          kind: "password_reset",
          status: "failed",
          failure_reason: "SMTP error: connection refused",
          sender_name: null,
        }),
        makeEmail({ id: 3, recipient_email: "carol@example.com", kind: "claim_confirmation", status: "reset", sender_name: "Donor User" }),
      ],
      total: 3,
      page: 1,
      page_size: 50,
      total_pages: 1,
    });

    wrap();

    await waitFor(() => {
      expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    });

    // Sent row
    const sentRow = screen.getByText("alice@example.com").closest("tr")!;
    expect(sentRow).toHaveTextContent("Family Invite");
    expect(sentRow).toHaveTextContent("Sent");
    expect(sentRow).toHaveTextContent("Jane Smith");
    expect(sentRow).toHaveTextContent(formatDateTime("2025-06-01T12:00:00Z"));

    // Failed row — status includes the failure reason; null sender renders a dash
    const failedRow = screen.getByText("bob@example.com").closest("tr")!;
    expect(failedRow).toHaveTextContent("Password Reset");
    expect(failedRow).toHaveTextContent("Failed — SMTP error: connection refused");
    expect(failedRow).toHaveTextContent("—");

    // Reset row
    const resetRow = screen.getByText("carol@example.com").closest("tr")!;
    expect(resetRow).toHaveTextContent("Claim Confirmation");
    expect(resetRow).toHaveTextContent("Reset (not counted)");
    expect(resetRow).toHaveTextContent("Donor User");
  });

  it("shows the empty state when no emails match", async () => {
    vi.spyOn(api, "adminListSentEmails").mockResolvedValue(emptyListResponse);

    wrap();

    await waitFor(() => {
      expect(screen.getByText("No sent emails found.")).toBeInTheDocument();
    });
  });

  it("passes search, kind, and status filters to the API", async () => {
    const user = userEvent.setup();
    // Auto-advance time so the 1s search debounce fires quickly without freezing waitFor
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 50 });
    try {
      const listSpy = vi
        .spyOn(api, "adminListSentEmails")
        .mockResolvedValueOnce({ ...emptyListResponse })
        .mockResolvedValue(emptyListResponse);

      wrap();

      // Initial request (no filters)
      await waitFor(() => {
        expect(listSpy).toHaveBeenCalledTimes(1);
      });
      expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ search: undefined, kind: undefined, status: undefined }));

      // Kind + status filters refetch immediately and reset to page 1
      await user.selectOptions(screen.getByLabelText("Kind filter"), "family_invite");
      await user.selectOptions(screen.getByLabelText("Status filter"), "failed");
      await waitFor(() => {
        expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "family_invite", status: "failed" }));
      });

      // Search is debounced, then sent along with the other filters
      await user.type(screen.getByLabelText("Search by recipient email"), "test");
      await waitFor(() => {
        expect(listSpy).toHaveBeenLastCalledWith(
          expect.objectContaining({ search: "test", kind: "family_invite", status: "failed", page: 1 })
        );
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
