import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import { pendingFamilies as PENDING_FAMILIES_KEY, referrerFamilies, referrerMe } from "../lib/queryKeys";
import type { FamilyDetail, ReferrerDetail } from "../types";
import ReferrerFamilies from "./ReferrerFamilies";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockReferrer: ReferrerDetail = {
  id: 2,
  name: "Jane Smith",
  family_limit: 5,
  phone_number: "555-0000",
  family_invite_code: "KFI-1234567890",
  family_count: 4,
  approval_status: "approved",
  approved_by_admin_name: "Admin",
  approved_at: "2025-01-01T00:00:00Z",
  created_at: "2025-01-01T00:00:00Z",
  deleted_at: null,
  invite_count: 0,
};

function makeFamily(overrides: Partial<FamilyDetail> & Pick<FamilyDetail, "id" | "family_name">): FamilyDetail {
  return {
    referrer_id: 2,
    referrer_name: "Jane Smith",
    delivery_user_id: null,
    delivery_user_name: null,
    display_id: String(overrides.id),
    bio: "A lovely family",
    address: "123 Main St",
    phone_number: "555-1234-5678",
    family_wish: "A warm blanket",
    contact_name: "Contact",
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
    ...overrides,
  };
}

const familyEditable = makeFamily({ id: 1, family_name: "The Smiths" });
const familyRejectedByAdmin = makeFamily({
  id: 2,
  family_name: "The Joneses",
  wish_lock_level: "referrer",
  wish_rejection_reason: "Please add more details",
});
const familyAwaitingAdmin = makeFamily({ id: 3, family_name: "The Browns", wish_lock_level: "referrer" });
const familyAdminLocked = makeFamily({ id: 4, family_name: "The Greens", wish_lock_level: "admin" });

const allFamilies = [familyEditable, familyRejectedByAdmin, familyAwaitingAdmin, familyAdminLocked];

function listResponse(families: FamilyDetail[]) {
  return { families, total: families.length, page: 1, page_size: 20, total_pages: 1 };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function createQueryClient(families: FamilyDetail[] = allFamilies) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(referrerMe, mockReferrer);
  qc.setQueryData(PENDING_FAMILIES_KEY, []);
  qc.setQueryData(referrerFamilies, listResponse(families));
  return qc;
}

function wrap(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ToastContainer>
        <MemoryRouter initialEntries={["/referrer/families"]}>{children}</MemoryRouter>
      </ToastContainer>
    </QueryClientProvider>
  );
}

function renderPage(families: FamilyDetail[] = allFamilies) {
  const qc = createQueryClient(families);

  vi.spyOn(api, "getReferrerMe").mockResolvedValue(mockReferrer);
  vi.spyOn(api, "listPendingFamilies").mockResolvedValue([]);
  vi.spyOn(api, "listReferrerFamilies").mockResolvedValue(listResponse(families));
  const first = families[0]!;
  vi.spyOn(api, "getReferrerFamily").mockResolvedValue(first);
  vi.spyOn(api, "createReferrerFamily").mockResolvedValue(first);
  vi.spyOn(api, "updateReferrerFamily").mockResolvedValue(first);
  vi.spyOn(api, "deleteReferrerFamily").mockResolvedValue(undefined);
  vi.spyOn(api, "referrerApproveWishes").mockResolvedValue(first);

  render(<ReferrerFamilies />, { wrapper: wrap(qc) });

  return qc;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ReferrerFamilies — Submit for Admin Review", () => {
  beforeEach(() => {
    vi.spyOn(api, "getReferrerMe").mockClear();
    vi.spyOn(api, "listPendingFamilies").mockClear();
    vi.spyOn(api, "listReferrerFamilies").mockClear();
    vi.spyOn(api, "getReferrerFamily").mockClear();
    vi.spyOn(api, "createReferrerFamily").mockClear();
    vi.spyOn(api, "updateReferrerFamily").mockClear();
    vi.spyOn(api, "deleteReferrerFamily").mockClear();
    vi.spyOn(api, "referrerApproveWishes").mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows 'Submit' for family-locked rows and 'Re-submit' for admin-rejected rows only", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Submit" })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Re-submit" })).toBeInTheDocument();

    // Exactly one of each (rows 3 and 4 show neither)
    expect(screen.getAllByRole("button", { name: "Submit" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Re-submit" })).toHaveLength(1);

    // The awaiting-admin and admin-locked rows keep only Manage/Edit/Delete
    const brownRow = screen.getByRole("row", { name: /The Browns/ });
    expect(within(brownRow).queryByRole("button", { name: /submit/i })).not.toBeInTheDocument();
    const greenRow = screen.getByRole("row", { name: /The Greens/ });
    expect(within(greenRow).queryByRole("button", { name: /submit/i })).not.toBeInTheDocument();
  });

  it("shows no submit buttons when all families are locked", async () => {
    renderPage([familyAwaitingAdmin, familyAdminLocked]);

    await waitFor(() => {
      expect(screen.getByRole("row", { name: /The Browns/ })).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /submit/i })).not.toBeInTheDocument();
  });

  it("warns that only an admin can unlock, then calls referrerApproveWishes with the row's DB id", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Submit" }));

    // Confirm dialog names the family and carries the lock warning
    expect(screen.getByText("Submit wishes for admin review?")).toBeInTheDocument();
    expect(screen.getByText(/This will lock the wishes for The Smiths/)).toBeInTheDocument();
    expect(screen.getByText(/only an admin can unlock/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Yes, submit" }));

    // React Query passes a mutation context as the second arg — only the id matters here
    await waitFor(() => {
      expect(api.referrerApproveWishes).toHaveBeenCalledWith(1, expect.anything());
    });
  });

  it("resubmit path calls referrerApproveWishes for the rejected family", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Re-submit" }));

    expect(screen.getByText(/This will re-submit the wishes for The Joneses/)).toBeInTheDocument();
    expect(screen.getByText(/only an admin can unlock/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Yes, submit" }));

    await waitFor(() => {
      expect(api.referrerApproveWishes).toHaveBeenCalledWith(2, expect.anything());
    });
  });

  it("does not call referrerApproveWishes when the dialog is cancelled", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Submit" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(api.referrerApproveWishes).not.toHaveBeenCalled();
  });
});
