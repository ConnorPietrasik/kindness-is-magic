import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/AuthContext";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import type { Deadline, FamilyClaimSummary, FamilyReviewQueueItem, PendingFamilySummary, ReferrerDetail, User } from "../types";
import { DASHBOARD_TILES } from "../types/tiles";
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
  pickup_window: null,
  family_invite_code: "RAY-1234",
  family_count: 3,
  approval_status: "approved",
  approved_by_admin_name: "Admin",
  approved_at: "2025-01-02T00:00:00Z",
  created_at: "2025-01-01T00:00:00Z",
  deleted_at: null,
  invite_count: 5,
  email: null,
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
  family: { id: 5, display_id: "2-1", bio: null, person_count: 3, min_age: null, max_age: null, deleted: false },
  notes: null,
  created_at: "2025-11-01T00:00:00Z",
  payment_status: "paid" as const,
  paid_at: null,
  payment_expires_at: null,
  zeffy_payment_id: null,
  includes_groceries: false,
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
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("shows queue alert cards for a referrer with pending work", async () => {
    vi.spyOn(api, "getReferrerMe").mockResolvedValue(mockReferrerDetail);
    vi.spyOn(api, "listPendingFamilies").mockResolvedValue([mockPendingFamily, { ...mockPendingFamily, id: 7 }]);
    vi.spyOn(api, "listReferrerReviewQueue").mockResolvedValue([mockQueueItem]);
    vi.spyOn(api, "listDeadlines").mockResolvedValue({ deadlines: [] });

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
    vi.spyOn(api, "listDeadlines").mockResolvedValue({ deadlines: [] });

    renderDashboard(referrerUser);

    // Referrer profile card loads async (name appears in several places)
    await waitFor(() => {
      expect(screen.queryAllByText("Referrer Ray").length).toBeGreaterThan(0);
    });

    expect(screen.queryByText(/awaiting your verification/)).not.toBeInTheDocument();
    expect(screen.queryByText(/awaiting your wish review/)).not.toBeInTheDocument();
  });

  it("shows the referrer's pickup window in the profile card", async () => {
    vi.spyOn(api, "getReferrerMe").mockResolvedValue({ ...mockReferrerDetail, pickup_window: "2025-12-20T10:00:00Z" });
    vi.spyOn(api, "listPendingFamilies").mockResolvedValue([]);
    vi.spyOn(api, "listReferrerReviewQueue").mockResolvedValue([]);
    vi.spyOn(api, "listDeadlines").mockResolvedValue({ deadlines: [] });

    renderDashboard(referrerUser);

    // Referrer profile card loads async
    await waitFor(() => {
      expect(screen.queryAllByText("Referrer Ray").length).toBeGreaterThan(0);
    });
    expect(screen.getByText("Pickup Window")).toBeInTheDocument();
  });

  it("does not offer pickup window editing in the referrer self-form", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "getReferrerMe").mockResolvedValue({ ...mockReferrerDetail, pickup_window: "2025-12-20T10:00:00Z" });
    vi.spyOn(api, "listPendingFamilies").mockResolvedValue([]);
    vi.spyOn(api, "listReferrerReviewQueue").mockResolvedValue([]);
    vi.spyOn(api, "listDeadlines").mockResolvedValue({ deadlines: [] });

    renderDashboard(referrerUser);

    // Referrer profile card loads async
    await waitFor(() => {
      expect(screen.queryAllByText("Referrer Ray").length).toBeGreaterThan(0);
    });

    // The pickup window is admin-set — the self-form must not offer a picker for it
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(document.querySelector('input[type="datetime-local"]')).toBeNull();
  });

  it("shows the wish approval alert for admins", async () => {
    vi.spyOn(api, "listAdminReviewQueue").mockResolvedValue([mockQueueItem, { ...mockQueueItem, id: 8 }]);

    renderDashboard(adminUser);

    expect(await screen.findByText(/2 families awaiting your wish approval/)).toBeInTheDocument();
  });

  it("shows the assigned gifts tile for admins", async () => {
    vi.spyOn(api, "listAdminReviewQueue").mockResolvedValue([]);

    renderDashboard(adminUser);

    const tile = await screen.findByRole("link", { name: /My Assigned Gifts/ });
    expect(tile).toHaveAttribute("href", "/admin/assigned-gifts");
  });

  it("shows the packing and delivery slip tiles for admins", async () => {
    vi.spyOn(api, "listAdminReviewQueue").mockResolvedValue([]);

    renderDashboard(adminUser);

    const packing = await screen.findByRole("link", { name: /Packing Slips/ });
    expect(packing).toHaveAttribute("href", "/admin/packing-slips");
    const delivery = screen.getByRole("link", { name: /Delivery Slips/ });
    expect(delivery).toHaveAttribute("href", "/admin/delivery-slips");
  });

  it("shows the referrer_review deadline banner for referrers only", async () => {
    const deadline: Deadline = {
      id: 1,
      type: "referrer_review",
      label: "Wish review by Dec 15",
      due_date: "2099-12-15",
      mode: "enforced",
      created_at: "2025-01-01T00:00:00Z",
    };
    vi.spyOn(api, "getReferrerMe").mockResolvedValue(mockReferrerDetail);
    vi.spyOn(api, "listPendingFamilies").mockResolvedValue([]);
    vi.spyOn(api, "listReferrerReviewQueue").mockResolvedValue([]);
    vi.spyOn(api, "listDeadlines").mockResolvedValue({ deadlines: [deadline] });

    renderDashboard(referrerUser);

    // The banner text is split across spans (label, "due", date)
    const label = await screen.findByText("Wish review by Dec 15");
    expect(screen.getByText("Dec 15, 2099")).toBeInTheDocument();
    expect(label.closest("div")).toHaveClass("bg-blue-50");

    // Non-referrer roles never render the banner (even with a row configured)
    cleanup();
    vi.spyOn(api, "listAdminReviewQueue").mockResolvedValue([]);
    renderDashboard(adminUser);
    await waitFor(() => {
      expect(screen.getByText("Welcome back!")).toBeInTheDocument();
    });
    expect(screen.queryByText("Wish review by Dec 15")).not.toBeInTheDocument();
  });

  it("shows the gift-claim progress toward the cap for donors", async () => {
    vi.spyOn(api, "donorListClaims").mockResolvedValue([mockActiveGiftClaim, { ...mockActiveGiftClaim, id: 2 }]);

    renderDashboard(donorUser);

    expect(await screen.findByText("2 / 5")).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
// Profile card — display name edit + password change
/* ------------------------------------------------------------------ */

describe("Dashboard — profile card", () => {
  const user = userEvent.setup();

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("keeps the password form collapsed until 'Change password' is clicked", async () => {
    vi.spyOn(api, "listAdminReviewQueue").mockResolvedValue([]);

    renderDashboard(adminUser);

    const changeButton = await screen.findByRole("button", { name: "Change password" });
    expect(screen.queryByLabelText("Current password")).not.toBeInTheDocument();

    await user.click(changeButton);

    expect(screen.getByLabelText("Current password")).toBeInTheDocument();
    expect(screen.getByLabelText("New password")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm new password")).toBeInTheDocument();
  });

  it("changes the password and collapses the form on success", async () => {
    vi.spyOn(api, "listAdminReviewQueue").mockResolvedValue([]);
    vi.spyOn(api, "changePasswordRequest").mockResolvedValue({});
    vi.spyOn(api, "logoutRequest").mockResolvedValue(undefined);

    renderDashboard(adminUser);

    await user.click(await screen.findByRole("button", { name: "Change password" }));
    await user.type(screen.getByLabelText("Current password"), "oldpass1");
    await user.type(screen.getByLabelText("New password"), "newpass123");
    await user.type(screen.getByLabelText("Confirm new password"), "newpass123");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() => {
      expect(api.changePasswordRequest).toHaveBeenCalledWith("oldpass1", "newpass123");
    });

    expect(await screen.findByText("Password updated successfully!")).toBeInTheDocument();
    expect(screen.queryByLabelText("Current password")).not.toBeInTheDocument();

    // Refresh tokens are invalidated on change, so the session is signed out explicitly.
    await waitFor(() => {
      expect(api.logoutRequest).toHaveBeenCalled();
    });
  });

  it("blocks the password change when new and confirm passwords differ", async () => {
    vi.spyOn(api, "listAdminReviewQueue").mockResolvedValue([]);
    const changePasswordSpy = vi.spyOn(api, "changePasswordRequest");

    renderDashboard(adminUser);

    await user.click(await screen.findByRole("button", { name: "Change password" }));
    await user.type(screen.getByLabelText("Current password"), "oldpass1");
    await user.type(screen.getByLabelText("New password"), "newpass123");
    await user.type(screen.getByLabelText("Confirm new password"), "different123");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText("New passwords do not match.")).toBeInTheDocument();
    expect(changePasswordSpy).not.toHaveBeenCalled();
  });

  it("saves the display name via the inline edit", async () => {
    vi.spyOn(api, "listAdminReviewQueue").mockResolvedValue([]);
    vi.spyOn(api, "updateMyProfile").mockResolvedValue({ ...adminUser, display_name: "New Admin Name" });

    renderDashboard(adminUser);

    await user.click(await screen.findByTitle("Edit display name"));
    const input = screen.getByLabelText("Display name");
    await user.clear(input);
    await user.type(input, "New Admin Name");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      // Second arg is React Query's mutation context (mutationFn is passed directly).
      expect(api.updateMyProfile).toHaveBeenCalledWith("New Admin Name", expect.anything());
    });
  });
});

/* ------------------------------------------------------------------ */
// Admin tile drag & reorder
/* ------------------------------------------------------------------ */

describe("Dashboard — admin tile drag", () => {
  // All admin tile keys in registry (default) order.
  const allKeys = (DASHBOARD_TILES.admin ?? []).map((d) => d.key);

  const rect = (left: number, width: number, height = 0) =>
    ({ left, width, height, top: 0, bottom: height, right: left + width, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;

  /** Visible tile labels in grid order (the tiles grid, not the role nav grid). */
  const gridLabels = async (tileName: RegExp) => {
    const tile = await screen.findByRole("link", { name: tileName });
    const grid = tile.closest("div.grid");
    expect(grid).not.toBeNull();
    return Array.from(grid!.children).map((c) => c.textContent);
  };

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders the admin tiles as draggable with a drag hint", async () => {
    vi.spyOn(api, "listAdminReviewQueue").mockResolvedValue([]);

    renderDashboard(adminUser);

    const tile = await screen.findByRole("link", { name: /Manage Referrers/ });
    expect(tile).toHaveAttribute("draggable", "true");
    expect(tile).toHaveAttribute("title", "Drag to reorder");
  });

  it("reflows the grid live while dragging (left half = before, right half = after) and commits on drop", async () => {
    vi.spyOn(api, "listAdminReviewQueue").mockResolvedValue([]);

    renderDashboard(adminUser);

    const wishes = await screen.findByRole("link", { name: /Manage Wishes/ });
    const users = screen.getByRole("link", { name: /Manage Users/ });

    fireEvent.dragStart(wishes, { dataTransfer: {} });

    // Left half of "Manage Users" → the grid reflows immediately, before any
    // drop: "Manage Wishes" now sits where the release will land.
    users.getBoundingClientRect = () => rect(0, 200);
    fireEvent.dragOver(users, { dataTransfer: {} });
    let labels = (await gridLabels(/Manage Wishes/))!;
    expect(labels[0]).toContain("Manage Wishes");
    expect(labels[1]).toContain("Manage Users");

    // jsdom events carry no clientX, so shifting the mocked rect left puts
    // the (0,0) pointer in the right half → "after".
    users.getBoundingClientRect = () => rect(-200, 200);
    fireEvent.dragOver(users, { dataTransfer: {} });
    labels = (await gridLabels(/Manage Wishes/))!;
    expect(labels[1]).toContain("Manage Wishes");
    expect(labels[2]).toContain("Manage Referrers");

    // The preview is local state — nothing persists until the drop.
    expect(localStorage.getItem("kim:dashboardTileOrder:admin")).toBe(JSON.stringify(allKeys));
    fireEvent.drop(users, { dataTransfer: {} });

    const expected = [...allKeys];
    expected.splice(expected.indexOf("wishes"), 1);
    expected.splice(expected.indexOf("referrers"), 0, "wishes"); // "after" Manage Users
    expect(localStorage.getItem("kim:dashboardTileOrder:admin")).toBe(JSON.stringify(expected));
  });

  it("commits the preview when released over the dragged tile's new slot", async () => {
    vi.spyOn(api, "listAdminReviewQueue").mockResolvedValue([]);

    renderDashboard(adminUser);

    const wishes = await screen.findByRole("link", { name: /Manage Wishes/ });
    const users = screen.getByRole("link", { name: /Manage Users/ });

    fireEvent.dragStart(wishes, { dataTransfer: {} });
    users.getBoundingClientRect = () => rect(0, 200);
    fireEvent.dragOver(users, { dataTransfer: {} });

    // After the reflow the cursor typically rests over the dimmed drag tile
    // itself — releasing there must commit, not cancel.
    fireEvent.drop(wishes, { dataTransfer: {} });

    const expected = [...allKeys];
    expected.splice(expected.indexOf("wishes"), 1);
    expected.splice(0, 0, "wishes"); // "before" Manage Users
    expect(localStorage.getItem("kim:dashboardTileOrder:admin")).toBe(JSON.stringify(expected));
  });

  it("reverts the preview when the drag is cancelled (dragEnd without drop)", async () => {
    vi.spyOn(api, "listAdminReviewQueue").mockResolvedValue([]);

    renderDashboard(adminUser);

    const wishes = await screen.findByRole("link", { name: /Manage Wishes/ });
    const users = screen.getByRole("link", { name: /Manage Users/ });

    fireEvent.dragStart(wishes, { dataTransfer: {} });
    users.getBoundingClientRect = () => rect(0, 200);
    fireEvent.dragOver(users, { dataTransfer: {} });
    let labels = (await gridLabels(/Manage Wishes/))!;
    expect(labels[0]).toContain("Manage Wishes");

    fireEvent.dragEnd(wishes);
    labels = (await gridLabels(/Manage Wishes/))!;
    expect(labels[0]).toContain("Manage Users");
    expect(localStorage.getItem("kim:dashboardTileOrder:admin")).toBe(JSON.stringify(allKeys));
  });

  it("is a no-op when a tile is dropped without ever moving", async () => {
    vi.spyOn(api, "listAdminReviewQueue").mockResolvedValue([]);

    renderDashboard(adminUser);

    const wishes = await screen.findByRole("link", { name: /Manage Wishes/ });

    fireEvent.dragStart(wishes, { dataTransfer: {} });
    fireEvent.drop(wishes, { dataTransfer: {} });

    // No dragover ever decided a new slot — storage still holds the default
    // order (written on mount by the persistence effect).
    expect(localStorage.getItem("kim:dashboardTileOrder:admin")).toBe(JSON.stringify(allKeys));
  });

  it("sets the drag image to the grabbed tile only (never the whole grid)", async () => {
    vi.spyOn(api, "listAdminReviewQueue").mockResolvedValue([]);

    renderDashboard(adminUser);

    const wishes = await screen.findByRole("link", { name: /Manage Wishes/ });
    wishes.getBoundingClientRect = () => rect(100, 100, 100);

    const setDragImage = vi.fn();
    // jsdom drag events carry no pointer coordinates, so the handler's
    // center-fallback grabs the tile at its middle (50, 50 for this rect).
    fireEvent.dragStart(wishes, { dataTransfer: { setDragImage } });

    expect(setDragImage).toHaveBeenCalledOnce();
    expect(setDragImage).toHaveBeenCalledWith(wishes as HTMLAnchorElement, 50, 50);
  });

  it("cancels drags that start on the grid background (a guard against giant default drag images)", async () => {
    vi.spyOn(api, "listAdminReviewQueue").mockResolvedValue([]);

    renderDashboard(adminUser);
    await screen.findByRole("link", { name: /Manage Wishes/ });

    const grid = document.querySelector("[data-tile-grid]") as HTMLElement;
    const ev = new Event("dragstart", { bubbles: true, cancelable: true });
    grid.dispatchEvent(ev);

    // The capture guard must have prevented the browser default (which builds
    // the drag image), and no tile drag may have started.
    expect(ev.defaultPrevented).toBe(true);
    expect(document.querySelector(".opacity-50")).toBeNull();
  });

  it("moves a tile one visible step with arrow keys (and prevents page scroll)", async () => {
    vi.spyOn(api, "listAdminReviewQueue").mockResolvedValue([]);

    renderDashboard(adminUser);

    const users = await screen.findByRole("link", { name: /Manage Users/ });

    // fireEvent returns false when the event's default was prevented.
    const notPrevented = fireEvent.keyDown(users, { key: "ArrowRight" });
    expect(notPrevented).toBe(false);

    const labels = (await gridLabels(/Manage Users/))!;
    expect(labels[0]).toContain("Manage Referrers");
    expect(labels[1]).toContain("Manage Users");

    // Non-arrow keys keep their normal behavior (not prevented).
    expect(fireEvent.keyDown(users, { key: "a" })).toBe(true);
  });

  it("restores the tile order AND default-visible set via Reset in the gear popover", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "listAdminReviewQueue").mockResolvedValue([]);
    const customOrder = ["wishes", ...allKeys.filter((k) => k !== "wishes")];
    localStorage.setItem("kim:dashboardTileOrder:admin", JSON.stringify(customOrder));
    // A customized visibility set too, so Reset has both dimensions to restore.
    localStorage.setItem("kim:dashboardTiles:admin", JSON.stringify(allKeys.filter((k) => k !== "users")));

    renderDashboard(adminUser);

    await user.click(await screen.findByRole("button", { name: "Toggle dashboard tiles" }));
    await user.click(screen.getByRole("button", { name: "Reset" }));

    const labels = (await gridLabels(/Manage Users/))!;
    expect(labels[0]).toContain("Manage Users");
    expect(localStorage.getItem("kim:dashboardTileOrder:admin")).toBe(JSON.stringify(allKeys));
    expect(localStorage.getItem("kim:dashboardTiles:admin")).toBe(
      JSON.stringify(allKeys.filter((k) => k !== "csv-upload" && k !== "sponsorships"))
    );
  });
});

/* ------------------------------------------------------------------ */
// Admin tile show/hide
/* ------------------------------------------------------------------ */

describe("Dashboard — admin tiles", () => {
  const user = userEvent.setup();

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("shows the default-visible tiles and the toggle by default (CSV Import hidden)", async () => {
    vi.spyOn(api, "listAdminReviewQueue").mockResolvedValue([]);

    renderDashboard(adminUser);

    const gear = await screen.findByRole("button", { name: "Toggle dashboard tiles" });
    expect(gear).toBeInTheDocument();
    for (const tile of DASHBOARD_TILES.admin ?? []) {
      if (tile.visible) {
        expect(screen.getByRole("link", { name: new RegExp(tile.label) })).toBeInTheDocument();
      } else {
        expect(screen.queryByRole("link", { name: new RegExp(tile.label) })).not.toBeInTheDocument();
      }
    }
  });

  it("enables the default-hidden CSV Import tile and persists the choice", async () => {
    vi.spyOn(api, "listAdminReviewQueue").mockResolvedValue([]);

    renderDashboard(adminUser);

    await user.click(await screen.findByRole("button", { name: "Toggle dashboard tiles" }));
    await user.click(screen.getByRole("checkbox", { name: "CSV Import" }));

    expect(screen.getByRole("link", { name: /CSV Import/ })).toBeInTheDocument();
    const stored = JSON.parse(localStorage.getItem("kim:dashboardTiles:admin") ?? "[]") as string[];
    expect(stored).toContain("csv-upload");
  });

  it("hides a tile when unchecked and persists the choice", async () => {
    vi.spyOn(api, "listAdminReviewQueue").mockResolvedValue([]);

    renderDashboard(adminUser);

    await user.click(await screen.findByRole("button", { name: "Toggle dashboard tiles" }));
    await user.click(screen.getByRole("checkbox", { name: "Manage Users" }));

    expect(screen.queryByRole("link", { name: /Manage Users/ })).not.toBeInTheDocument();
    const stored = JSON.parse(localStorage.getItem("kim:dashboardTiles:admin") ?? "[]") as string[];
    expect(stored).not.toContain("users");
    expect(stored).toContain("wishes");
  });

  it("restores hidden tiles from localStorage on a fresh render", async () => {
    vi.spyOn(api, "listAdminReviewQueue").mockResolvedValue([]);
    localStorage.setItem("kim:dashboardTiles:admin", JSON.stringify(["users", "wishes"]));

    renderDashboard(adminUser);

    await screen.findByRole("button", { name: "Toggle dashboard tiles" });
    expect(screen.getByRole("link", { name: /Manage Users/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Manage Wishes/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Manage Referrers/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Emails/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /CSV Import/ })).not.toBeInTheDocument();
  });

  it("restores the default tiles via Reset (CSV Import stays hidden)", async () => {
    vi.spyOn(api, "listAdminReviewQueue").mockResolvedValue([]);
    localStorage.setItem("kim:dashboardTiles:admin", JSON.stringify(["users", "csv-upload"]));

    renderDashboard(adminUser);

    await user.click(await screen.findByRole("button", { name: "Toggle dashboard tiles" }));
    await user.click(screen.getByRole("button", { name: "Reset" }));

    for (const tile of DASHBOARD_TILES.admin ?? []) {
      if (tile.visible) {
        expect(screen.getByRole("link", { name: new RegExp(tile.label) })).toBeInTheDocument();
      } else {
        expect(screen.queryByRole("link", { name: new RegExp(tile.label) })).not.toBeInTheDocument();
      }
    }
    expect(JSON.parse(localStorage.getItem("kim:dashboardTiles:admin") ?? "[]")).toEqual(
      (DASHBOARD_TILES.admin ?? []).filter((d) => d.visible).map((d) => d.key)
    );
  });

  it.each([
    ["admin", adminUser],
    ["referrer", referrerUser],
    ["family", { ...donorUser, role: "family" } as User],
    ["purchaser", { ...donorUser, role: "purchaser" } as User],
    ["delivery", { ...donorUser, role: "delivery" } as User],
    ["donor", donorUser],
  ] as Array<[string, User]>)("shows the help guide card for the %s role", async (_role, user) => {
    renderDashboard(user);

    /* Match on the card's unique description: the header's Help link also
       matches /Help/ once the auth query resolves */
    const helpCard = await screen.findByRole("link", { name: /Step-by-step guide for your role/ });
    expect(helpCard).toHaveAttribute("href", "/help");
  });

  it("does not show the tile toggle for non-admin roles", async () => {
    vi.spyOn(api, "getReferrerMe").mockResolvedValue(mockReferrerDetail);
    vi.spyOn(api, "listPendingFamilies").mockResolvedValue([]);
    vi.spyOn(api, "listReferrerReviewQueue").mockResolvedValue([]);

    renderDashboard(referrerUser);

    await screen.findByRole("link", { name: /My Families/ });
    expect(screen.queryByRole("button", { name: "Toggle dashboard tiles" })).not.toBeInTheDocument();
  });
});
