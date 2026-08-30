import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FamilyDetail } from "../types";
import { FamilyTableRow, type FamilyTableRowProps } from "./FamilyTableRow";

const ALL_COLUMNS = [
  "display_id",
  "family_name",
  "family_wish",
  "contact_name",
  "referrer_id",
  "delivery",
  "claim",
  "phone_number",
  "person_count",
  "verification_status",
  "pickup_window",
  "wish_lock_level",
  "wish_review_requested_at",
  "wish_rejection_reason",
];

function makeFamily(overrides: Partial<FamilyDetail> = {}): FamilyDetail {
  return {
    id: 1,
    referrer_id: 1,
    referrer_name: "Hope Referrer",
    delivery_user_id: null,
    delivery_user_name: null,
    display_id: "1-1",
    family_name: "The Johnsons",
    bio: null,
    address: "123 Main St",
    phone_number: "5551234567",
    family_wish: "A new bed",
    contact_name: "Jane Johnson",
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

function renderRow(props: Partial<FamilyTableRowProps> = {}) {
  const callbacks = {
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onRestore: vi.fn(),
    onResetLock: vi.fn(),
    onFullyApprove: vi.fn(),
    onViewPackingSlip: vi.fn(),
  };
  const utils = render(
    <MemoryRouter>
      <table>
        <tbody>
          <tr>
            <FamilyTableRow
              family={makeFamily()}
              visibleColumns={ALL_COLUMNS}
              isDeletedView={false}
              isEditing={false}
              isDeleting={false}
              isRestoring={false}
              isLockActionPending={false}
              {...callbacks}
              {...props}
            />
          </tr>
        </tbody>
      </table>
    </MemoryRouter>
  );
  return { callbacks, user: userEvent.setup(), ...utils };
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "More actions" }));
  return screen.getByRole("menu");
}

describe("FamilyTableRow", () => {
  afterEach(() => cleanup());

  it("renders the visible columns", () => {
    renderRow();

    expect(screen.getByText("The Johnsons")).toBeInTheDocument();
    expect(screen.getByText("A new bed")).toBeInTheDocument();
    expect(screen.getByText("Jane Johnson")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("omits hidden columns", () => {
    renderRow({ visibleColumns: ["display_id", "family_name", "contact_name"] });

    expect(screen.getByText("The Johnsons")).toBeInTheDocument();
    expect(screen.queryByText("A new bed")).not.toBeInTheDocument();
    expect(screen.queryByText("3")).not.toBeInTheDocument();
  });

  it("shows Manage and Edit for an active family", () => {
    renderRow();

    expect(screen.getByRole("link", { name: "Manage" })).toHaveAttribute("href", "/admin/families/1/people");
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("appends ?from=referrer to Manage when fromReferrer is set", () => {
    renderRow({ fromReferrer: true });

    expect(screen.getByRole("link", { name: "Manage" })).toHaveAttribute("href", "/admin/families/1/people?from=referrer");
  });

  it("family-locked row: Fully Approve shown, Reset Lock hidden, no packing slip by default", async () => {
    const { user } = renderRow();

    const menu = await openMenu(user);
    expect(within(menu).getByRole("menuitem", { name: "Fully Approve" })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "Reset Lock" })).not.toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "View Packing Slip" })).not.toBeInTheDocument();
  });

  it("admin-locked row: Reset Lock shown, Fully Approve hidden, wish-list link present", async () => {
    const { user } = renderRow({ family: makeFamily({ wish_lock_level: "admin" }) });

    expect(screen.getByRole("link", { name: "Wish List" })).toBeInTheDocument();

    const menu = await openMenu(user);
    expect(within(menu).getByRole("menuitem", { name: "Reset Lock" })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "Fully Approve" })).not.toBeInTheDocument();
  });

  it("shows View Packing Slip and calls the callback when enabled", async () => {
    const { user, callbacks } = renderRow({ showPackingSlipAction: true });

    const menu = await openMenu(user);
    await user.click(within(menu).getByRole("menuitem", { name: "View Packing Slip" }));

    expect(callbacks.onViewPackingSlip).toHaveBeenCalledWith(1);
  });

  it("menu callbacks fire for delete, reset lock, and fully approve", async () => {
    const { user, callbacks } = renderRow({ family: makeFamily({ wish_lock_level: "referrer" }) });

    const menu = await openMenu(user);
    await user.click(within(menu).getByRole("menuitem", { name: "Fully Approve" }));
    expect(callbacks.onFullyApprove).toHaveBeenCalledWith(1);

    await user.click(screen.getByRole("button", { name: "More actions" }));
    const menu2 = screen.getByRole("menu");
    await user.click(within(menu2).getByRole("menuitem", { name: "Reset Lock" }));
    expect(callbacks.onResetLock).toHaveBeenCalledWith(1);

    await user.click(screen.getByRole("button", { name: "More actions" }));
    const menu3 = screen.getByRole("menu");
    await user.click(within(menu3).getByRole("menuitem", { name: "Delete" }));
    expect(callbacks.onDelete).toHaveBeenCalledWith(1);
  });

  it("deleted view shows only Restore", () => {
    renderRow({ family: makeFamily({ deleted_at: "2025-02-02T00:00:00Z" }), isDeletedView: true });

    expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Manage" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More actions" })).not.toBeInTheDocument();
  });

  it("links the claim badge to the claim detail when claimed", () => {
    renderRow({
      family: makeFamily({
        claim_status: "active",
        claim_commitment_type: "full",
        claim_donor_name: "Donor Dan",
        claim_id: 5,
      }),
    });

    const link = screen.getByRole("link", { name: /active — full/ });
    expect(link).toHaveAttribute("href", "/donor/claims/5");
    expect(link).toHaveTextContent("(Donor Dan)");
  });

  it("shows an em dash in the claim cell when unclaimed", () => {
    renderRow({ visibleColumns: ["claim"] });

    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("falls back to the referrer map when referrer_name is missing", () => {
    renderRow({
      family: makeFamily({ referrer_name: null }),
      referrerMap: { 1: "Map Referrer" },
    });

    const link = screen.getByRole("link", { name: "Map Referrer" });
    expect(link).toHaveAttribute("href", "/admin/referrers/1/families");
  });

  it("falls back to the referrer id when there is no map", () => {
    renderRow({
      family: makeFamily({ referrer_name: null }),
      visibleColumns: ["display_id", "family_name", "referrer_id"],
    });

    const link = screen.getByRole("link", { name: "ID 1" });
    expect(link).toHaveAttribute("href", "/admin/referrers/1/families");
  });
});
