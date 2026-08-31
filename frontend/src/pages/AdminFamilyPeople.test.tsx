import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import type { FamilyDetail, PersonDetail } from "../types";
import AdminFamilyPeople from "./AdminFamilyPeople";

/* ------------------------------------------------------------------ */
// Fixtures
/* ------------------------------------------------------------------ */

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
  person_count: 1,
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

const mockPerson: PersonDetail = {
  id: 11,
  family_id: 5,
  display_id: "2-1-1",
  given_name: "Sam",
  role: "son",
  age: 8,
  note: "Likes blue",
  created_at: "2025-11-01T00:00:00Z",
  deleted_at: null,
  wishes: [],
};

function renderPage(familyOverrides: Partial<FamilyDetail> = {}) {
  const family = { ...mockFamily, ...familyOverrides };
  vi.spyOn(api, "adminGetFamily").mockResolvedValue(family);
  vi.spyOn(api, "adminListFamilyPeople").mockResolvedValue({
    people: [mockPerson],
    total: 1,
    page: 1,
    page_size: 50,
    total_pages: 1,
  });
  vi.spyOn(api, "adminGetReferrersDropdown").mockResolvedValue([]);
  vi.spyOn(api, "adminGetUsersDropdown").mockResolvedValue([]);

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={["/admin/families/5/people"]}>
      <QueryClientProvider client={queryClient}>
        <ToastContainer>
          <Routes>
            <Route path="/admin/families/:id/people" element={<AdminFamilyPeople />} />
          </Routes>
        </ToastContainer>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

/* ------------------------------------------------------------------ */
// Tests
/* ------------------------------------------------------------------ */

describe("AdminFamilyPeople", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the family card and the people table", async () => {
    renderPage();

    expect(screen.getByText("Family & People")).toBeInTheDocument();

    // Family card loads async — wait for it (name appears in the card header and info row)
    expect((await screen.findAllByText("The Johnsons")).length).toBeGreaterThan(0);
    // Card header renders "Referrer: <name>" as one element
    expect(await screen.findByText("Referrer: Referrer Ray")).toBeInTheDocument();

    // People table row (ID/Name/Age/Wishes visible by default)
    expect(await screen.findByText("Sam")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    // Note column is hidden by default (adminPeople column visibility)
    expect(screen.queryByText("Likes blue")).not.toBeInTheDocument();
  });

  it("shows the Fully Approve button for non-admin-locked families", async () => {
    renderPage();

    await screen.findAllByText("The Johnsons");
    expect(screen.getByRole("button", { name: "Fully Approve" })).toBeInTheDocument();
  });

  it("hides Fully Approve and shows Wish List for admin-locked families", async () => {
    renderPage({ wish_lock_level: "admin" });

    await screen.findAllByText("The Johnsons");
    expect(screen.queryByRole("button", { name: "Fully Approve" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Wish List" })).toBeInTheDocument();
  });

  it("fully approve flow confirms and calls API", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminApproveWishes").mockResolvedValue({ ...mockFamily, wish_lock_level: "admin" });
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Fully Approve" }));
    await user.click(await screen.findByRole("button", { name: "Yes, fully approve" }));

    await waitFor(() => {
      expect(api.adminApproveWishes).toHaveBeenCalledWith(mockFamily.id);
    });
    await waitFor(() => {
      expect(screen.getByText("Family fully approved and visible to donors")).toBeInTheDocument();
    });
  });
});
