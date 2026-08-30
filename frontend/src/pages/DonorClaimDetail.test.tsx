import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/AuthContext";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import type { FamilyClaimDetail } from "../types";
import DonorClaimDetail from "./DonorClaimDetail";

/* ------------------------------------------------------------------ */
// Fixtures
/* ------------------------------------------------------------------ */

const mockDonorUser = {
  id: 4,
  email: "donor@example.com",
  role: "donor" as const,
  display_name: "Alice Donor",
  referrer_id: null,
  family_id: null,
  created_at: "2025-01-01T00:00:00Z",
};

const mockAdminUser = {
  id: 99,
  email: "admin@example.com",
  role: "admin" as const,
  display_name: "Admin",
  referrer_id: null,
  family_id: null,
  created_at: "2025-01-01T00:00:00Z",
};

const mockClaim: FamilyClaimDetail = {
  id: 1,
  family: {
    id: 5,
    display_id: "2-1",
    bio: "Board game fans",
    person_count: 2,
    min_age: 5,
    max_age: 10,
  },
  commitment_type: "gifts",
  notes: "Please wrap gifts",
  created_at: "2025-11-01T00:00:00Z",
  fulfilled_at: null,
  donor_user_id: 4,
  donor_display_name: "Alice Donor",
  family_wish: {
    id: 10,
    type: "family",
    description: "Family outing",
    size: null,
    color: null,
    assigned_to_id: null,
    purchased_at: null,
    purchased_where: null,
    received_at: null,
    purchaser_note: null,
    deleted_at: null,
  },
  people: [
    {
      given_name: "Sam",
      role: "son",
      age: 8,
      note: null,
      wishes: [
        {
          id: 11,
          type: "practical",
          description: "Socks",
          size: "S",
          color: null,
          assigned_to_id: null,
          purchased_at: null,
          purchased_where: null,
          received_at: null,
          purchaser_note: null,
          deleted_at: null,
        },
      ],
    },
  ],
};

function renderClaim(user: typeof mockDonorUser | typeof mockAdminUser) {
  vi.spyOn(api, "fetchCurrentUser").mockResolvedValue(user);
  vi.spyOn(api, "donorGetClaim").mockResolvedValue(mockClaim);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={["/donor/claims/1"]}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ToastContainer>
            <Routes>
              <Route path="/donor/claims/:id" element={<DonorClaimDetail />} />
            </Routes>
          </ToastContainer>
        </AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

async function openActionsMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "More actions" }));
}

/* ------------------------------------------------------------------ */
// Tests
/* ------------------------------------------------------------------ */

describe("DonorClaimDetail", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the claim details for the owner", async () => {
    renderClaim(mockDonorUser);

    await waitFor(() => {
      expect(screen.getByText("2-1")).toBeInTheDocument();
    });

    expect(screen.getByText("Board game fans")).toBeInTheDocument();
    expect(screen.getByText("Claim Details")).toBeInTheDocument();
    expect(screen.getByText("Please wrap gifts")).toBeInTheDocument();
    // Family wish + member wish
    expect(screen.getByText("Family outing")).toBeInTheDocument();
    // Name cell renders as "<Role label> <given name>"
    expect(screen.getByText("Son Sam")).toBeInTheDocument();
    // Owner does not see a separate Donor row
    expect(screen.queryByText("Donor")).not.toBeInTheDocument();
  });

  it("lets the owner cancel the claim via the confirm dialog", async () => {
    const user = userEvent.setup();
    const cancelSpy = vi.spyOn(api, "donorCancelClaim").mockResolvedValue(undefined);
    renderClaim(mockDonorUser);

    await waitFor(() => {
      expect(screen.getByText("2-1")).toBeInTheDocument();
    });

    await openActionsMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "Cancel Claim" }));
    await user.click(await screen.findByRole("button", { name: "Yes, cancel" }));

    await waitFor(() => {
      expect(cancelSpy).toHaveBeenCalledWith(1);
    });
    expect(await screen.findByText("Claim cancelled")).toBeInTheDocument();
  });

  it("offers Mark Fulfilled to admins instead of Edit Details", async () => {
    const user = userEvent.setup();
    const fulfillSpy = vi.spyOn(api, "donorFulfillClaim").mockResolvedValue(mockClaim);
    renderClaim(mockAdminUser);

    await waitFor(() => {
      expect(screen.getByText("2-1")).toBeInTheDocument();
    });

    // Admin is not the owner — the donor name is shown
    expect(screen.getByText("Donor")).toBeInTheDocument();

    await openActionsMenu(user);
    expect(screen.queryByRole("menuitem", { name: "Edit Details" })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("menuitem", { name: "Mark Fulfilled" }));
    await user.click(await screen.findByRole("button", { name: "Yes, fulfill" }));

    await waitFor(() => {
      expect(fulfillSpy).toHaveBeenCalledWith(1);
    });
  });

  it("marks the family wish as purchased from the dialog", async () => {
    const user = userEvent.setup();
    const markSpy = vi
      .spyOn(api, "donorMarkWishPurchased")
      .mockResolvedValue({ ...mockClaim.family_wish!, purchased_at: "2025-12-01T00:00:00Z" });
    renderClaim(mockDonorUser);

    await waitFor(() => {
      expect(screen.getByText("Family outing")).toBeInTheDocument();
    });

    // One button per active wish (family wish first, then members')
    const markButtons = screen.getAllByRole("button", { name: "Mark purchased" });
    const firstMarkButton = markButtons[0];
    if (!firstMarkButton) throw new Error("mark purchased button not found");
    await user.click(firstMarkButton);
    await user.type(await screen.findByLabelText("Purchased at"), "Target");
    await user.type(screen.getByLabelText("Note"), "Gift card inside");
    await user.click(screen.getByRole("button", { name: "Mark Purchased" }));

    await waitFor(() => {
      expect(markSpy).toHaveBeenCalledWith(1, 10, { purchased_where: "Target", purchaser_note: "Gift card inside" });
    });
  });
});
