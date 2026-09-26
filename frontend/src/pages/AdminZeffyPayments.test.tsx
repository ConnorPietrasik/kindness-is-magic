import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/AuthContext";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import { auth } from "../lib/queryKeys";
import type { User, ZeffyPayment, ZeffyPendingClaimsResponse } from "../types";
import AdminZeffyPayments from "./AdminZeffyPayments";

/* ------------------------------------------------------------------ */
// Fixtures
/* ------------------------------------------------------------------ */

const mockAdmin: User = {
  id: 99,
  email: "admin@example.com",
  role: "admin",
  display_name: "Admin",
  referrer_id: null,
  family_id: null,
  created_at: "2025-01-01T00:00:00Z",
};

const unmatchedPayment: ZeffyPayment = {
  id: "0195f3a2-bb0c-7b00-8000-000000000001",
  created_at: "2025-12-10T18:30:00Z",
  amount_cents: 60000,
  currency: "USD",
  buyer_name: "Alice Donor",
  buyer_email: "donor@example.com",
  receipt_url: "https://zeffy.example/receipt/1",
  claim_ids: [],
  matched: false,
};

const matchedPayment: ZeffyPayment = {
  id: "0195f3a2-bb0c-7b00-8000-000000000002",
  created_at: "2025-12-09T10:00:00Z",
  amount_cents: 50000,
  currency: "USD",
  buyer_name: "Bob Buyer",
  buyer_email: "bob@example.com",
  receipt_url: null,
  claim_ids: [12, 13],
  matched: true,
};

const pendingClaims: ZeffyPendingClaimsResponse = {
  donors: [
    {
      donor_id: 4,
      donor_email: "donor@example.com",
      donor_display_name: "Alice Donor",
      item_count: 2,
      total_usd: 1100,
      claims: [
        {
          claim_id: 31,
          family: { id: 20, display_id: "3-1", bio: "The board-game family.", person_count: 4, min_age: 5, max_age: 12 },
          includes_groceries: true,
          line_total_usd: 600,
          payment_expires_at: "2099-12-04T00:00:00Z",
        },
        {
          claim_id: 32,
          family: { id: 21, display_id: "3-2", bio: null, person_count: 2, min_age: 3, max_age: 8 },
          includes_groceries: false,
          line_total_usd: 500,
          payment_expires_at: "2099-12-04T00:00:00Z",
        },
      ],
    },
    {
      donor_id: 5,
      donor_email: "other@example.com",
      donor_display_name: null,
      item_count: 1,
      total_usd: 500,
      claims: [
        {
          claim_id: 40,
          family: { id: 22, display_id: "3-3", bio: null, person_count: 3, min_age: 10, max_age: 15 },
          includes_groceries: false,
          line_total_usd: 500,
          payment_expires_at: "2099-12-04T00:00:00Z",
        },
      ],
    },
  ],
};

/* ------------------------------------------------------------------ */
// Wrap
/* ------------------------------------------------------------------ */

function wrap() {
  vi.spyOn(api, "fetchCurrentUser").mockResolvedValue(mockAdmin);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(auth, mockAdmin);
  return render(
    <MemoryRouter initialEntries={["/admin/zeffy-payments"]}>
      <QueryClientProvider client={queryClient}>
        <ToastContainer>
          <AuthProvider>
            <Routes>
              <Route path="/admin/zeffy-payments" element={<AdminZeffyPayments />} />
              <Route path="/donor/claims/:id" element={<div>claim detail</div>} />
            </Routes>
          </AuthProvider>
        </ToastContainer>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

/* ------------------------------------------------------------------ */
// Tests
/* ------------------------------------------------------------------ */

describe("AdminZeffyPayments", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("shows unmatched payments by default and matched ones only after the toggle", async () => {
    vi.spyOn(api, "adminListZeffyPayments").mockResolvedValue({
      payments: [unmatchedPayment, matchedPayment],
      has_more: false,
      next_cursor: null,
    });

    wrap();

    // Unmatched row is visible
    expect(await screen.findByText("Alice Donor")).toBeInTheDocument();
    expect(screen.getByText("Unmatched")).toBeInTheDocument();
    // Matched row is hidden by default
    expect(screen.queryByText("Bob Buyer")).not.toBeInTheDocument();

    const user = userEvent.setup();
    const toggle = screen.getByLabelText("Show matched") as HTMLInputElement;
    await user.click(toggle);

    // Now both are visible, matched row with its claim links
    expect(screen.getByText("Bob Buyer")).toBeInTheDocument();
    // The "Matched" badge (the column header also says "Matched")
    expect(screen.getByText("Matched", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "claim 12" })).toHaveAttribute("href", "/donor/claims/12");
    expect(screen.getByRole("link", { name: "claim 13" })).toHaveAttribute("href", "/donor/claims/13");
  });

  it("passes the visible columns (comma-joined by the api layer) to the API", async () => {
    const spy = vi.spyOn(api, "adminListZeffyPayments").mockResolvedValue({ payments: [], has_more: false, next_cursor: null });

    wrap();

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const params = spy.mock.calls[0]?.[0];
    // Default-visible columns + the always-sent id
    expect([...(params?.columns ?? [])].sort()).toEqual(
      ["created_at", "buyer_name", "buyer_email", "amount_cents", "currency", "matched", "id"].sort()
    );
    expect(params?.limit).toBe(25);
  });

  it("loads the next cursor page with Load more", async () => {
    const user = userEvent.setup();
    const pageTwo: ZeffyPayment = { ...unmatchedPayment, id: "0195f3a2-bb0c-7b00-8000-000000000003", buyer_email: "c@example.com" };
    const spy = vi.spyOn(api, "adminListZeffyPayments").mockImplementation((params) => {
      if (params?.starting_after === "cur-2") {
        return Promise.resolve({ payments: [pageTwo], has_more: false, next_cursor: null });
      }
      return Promise.resolve({ payments: [unmatchedPayment], has_more: true, next_cursor: "cur-2" });
    });

    wrap();

    await screen.findByText("Alice Donor");
    expect(screen.getByRole("button", { name: "Load more" })).toBeInTheDocument();
    // No second row yet
    expect(screen.queryByText("c@example.com")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Load more" }));

    // The second page was requested with the cursor and appended
    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ starting_after: "cur-2" }));
    });
    expect(await screen.findByText("c@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("shows an empty state when there are no unmatched payments", async () => {
    vi.spyOn(api, "adminListZeffyPayments").mockResolvedValue({ payments: [matchedPayment], has_more: false, next_cursor: null });

    wrap();

    expect(await screen.findByText("No unmatched payments.")).toBeInTheDocument();
  });

  it("shows a graceful error page when Zeffy is unconfigured (503)", async () => {
    const error = new Error("Request failed");
    (error as unknown as { response: { status: number; data: { detail: string } } }).response = {
      status: 503,
      data: { detail: "Zeffy is not configured. Set ZEFFY_API_KEY." },
    };
    vi.spyOn(api, "adminListZeffyPayments").mockRejectedValue(error);

    wrap();

    expect(await screen.findByText("Unable to Load Zeffy Payments")).toBeInTheDocument();
    expect(screen.getByText("Zeffy is not configured. Set ZEFFY_API_KEY.")).toBeInTheDocument();
  });

  /* ── Match modal ───────────────────────────────────────────── */

  it("groups pending claims by donor with select-all and per-claim amounts", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminListZeffyPayments").mockResolvedValue({ payments: [unmatchedPayment], has_more: false, next_cursor: null });
    vi.spyOn(api, "adminListZeffyPendingClaims").mockResolvedValue(pendingClaims);

    wrap();

    await screen.findByText("Alice Donor");
    await user.click(screen.getByRole("button", { name: "Match manually" }));

    // Modal header: payment amount + buyer + date
    expect(await screen.findByText("Match payment manually")).toBeInTheDocument();
    expect(screen.getByText(/\$600\.00 USD/)).toBeInTheDocument();
    // Donor groups with display name, email, and cart total
    // ("Alice Donor" now also appears as the payment row's buyer)
    expect((await screen.findAllByText("Alice Donor")).length).toBe(2);
    // The email shows in the table row (td) and the donor group (p)
    expect(screen.getByText("donor@example.com", { selector: "p" })).toBeInTheDocument();
    // Both donor groups show their cart total
    expect(screen.getAllByText(/Cart total:/)).toHaveLength(2);
    expect(screen.getByText("$1100")).toBeInTheDocument();
    // Per-claim rows with line totals
    expect(screen.getByText("Family 3-1 + groceries")).toBeInTheDocument();
    expect(screen.getByText("$600")).toBeInTheDocument();
    // The anonymous donor shows the email as the name
    expect(screen.getByText("other@example.com")).toBeInTheDocument();
    expect(screen.getByText("Family 3-3")).toBeInTheDocument();
  });

  it("keeps confirm disabled until a claim is selected, then shows the expected-amount hints", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminListZeffyPayments").mockResolvedValue({ payments: [unmatchedPayment], has_more: false, next_cursor: null });
    vi.spyOn(api, "adminListZeffyPendingClaims").mockResolvedValue(pendingClaims);

    wrap();

    await screen.findByText("Alice Donor");
    await user.click(screen.getByRole("button", { name: "Match manually" }));

    const confirm = await screen.findByRole("button", { name: "Confirm match" });
    expect(confirm).toBeDisabled();

    // Select the $600 claim — exact match with the $600 payment
    await user.click(screen.getByRole("checkbox", { name: "Match claim 31 (family 3-1)" }));
    await waitFor(() => expect(confirm).not.toBeDisabled());
    expect(screen.getByText("Selected total matches the payment amount.")).toBeInTheDocument();

    // Add the $500 claim — total now differs from the payment amount
    await user.click(screen.getByRole("checkbox", { name: "Match claim 32 (family 3-2)" }));
    expect(screen.getByText("Selected total ($1100.00) differs from the payment amount — use your judgment.")).toBeInTheDocument();
  });

  it("select-all toggles every claim for one donor", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminListZeffyPayments").mockResolvedValue({ payments: [unmatchedPayment], has_more: false, next_cursor: null });
    vi.spyOn(api, "adminListZeffyPendingClaims").mockResolvedValue(pendingClaims);

    wrap();

    await screen.findByText("Alice Donor");
    await user.click(screen.getByRole("button", { name: "Match manually" }));

    await user.click(await screen.findByRole("checkbox", { name: "Select all claims for donor@example.com" }));
    expect(screen.getByRole("checkbox", { name: "Match claim 31 (family 3-1)" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Match claim 32 (family 3-2)" })).toBeChecked();
    // The other donor is untouched
    expect(screen.getByRole("checkbox", { name: "Match claim 40 (family 3-3)" })).not.toBeChecked();
  });

  it("confirms the match against the API, toasts, and refetches the payment list", async () => {
    const user = userEvent.setup();
    const listSpy = vi
      .spyOn(api, "adminListZeffyPayments")
      .mockResolvedValue({ payments: [unmatchedPayment], has_more: false, next_cursor: null });
    vi.spyOn(api, "adminListZeffyPendingClaims").mockResolvedValue(pendingClaims);
    const matchSpy = vi.spyOn(api, "adminMatchZeffyPayment").mockResolvedValue({ payment_id: unmatchedPayment.id, claims: [] });

    wrap();

    await screen.findByText("Alice Donor");
    await user.click(screen.getByRole("button", { name: "Match manually" }));
    await user.click(await screen.findByRole("checkbox", { name: "Match claim 31 (family 3-1)" }));
    await user.click(screen.getByRole("button", { name: "Confirm match" }));

    await waitFor(() => {
      expect(matchSpy).toHaveBeenCalledWith(unmatchedPayment.id, [31]);
    });
    expect(await screen.findByText("Payment matched to 1 claim")).toBeInTheDocument();
    // The list was refetched after the match
    await waitFor(() => expect(listSpy.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  /* ── Unmatch (correction path) ─────────────────────────────── */

  it("shows Unmatch on matched rows only (behind the show-matched toggle)", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminListZeffyPayments").mockResolvedValue({
      payments: [unmatchedPayment, matchedPayment],
      has_more: false,
      next_cursor: null,
    });

    wrap();

    await screen.findByText("Alice Donor");
    // Unmatched row: Match manually, no Unmatch (matched row is hidden anyway)
    expect(screen.getByRole("button", { name: "Match manually" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unmatch" })).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Show matched") as HTMLInputElement);
    await screen.findByText("Bob Buyer");
    expect(screen.getByRole("button", { name: "Unmatch" })).toBeInTheDocument();
    // Still exactly one Match manually (the unmatched row)
    expect(screen.getAllByRole("button", { name: "Match manually" })).toHaveLength(1);
  });

  it("unmatch: cancel closes the dialog without calling the API; confirm calls it, toasts, and refetches", async () => {
    const user = userEvent.setup();
    const listSpy = vi
      .spyOn(api, "adminListZeffyPayments")
      .mockResolvedValue({ payments: [matchedPayment], has_more: false, next_cursor: null });
    const unmatchSpy = vi.spyOn(api, "adminUnmatchZeffyPayment").mockResolvedValue({
      payment_id: matchedPayment.id,
      claim_ids: [12, 13],
    });

    wrap();

    // Matched-only list → unmatched empty state; the toggle reveals the row
    expect(await screen.findByText("No unmatched payments.")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Show matched") as HTMLInputElement);
    await user.click(await screen.findByRole("button", { name: "Unmatch" }));

    // Confirm dialog names the affected claims and requires confirmation
    expect(await screen.findByText("Unmatch this payment?")).toBeInTheDocument();
    expect(screen.getByText(/The 2 matched claims go back to pending with a fresh 48-hour payment window/)).toBeInTheDocument();

    // Cancel: no API call
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Unmatch this payment?")).not.toBeInTheDocument();
    expect(unmatchSpy).not.toHaveBeenCalled();

    // Reopen and confirm
    await user.click(screen.getByRole("button", { name: "Unmatch" }));
    await user.click(await screen.findByRole("button", { name: "Yes, unmatch" }));

    await waitFor(() => expect(unmatchSpy).toHaveBeenCalledWith(matchedPayment.id));
    expect(await screen.findByText("Payment unmatched — 2 claims back to pending")).toBeInTheDocument();
    // The payment list was refetched (the payment is unmatched again now)
    await waitFor(() => expect(listSpy.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("unmatch failure (e.g. a fulfilled claim) toasts the backend error", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminListZeffyPayments").mockResolvedValue({
      payments: [matchedPayment],
      has_more: false,
      next_cursor: null,
    });
    const error = new Error("Request failed");
    (error as unknown as { response: { status: number; data: { detail: string } } }).response = {
      status: 400,
      data: { detail: "Claim 12 is fulfilled — unmatch cannot undo fulfillment" },
    };
    vi.spyOn(api, "adminUnmatchZeffyPayment").mockRejectedValue(error);

    wrap();

    await screen.findByText("No unmatched payments.");
    await user.click(screen.getByLabelText("Show matched") as HTMLInputElement);
    await user.click(await screen.findByRole("button", { name: "Unmatch" }));
    await user.click(await screen.findByRole("button", { name: "Yes, unmatch" }));

    expect(await screen.findByText("Claim 12 is fulfilled — unmatch cannot undo fulfillment")).toBeInTheDocument();
  });
});
