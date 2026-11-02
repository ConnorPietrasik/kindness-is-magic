import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/AuthContext";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import { auth } from "../lib/queryKeys";
import { headerUser } from "../test/fixtures";
import type { InviteListResponse, ReferrerInviteSummary } from "../types";
import AdminInviteCodes from "./AdminInviteCodes";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const emptyListResponse = { invites: [], total: 0, page: 1, page_size: 20, total_pages: 0 };

const hoursFromNow = (hours: number) => new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

const invite = (overrides: Partial<ReferrerInviteSummary> = {}): ReferrerInviteSummary => ({
  id: 1,
  code: "KRI-LIVE01",
  family_limit: 5,
  locked_email: null,
  expires_at: hoursFromNow(24),
  created_at: hoursFromNow(-100),
  created_by_admin_name: "Admin",
  redeemed: false,
  redeemed_by_referrer_name: null,
  referrer_approval_status: null,
  ...overrides,
});

const listWith = (invites: ReferrerInviteSummary[]): InviteListResponse => ({
  ...emptyListResponse,
  invites,
  total: invites.length,
});

const wrap = (path: string) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(auth, headerUser);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={queryClient}>
        <ToastContainer>
          <AuthProvider>
            <AdminInviteCodes />
          </AuthProvider>
        </ToastContainer>
      </QueryClientProvider>
    </MemoryRouter>
  );
};

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe("AdminInviteCodes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
    localStorage.clear();
  });

  it("is list-only: the generator now lives on the referrers page", async () => {
    vi.spyOn(api, "adminListInvites").mockResolvedValue(emptyListResponse);

    wrap("/admin/invite-codes");

    await waitFor(() => {
      expect(screen.getByText("No invite codes found.")).toBeInTheDocument();
    });

    expect(screen.queryByText("Generate Invite Code")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ Generate new" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hide generator" })).not.toBeInTheDocument();
  });

  it("offers Extend (and Revoke) for unredeemed rows only", async () => {
    vi.spyOn(api, "adminListInvites").mockResolvedValue(
      listWith([invite(), invite({ id: 2, code: "KRI-USED01", redeemed: true, redeemed_by_referrer_name: "List Ref" })])
    );

    wrap("/admin/invite-codes");

    await screen.findByText("KRI-LIVE01");
    expect(screen.getAllByRole("button", { name: "Extend" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Revoke" })).toHaveLength(1);
  });

  it("extends an unredeemed code by id, toasts the code, and refetches the list", async () => {
    const user = userEvent.setup();
    const listSpy = vi.spyOn(api, "adminListInvites").mockResolvedValue(listWith([invite({ expires_at: hoursFromNow(-1) })]));
    const extendSpy = vi.spyOn(api, "adminExtendInvite").mockResolvedValue(invite({ expires_at: hoursFromNow(168) }));

    wrap("/admin/invite-codes");

    await user.click(await screen.findByRole("button", { name: "Extend" }));

    expect(extendSpy).toHaveBeenCalledWith(1);
    expect(await screen.findByText(/Invite KRI-LIVE01 extended/)).toBeInTheDocument();
    await waitFor(() => expect(listSpy.mock.calls.length).toBeGreaterThan(1));
  });

  it("badges a lapsed unredeemed expiry, leaving live and redeemed-lapsed rows unbadged", async () => {
    vi.spyOn(api, "adminListInvites").mockResolvedValue(
      listWith([
        invite({ id: 1, code: "KRI-LAPSE1", expires_at: hoursFromNow(-1) }),
        invite({ id: 2, code: "KRI-LIVE02" }),
        invite({ id: 3, code: "KRI-USED02", expires_at: hoursFromNow(-1), redeemed: true, redeemed_by_referrer_name: "Used Ref" }),
      ])
    );

    wrap("/admin/invite-codes");

    await screen.findByText("KRI-LAPSE1");
    expect(screen.getAllByText("Expired")).toHaveLength(1);
  });

  it("keeps the contradictory filters apart: Redeemed only clears and blocks Expired only", async () => {
    const user = userEvent.setup();
    const listSpy = vi.spyOn(api, "adminListInvites").mockResolvedValue(listWith([invite()]));

    wrap("/admin/invite-codes");
    await screen.findByText("KRI-LIVE01");

    await user.click(screen.getByLabelText("Expired only"));
    await waitFor(() => expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ expired: true })));

    await user.click(screen.getByLabelText("Redeemed only"));

    // An expired code is by definition unredeemed, so the pair can only ever
    // return an empty table — the stale filter is dropped, not silently ANDed.
    const expiredOnly = screen.getByLabelText("Expired only");
    expect(expiredOnly).not.toBeChecked();
    expect(expiredOnly).toBeDisabled();
    await waitFor(() => expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ redeemed: true, expired: undefined })));

    // Releasing Redeemed only hands the filter back.
    await user.click(screen.getByLabelText("Redeemed only"));
    expect(screen.getByLabelText("Expired only")).toBeEnabled();
  });
});
