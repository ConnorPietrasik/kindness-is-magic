import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "../lib/api";
import type { ReferrerInviteSummary } from "../types";
import { PendingInvitesSection } from "./PendingInvitesSection";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

function makeInvite(overrides: Partial<ReferrerInviteSummary>): ReferrerInviteSummary {
  return {
    id: 0,
    code: "KRI-TEST01",
    family_limit: 5,
    locked_email: null,
    expires_at: daysFromNow(7),
    created_at: daysFromNow(0),
    created_by_admin_name: "Admin",
    redeemed: false,
    redeemed_by_referrer_name: null,
    referrer_approval_status: null,
    ...overrides,
  };
}

const mockListResponse = {
  invites: [
    makeInvite({ id: 1, code: "KRI-ACTIVE1", locked_email: "waiting@example.com" }),
    makeInvite({ id: 2, code: "KRI-LAPSED1", expires_at: daysFromNow(-1) }),
  ],
  total: 2,
  page: 1,
  page_size: 100,
  total_pages: 1,
};

const renderSection = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={["/admin/referrers"]}>
      <QueryClientProvider client={queryClient}>
        <PendingInvitesSection />
      </QueryClientProvider>
    </MemoryRouter>
  );
};

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe("PendingInvitesSection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("is collapsed by default and expands on toggle", async () => {
    vi.spyOn(api, "adminListInvites").mockResolvedValue(mockListResponse);

    renderSection();

    /* Header is visible; rows are not until expanded */
    expect(screen.getByRole("button", { name: /Pending invites/ })).toBeInTheDocument();
    expect(screen.queryByText("KRI-ACTIVE1")).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Pending invites/ }));

    expect(await screen.findByText("KRI-ACTIVE1")).toBeInTheDocument();
    expect(screen.getByText("KRI-LAPSED1")).toBeInTheDocument();
  });

  it("renders rows with code, locked email (— when null), created and expires", async () => {
    vi.spyOn(api, "adminListInvites").mockResolvedValue(mockListResponse);

    renderSection();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Pending invites/ }));

    await waitFor(() => {
      expect(screen.getByText("KRI-ACTIVE1")).toBeInTheDocument();
    });
    expect(screen.getByText("waiting@example.com")).toBeInTheDocument();
    /* The lapsed row has no locked email → em dash placeholder */
    const lapsedRow = screen.getByText("KRI-LAPSED1").closest("tr")!;
    expect(lapsedRow).toHaveTextContent("—");
  });

  it("flags past-expiry rows with an Expired badge, not future ones", async () => {
    vi.spyOn(api, "adminListInvites").mockResolvedValue(mockListResponse);

    renderSection();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Pending invites/ }));

    await waitFor(() => {
      expect(screen.getByText("KRI-ACTIVE1")).toBeInTheDocument();
    });
    const expiredBadges = screen.getAllByText("Expired");
    expect(expiredBadges).toHaveLength(1);
    /* The badge sits in the lapsed row's cell */
    expect(screen.getByText("KRI-LAPSED1").closest("tr")).toContainElement(expiredBadges[0]!);
  });

  it("shows the count badge only when the total is non-zero", async () => {
    const user = userEvent.setup();
    const listSpy = vi.spyOn(api, "adminListInvites");

    listSpy.mockResolvedValue(mockListResponse);
    const withCount = renderSection();
    /* The count badge renders inside the header button */
    const header = screen.getByRole("button", { name: /Pending invites/ });
    await waitFor(() => {
      expect(within(header).getByText("2")).toBeInTheDocument();
    });
    withCount.unmount();

    listSpy.mockResolvedValue({ invites: [], total: 0, page: 1, page_size: 100, total_pages: 0 });
    renderSection();
    await user.click(screen.getByRole("button", { name: /Pending invites/ }));
    await waitFor(() => {
      expect(screen.getByText("No unredeemed invite codes.")).toBeInTheDocument();
    });
    expect(within(screen.getByRole("button", { name: /Pending invites/ })).queryByText("2")).toBeNull();
  });

  it("shows a failed-to-load indicator in the header when the fetch fails", async () => {
    vi.spyOn(api, "adminListInvites").mockRejectedValue(new Error("boom"));

    renderSection();

    /* Visible in the collapsed header, not only in the expanded body */
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Pending invites/ })).toHaveTextContent("Failed to load");
    });
    /* No count badge — the total is unknown (or stale) while the fetch is failed */
    expect(within(screen.getByRole("button", { name: /Pending invites/ })).queryByText("2")).toBeNull();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Pending invites/ }));
    await waitFor(() => {
      expect(screen.getByText("Could not load pending invites.")).toBeInTheDocument();
    });
  });

  it("links to the invite codes page", async () => {
    vi.spyOn(api, "adminListInvites").mockResolvedValue(mockListResponse);

    renderSection();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Pending invites/ }));

    const link = await screen.findByRole("link", { name: "Manage all invite codes" });
    expect(link).toHaveAttribute("href", "/admin/invite-codes");
  });

  it("queries unredeemed codes on the bare adminInvites key", async () => {
    const listSpy = vi.spyOn(api, "adminListInvites").mockResolvedValue(mockListResponse);

    renderSection();

    await waitFor(() => {
      expect(listSpy).toHaveBeenCalledWith({ page: 1, page_size: 100, redeemed: false });
    });
  });
});
