import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import type { FamilySelfServiceDetail } from "../types";
import FamilyDashboard from "./FamilyDashboard";

/* ------------------------------------------------------------------ */
// Fixtures
/* ------------------------------------------------------------------ */

const familyBase: FamilySelfServiceDetail = {
  id: 5,
  referrer_id: 2,
  referrer_name: "Referrer Ray",
  display_id: "2-1",
  family_name: "The Johnsons",
  bio: "We love board games.",
  address: "123 Main St",
  phone_number: "555-0100",
  family_wish: "A family evening together",
  contact_name: "Alice Johnson",
  deleted_at: null,
  person_count: 3,
  verification_status: "verified",
  pickup_window: null,
  wish_lock_level: "family",
  wish_review_requested_at: null,
  wish_rejection_reason: null,
};

function renderDashboard(family: FamilySelfServiceDetail) {
  vi.spyOn(api, "getFamilyMe").mockResolvedValue(family);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={["/family/dashboard"]}>
      <QueryClientProvider client={queryClient}>
        <ToastContainer>
          <FamilyDashboard />
        </ToastContainer>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

/* ------------------------------------------------------------------ */
// Tests
/* ------------------------------------------------------------------ */

describe("FamilyDashboard", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows the family profile and the people management link", async () => {
    renderDashboard(familyBase);

    await waitFor(() => {
      expect(screen.getByText("Family Dashboard")).toBeInTheDocument();
    });

    expect(screen.getByText("The Johnsons")).toBeInTheDocument();
    expect(screen.getByText("Alice Johnson")).toBeInTheDocument();
    expect(screen.getByText("Manage People")).toBeInTheDocument();
    expect(screen.getByText("A family evening together")).toBeInTheDocument();
  });

  it("requests referrer review via the confirm dialog", async () => {
    const user = userEvent.setup();
    const requestSpy = vi
      .spyOn(api, "requestFamilyReview")
      .mockResolvedValue({ ...familyBase, wish_review_requested_at: "2025-12-01T00:00:00Z" });

    renderDashboard(familyBase);

    await user.click(await screen.findByRole("button", { name: "DONE" }));
    await user.click(await screen.findByRole("button", { name: "Yes, I am done" }));

    await waitFor(() => {
      expect(requestSpy).toHaveBeenCalled();
    });
    expect(await screen.findByText("Review requested")).toBeInTheDocument();
  });

  it("locks editing and the people link when the referrer has locked wishes", async () => {
    renderDashboard({
      ...familyBase,
      wish_lock_level: "admin",
    });

    await waitFor(() => {
      expect(screen.getByText("The Johnsons")).toBeInTheDocument();
    });

    // No edit button, and the manage-people card is disabled
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.getByText("Locked — contact your referrer to request changes")).toBeInTheDocument();
  });
});
