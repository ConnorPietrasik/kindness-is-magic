import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import type { FamilyDetail, ReferrerDetail } from "../types";
import AdminReferrerFamilies from "./AdminReferrerFamilies";

/* ------------------------------------------------------------------ */
// Fixtures
/* ------------------------------------------------------------------ */

const mockReferrer: ReferrerDetail = {
  id: 2,
  name: "Referrer Ray",
  family_limit: 10,
  phone_number: "555-0100",
  family_invite_code: "RAY-1234",
  family_count: 1,
  approval_status: "approved",
  approved_by_admin_name: "Admin",
  approved_at: "2025-01-02T00:00:00Z",
  created_at: "2025-01-01T00:00:00Z",
  deleted_at: null,
  invite_count: null,
};

const mockFamily: FamilyDetail = {
  id: 5,
  referrer_id: 2,
  referrer_name: "Referrer Ray",
  delivery_user_id: null,
  delivery_user_name: null,
  display_id: "2-1",
  family_name: "The Johnsons",
  bio: "Board game fans",
  address: "123 Main St",
  phone_number: "555-0100",
  contact_name: "Alice Johnson",
  deleted_at: null,
  person_count: 3,
  verification_status: "verified",
  pickup_window: null,
  wish_lock_level: "family",
  wish_review_requested_at: null,
  wish_rejection_reason: null,
  referrer_notes: null,
  claim_status: null,
  claim_commitment_type: null,
  claim_donor_name: null,
  claim_id: null,
};

function renderPage() {
  vi.spyOn(api, "adminGetReferrer").mockResolvedValue(mockReferrer);
  vi.spyOn(api, "adminListReferrerFamilies").mockResolvedValue({
    families: [mockFamily],
    total: 1,
    page: 1,
    page_size: 50,
    total_pages: 1,
  });
  vi.spyOn(api, "adminGetUsersDropdown").mockResolvedValue([]);

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={["/admin/referrers/2/families"]}>
      <QueryClientProvider client={queryClient}>
        <ToastContainer>
          <Routes>
            <Route path="/admin/referrers/:id/families" element={<AdminReferrerFamilies />} />
          </Routes>
        </ToastContainer>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

/* ------------------------------------------------------------------ */
// Tests
/* ------------------------------------------------------------------ */

describe("AdminReferrerFamilies", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the referrer card and the scoped families table", async () => {
    renderPage();

    expect(screen.getByText("Referrer & Families")).toBeInTheDocument();

    // Referrer card loads async (name appears in the card and the scoped table)
    expect((await screen.findAllByText("Referrer Ray")).length).toBeGreaterThan(0);
    // Family count badge on the card
    expect(await screen.findByText("1 family")).toBeInTheDocument();

    // Families table row
    expect(await screen.findByText("The Johnsons")).toBeInTheDocument();
  });
});
