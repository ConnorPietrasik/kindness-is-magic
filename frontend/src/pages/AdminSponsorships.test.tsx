import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/AuthContext";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import { auth, familyWishList } from "../lib/queryKeys";
import { formatDateTime } from "../lib/utils";
import { headerUser } from "../test/fixtures";
import type { AdminClaim, AdminClaimsResponse } from "../types";
import AdminSponsorships from "./AdminSponsorships";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const makeQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const wrap = (queryClient: QueryClient = makeQueryClient()) => {
  queryClient.setQueryData(auth, headerUser);
  return render(
    <MemoryRouter initialEntries={["/admin/sponsorships"]}>
      <QueryClientProvider client={queryClient}>
        <ToastContainer>
          <AuthProvider>
            <AdminSponsorships />
          </AuthProvider>
        </ToastContainer>
      </QueryClientProvider>
    </MemoryRouter>
  );
};

function makeClaim(overrides: Partial<AdminClaim> = {}): AdminClaim {
  return {
    id: 1,
    family: { id: 5, display_id: "2-1", bio: null, person_count: 2, min_age: 5, max_age: 10, deleted: false },
    family_name: "The Example Family",
    commitment_type: "gifts",
    payment_status: "paid",
    notes: null,
    created_at: "2025-11-01T00:00:00Z",
    fulfilled_at: null,
    paid_at: null,
    payment_expires_at: null,
    zeffy_payment_id: null,
    includes_groceries: false,
    donor_email: "alice@example.com",
    deleted_at: null,
    ...overrides,
  };
}

const listWith = (...claims: AdminClaim[]): AdminClaimsResponse => ({
  claims,
  total: claims.length,
  page: 1,
  page_size: 50,
  total_pages: claims.length > 0 ? 1 : 0,
});

const emptyList: AdminClaimsResponse = { claims: [], total: 0, page: 1, page_size: 50, total_pages: 0 };

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe("AdminSponsorships", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
    localStorage.clear();
  });

  it("renders active and cancelled rows with donor, family, status and the right action", async () => {
    vi.spyOn(api, "adminListClaims").mockResolvedValue(
      listWith(
        makeClaim({ id: 1, donor_email: "alice@example.com", deleted_at: null }),
        makeClaim({
          id: 2,
          donor_email: "bob@example.com",
          commitment_type: "cash",
          payment_status: "pending",
          family: { id: 6, display_id: "2-2", bio: null, person_count: 3, min_age: 1, max_age: 7, deleted: false },
          family_name: "The Other Family",
          deleted_at: "2025-12-01T09:00:00Z",
        })
      )
    );

    wrap();

    // Active gift row: Active status + View link
    const aliceRow = (await screen.findByText("alice@example.com")).closest("tr")!;
    expect(aliceRow).toHaveTextContent("2-1");
    expect(aliceRow).toHaveTextContent("The Example Family");
    expect(aliceRow).toHaveTextContent("Active");
    expect(within(aliceRow).getByRole("link", { name: "View" })).toHaveAttribute("href", "/donor/claims/1");

    // Cancelled cash row: name + cancellation date + Unpaid + Restore button
    const bobRow = screen.getByText("bob@example.com").closest("tr")!;
    expect(bobRow).toHaveTextContent("2-2");
    expect(bobRow).toHaveTextContent("The Other Family");
    expect(bobRow).toHaveTextContent("Unpaid");
    expect(bobRow).toHaveTextContent(`Cancelled ${formatDateTime("2025-12-01T09:00:00Z")}`);
    expect(within(bobRow).getByRole("button", { name: "Restore" })).toBeInTheDocument();
    expect(within(bobRow).queryByRole("link", { name: "View" })).not.toBeInTheDocument();
  });

  it('shows the raw family ID when the family is non-enumerable (display ID "0")', async () => {
    vi.spyOn(api, "adminListClaims").mockResolvedValue(
      listWith(
        makeClaim({ id: 1, family: { id: 9, display_id: "0", bio: null, person_count: 2, min_age: 5, max_age: 10, deleted: false } })
      )
    );

    wrap();

    const row = (await screen.findByText("alice@example.com")).closest("tr")!;
    expect(row).toHaveTextContent("#9");
  });

  it("shows the empty state when nothing matches", async () => {
    vi.spyOn(api, "adminListClaims").mockResolvedValue(emptyList);

    wrap();

    await waitFor(() => {
      expect(screen.getByText("No sponsorships.")).toBeInTheDocument();
    });
  });

  it("the status filter passes the status param to the API", async () => {
    const user = userEvent.setup();
    const listSpy = vi.spyOn(api, "adminListClaims").mockResolvedValue(emptyList);

    wrap();

    // Wait for the page to finish loading (the select only renders after that)
    await screen.findByRole("combobox", { name: "Sponsorship status filter" });
    expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 }));

    await user.selectOptions(screen.getByRole("combobox", { name: "Sponsorship status filter" }), "cancelled");
    await waitFor(() => {
      expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ status: "cancelled" }));
    });
  });

  it("passes the debounced search to the API", async () => {
    const user = userEvent.setup();
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 50 });
    try {
      const listSpy = vi.spyOn(api, "adminListClaims").mockResolvedValueOnce(emptyList).mockResolvedValue(emptyList);

      wrap();

      await waitFor(() => {
        expect(listSpy).toHaveBeenCalledTimes(1);
      });
      expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ search: undefined, page: 1 }));

      await user.type(screen.getByLabelText("Search by donor email or family name"), "test");
      await waitFor(() => {
        expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ search: "test", page: 1 }));
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("restore is enabled for unpaid cash claims and disabled with a reason otherwise", async () => {
    vi.spyOn(api, "adminListClaims").mockResolvedValue(
      listWith(
        makeClaim({ id: 1, commitment_type: "cash", payment_status: "pending", deleted_at: "2025-12-01T09:00:00Z" }),
        makeClaim({ id: 2, commitment_type: "gifts", deleted_at: "2025-12-01T09:00:00Z" }),
        makeClaim({
          id: 3,
          commitment_type: "cash",
          payment_status: "paid",
          paid_at: "2025-11-20T00:00:00Z",
          deleted_at: "2025-12-01T09:00:00Z",
        })
      )
    );

    wrap();

    const rows = await screen.findAllByRole("button", { name: "Restore" });
    expect(rows).toHaveLength(3);

    expect(rows[0]).toBeEnabled();
    expect(rows[1]).toBeDisabled();
    expect(rows[1]).toHaveAttribute("title", "Gift sponsorships cannot be restored");
    expect(rows[2]).toBeDisabled();
    expect(rows[2]).toHaveAttribute("title", "Paid sponsorships cannot be restored");
  });

  it("restore: confirm calls the API, toasts, and the list refetches", async () => {
    const user = userEvent.setup();
    const queryClient = makeQueryClient();
    // A cached wish-list query for the claim's family — restore must invalidate it
    // (and only it: a control family stays fresh)
    await queryClient.prefetchQuery({ queryKey: familyWishList(5), queryFn: async () => ({ id: 5 }), staleTime: Infinity });
    await queryClient.prefetchQuery({ queryKey: familyWishList(999), queryFn: async () => ({ id: 999 }), staleTime: Infinity });
    vi.spyOn(api, "adminListClaims")
      .mockResolvedValueOnce(
        listWith(makeClaim({ id: 1, commitment_type: "cash", payment_status: "pending", deleted_at: "2025-12-01T09:00:00Z" }))
      )
      .mockResolvedValue(emptyList);
    const restoreSpy = vi
      .spyOn(api, "adminRestoreClaim")
      .mockResolvedValue(makeClaim({ id: 1, commitment_type: "cash", payment_status: "pending" }));

    wrap(queryClient);

    const row = (await screen.findByText("alice@example.com")).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Restore" }));

    // Confirmation dialog names the family and both failure modes
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("The Example Family");
    expect(dialog).toHaveTextContent("If the family was sponsored or deleted in the meantime, the restore will fail.");

    await user.click(within(dialog).getByRole("button", { name: "Restore" }));

    expect(restoreSpy).toHaveBeenCalledTimes(1);
    expect(restoreSpy).toHaveBeenCalledWith(1);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Sponsorship The Example Family restored");
    });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    // Wish list of the restored family invalidated, unrelated family untouched
    expect(queryClient.getQueryState(familyWishList(5))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(familyWishList(999))?.isInvalidated).toBe(false);
    // Refetched list is empty
    await waitFor(() => {
      expect(screen.getByText("No sponsorships.")).toBeInTheDocument();
    });
  });

  it("restore: cancel closes the dialog without calling the API", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminListClaims").mockResolvedValue(
      listWith(makeClaim({ id: 1, commitment_type: "cash", payment_status: "pending", deleted_at: "2025-12-01T09:00:00Z" }))
    );
    const restoreSpy = vi.spyOn(api, "adminRestoreClaim").mockResolvedValue(makeClaim({}));

    wrap();

    const row = (await screen.findByText("alice@example.com")).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Restore" }));

    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(restoreSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
  });
});
