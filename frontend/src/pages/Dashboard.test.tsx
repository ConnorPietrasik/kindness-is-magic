import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/AuthContext";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import type { FamilyClaimSummary, FamilyReviewQueueItem, PendingFamilySummary, ReferrerDetail, User } from "../types";
import Dashboard from "./Dashboard";

/* ------------------------------------------------------------------ */
// Fixtures
/* ------------------------------------------------------------------ */

const referrerUser: User = {
  id: 2,
  email: "referrer@example.com",
  role: "referrer",
  display_name: "Referrer Ray",
  referrer_id: 2,
  family_id: null,
  created_at: "2025-01-01T00:00:00Z",
};

const adminUser: User = {
  id: 1,
  email: "admin@example.com",
  role: "admin",
  display_name: "Admin",
  referrer_id: null,
  family_id: null,
  created_at: "2025-01-01T00:00:00Z",
};

const donorUser: User = {
  id: 4,
  email: "donor@example.com",
  role: "donor",
  display_name: "Alice Donor",
  referrer_id: null,
  family_id: null,
  created_at: "2025-01-01T00:00:00Z",
};

const mockReferrerDetail: ReferrerDetail = {
  id: 2,
  name: "Referrer Ray",
  family_limit: 10,
  phone_number: "555-0100",
  family_invite_code: "RAY-1234",
  family_count: 3,
  approval_status: "approved",
  approved_by_admin_name: "Admin",
  approved_at: "2025-01-02T00:00:00Z",
  created_at: "2025-01-01T00:00:00Z",
  deleted_at: null,
  invite_count: 5,
};

const mockPendingFamily: PendingFamilySummary = {
  id: 5,
  display_id: "2-1",
  family_name: "The Johnsons",
  family_wish: "A family evening",
  contact_name: "Alice Johnson",
  verification_status: "pending",
  person_count: 3,
  created_at: "2025-11-01T00:00:00Z",
  pickup_window: null,
};

const mockQueueItem: FamilyReviewQueueItem = {
  id: 6,
  display_id: "2-2",
  family_name: "The Smiths",
  contact_name: "Bob Smith",
  referrer_id: 2,
  referrer_name: "Referrer Ray",
  person_count: 2,
  wish_review_requested_at: "2025-11-02T00:00:00Z",
  wish_rejection_reason: null,
};

const claimBase = {
  family: { id: 5, display_id: "2-1", bio: null, person_count: 3, min_age: null, max_age: null },
  notes: null,
  created_at: "2025-11-01T00:00:00Z",
};

const mockActiveGiftClaim: FamilyClaimSummary = {
  id: 1,
  ...claimBase,
  commitment_type: "gifts",
  fulfilled_at: null,
};

function renderDashboard(user: User) {
  vi.spyOn(api, "fetchCurrentUser").mockResolvedValue(user);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ToastContainer>
            <Dashboard />
          </ToastContainer>
        </AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

/* ------------------------------------------------------------------ */
// Tests
/* ------------------------------------------------------------------ */

describe("Dashboard", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows queue alert cards for a referrer with pending work", async () => {
    vi.spyOn(api, "getReferrerMe").mockResolvedValue(mockReferrerDetail);
    vi.spyOn(api, "listPendingFamilies").mockResolvedValue([mockPendingFamily, { ...mockPendingFamily, id: 7 }]);
    vi.spyOn(api, "listReferrerReviewQueue").mockResolvedValue([mockQueueItem]);

    renderDashboard(referrerUser);

    // Amber verification alert with pluralized count
    expect(await screen.findByText("2 families awaiting your verification →")).toBeInTheDocument();
    // Blue wish-review alert (singular)
    expect(screen.getByText("1 family awaiting your wish review →")).toBeInTheDocument();
  });

  it("hides the queue alerts when everything is clear", async () => {
    vi.spyOn(api, "getReferrerMe").mockResolvedValue(mockReferrerDetail);
    vi.spyOn(api, "listPendingFamilies").mockResolvedValue([]);
    vi.spyOn(api, "listReferrerReviewQueue").mockResolvedValue([]);

    renderDashboard(referrerUser);

    // Referrer profile card loads async (name appears in several places)
    await waitFor(() => {
      expect(screen.queryAllByText("Referrer Ray").length).toBeGreaterThan(0);
    });

    expect(screen.queryByText(/awaiting your verification/)).not.toBeInTheDocument();
    expect(screen.queryByText(/awaiting your wish review/)).not.toBeInTheDocument();
  });

  it("shows the wish approval alert for admins", async () => {
    vi.spyOn(api, "listAdminReviewQueue").mockResolvedValue([mockQueueItem, { ...mockQueueItem, id: 8 }]);

    renderDashboard(adminUser);

    expect(await screen.findByText(/2 families awaiting your wish approval/)).toBeInTheDocument();
  });

  it("shows the gift-claim progress toward the cap for donors", async () => {
    vi.spyOn(api, "donorListClaims").mockResolvedValue([mockActiveGiftClaim, { ...mockActiveGiftClaim, id: 2 }]);

    renderDashboard(donorUser);

    expect(await screen.findByText("2 / 5")).toBeInTheDocument();
  });
});
