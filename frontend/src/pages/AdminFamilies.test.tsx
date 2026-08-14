import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import type { FamilyDetail, FamilyListResponse, ReferrerDropdownItem, UserDropdownItem } from "../types";
import AdminFamilies from "./AdminFamilies";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const mockReferrer: ReferrerDropdownItem = { id: 1, name: "Hope Referrer" };
const mockDeliveryUser: UserDropdownItem = { id: 7, display_name: "Delivery Dan" };

function makeFamily(overrides: Partial<FamilyDetail>): FamilyDetail {
  return {
    id: 0,
    referrer_id: 1,
    referrer_name: "Hope Referrer",
    delivery_user_id: null,
    delivery_user_name: null,
    display_id: null,
    family_name: "The Default",
    bio: null,
    address: null,
    phone_number: "",
    family_wish: "",
    contact_name: "",
    deleted_at: null,
    person_count: 0,
    approval_status: "approved",
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

// Family-locked: "Reset Lock" hidden, "Fully Approve" shown, edit without confirmation
const mockFamily1 = makeFamily({
  id: 1,
  display_id: "F-101",
  family_name: "The Johnsons",
  contact_name: "Jane Johnson",
  family_wish: "A new bed",
  phone_number: "5551234567",
});

// Admin-locked: "Fully Approve" hidden, "Reset Lock" shown, edit requires confirmation
const mockFamily2 = makeFamily({
  id: 2,
  display_id: "F-102",
  family_name: "The Smiths",
  contact_name: "Sam Smith",
  family_wish: "A tent",
  phone_number: "5557654321",
  wish_lock_level: "admin",
});

const mockFamilyDeleted = makeFamily({
  id: 3,
  display_id: "F-103",
  family_name: "The Gones",
  contact_name: "Ghost G",
  family_wish: "Nothing",
  deleted_at: "2025-02-02T00:00:00Z",
});

const mockListResponse: FamilyListResponse = {
  families: [mockFamily1, mockFamily2],
  total: 2,
  page: 1,
  page_size: 20,
  total_pages: 1,
};

const mockDeletedResponse: FamilyListResponse = {
  families: [mockFamilyDeleted],
  total: 1,
  page: 1,
  page_size: 20,
  total_pages: 1,
};

const createQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const wrap = (ui: React.ReactElement) => {
  const queryClient = createQueryClient();
  return render(
    <MemoryRouter initialEntries={["/admin/families"]}>
      <QueryClientProvider client={queryClient}>
        <ToastContainer>{ui}</ToastContainer>
      </QueryClientProvider>
    </MemoryRouter>
  );
};

function mockListApis() {
  vi.spyOn(api, "adminListFamilies").mockResolvedValue(mockListResponse);
  vi.spyOn(api, "adminListDeletedFamilies").mockResolvedValue(mockDeletedResponse);
  vi.spyOn(api, "adminGetReferrersDropdown").mockResolvedValue([mockReferrer]);
  vi.spyOn(api, "adminGetUsersDropdown").mockResolvedValue([mockDeliveryUser]);
}

/** Opens the kebab dropdown for the given row (0-based) and returns the menu. */
async function openRowMenu(user: ReturnType<typeof userEvent.setup>, row: number) {
  const triggers = screen.getAllByRole("button", { name: "More actions" });
  await user.click(triggers[row]!);
  return screen.getByRole("menu");
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe("AdminFamilies", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
    localStorage.clear();
  });

  it("renders loading state initially", () => {
    vi.spyOn(api, "adminListFamilies").mockReturnValue(new Promise(() => {}));
    vi.spyOn(api, "adminGetReferrersDropdown").mockResolvedValue([]);
    vi.spyOn(api, "adminGetUsersDropdown").mockResolvedValue([]);

    wrap(<AdminFamilies />);
    expect(document.querySelector("svg.animate-spin")).toBeInTheDocument();
  });

  it("renders family list with mocked data", async () => {
    mockListApis();

    wrap(<AdminFamilies />);

    await waitFor(() => {
      expect(screen.getByText("The Johnsons")).toBeInTheDocument();
    });

    expect(screen.getByText("The Smiths")).toBeInTheDocument();
    expect(screen.getByText("Jane Johnson")).toBeInTheDocument();
    expect(screen.getByText("A new bed")).toBeInTheDocument();
    // Referrer name renders as a link on each row
    expect(screen.getAllByText("Hope Referrer")).toHaveLength(2);
    // Manage + Edit actions on active families
    expect(screen.getAllByText("Manage")).toHaveLength(2);
    expect(screen.getAllByText("Edit")).toHaveLength(2);
  });

  it("shows empty state when no families", async () => {
    vi.spyOn(api, "adminListFamilies").mockResolvedValue({ families: [], total: 0, page: 1, page_size: 20, total_pages: 0 });
    vi.spyOn(api, "adminGetReferrersDropdown").mockResolvedValue([]);
    vi.spyOn(api, "adminGetUsersDropdown").mockResolvedValue([]);

    wrap(<AdminFamilies />);

    await waitFor(() => {
      expect(screen.getByText("No families yet.")).toBeInTheDocument();
    });
  });

  it("switches to Deleted tab and fetches deleted families", async () => {
    const user = userEvent.setup();
    mockListApis();

    wrap(<AdminFamilies />);

    await waitFor(() => {
      expect(screen.getByText("The Johnsons")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("tab", { name: "Deleted" }));

    await waitFor(() => {
      expect(api.adminListDeletedFamilies).toHaveBeenCalled();
    });

    expect(screen.getByText("The Gones")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument();
    // Create button is hidden in the deleted view
    expect(screen.queryByRole("button", { name: "+ Add Family" })).not.toBeInTheDocument();
  });

  it("restore flow confirms, calls API, and shows toast", async () => {
    const user = userEvent.setup();
    mockListApis();
    vi.spyOn(api, "adminRestoreFamily").mockResolvedValue(makeFamily({ id: 3, family_name: "The Gones", deleted_at: null }));

    wrap(<AdminFamilies />);

    await waitFor(() => {
      expect(screen.getByText("The Johnsons")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("tab", { name: "Deleted" }));

    await waitFor(() => {
      expect(screen.getByText("The Gones")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Restore" }));

    await waitFor(() => {
      expect(screen.getByText(/Restore family/)).toBeInTheDocument();
    });
    expect(api.adminRestoreFamily).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Yes, restore" }));

    await waitFor(() => {
      expect(api.adminRestoreFamily).toHaveBeenCalledWith(3, expect.anything());
    });
    await waitFor(() => {
      expect(screen.getByText("Family restored")).toBeInTheDocument();
    });
  });

  it("delete flow opens confirm dialog and calls API", async () => {
    const user = userEvent.setup();
    mockListApis();
    vi.spyOn(api, "adminDeleteFamily").mockResolvedValue(undefined);

    wrap(<AdminFamilies />);

    await waitFor(() => {
      expect(screen.getByText("The Johnsons")).toBeInTheDocument();
    });

    const menu = await openRowMenu(user, 0);
    await user.click(within(menu).getByRole("menuitem", { name: "Delete" }));

    await waitFor(() => {
      expect(screen.getByText(/Delete family/)).toBeInTheDocument();
    });
    expect(api.adminDeleteFamily).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Yes, delete" }));

    await waitFor(() => {
      expect(api.adminDeleteFamily).toHaveBeenCalledWith(1, expect.anything());
    });
    await waitFor(() => {
      expect(screen.getByText("Family deleted")).toBeInTheDocument();
    });
  });

  it("editing an admin-locked family requires confirmation before update", async () => {
    const user = userEvent.setup();
    mockListApis();
    vi.spyOn(api, "adminGetFamily").mockImplementation((id: number) => Promise.resolve(id === 1 ? mockFamily1 : mockFamily2));
    vi.spyOn(api, "adminUpdateFamily").mockResolvedValue(makeFamily({ ...mockFamily2, family_name: "The Smiths Updated" }));

    wrap(<AdminFamilies />);

    await waitFor(() => {
      expect(screen.getByText("The Smiths")).toBeInTheDocument();
    });

    // Row 1 = The Smiths (admin-locked)
    const editButtons = screen.getAllByText("Edit");
    await user.click(editButtons[1]!);

    await waitFor(() => {
      expect(screen.getByText(/Edit Family #F-102/)).toBeInTheDocument();
    });

    const nameInput = screen.getByLabelText("Family Name");
    await user.clear(nameInput);
    await user.type(nameInput, "The Smiths Updated");
    await user.click(screen.getByRole("button", { name: "Update" }));

    // Confirmation dialog appears before the update fires
    await waitFor(() => {
      expect(screen.getByText(/Edit admin-approved family\?/)).toBeInTheDocument();
    });
    expect(api.adminUpdateFamily).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Yes, update" }));

    await waitFor(() => {
      expect(api.adminUpdateFamily).toHaveBeenCalledWith(2, { family_name: "The Smiths Updated" });
    });
    await waitFor(() => {
      expect(screen.getByText("Family updated")).toBeInTheDocument();
    });
  });

  it("canceling the lock-edit confirmation does not call update", async () => {
    const user = userEvent.setup();
    mockListApis();
    vi.spyOn(api, "adminGetFamily").mockImplementation((id: number) => Promise.resolve(id === 1 ? mockFamily1 : mockFamily2));
    vi.spyOn(api, "adminUpdateFamily").mockResolvedValue(mockFamily2);

    wrap(<AdminFamilies />);

    await waitFor(() => {
      expect(screen.getByText("The Smiths")).toBeInTheDocument();
    });

    const editButtons = screen.getAllByText("Edit");
    await user.click(editButtons[1]!);

    await waitFor(() => {
      expect(screen.getByText(/Edit Family #F-102/)).toBeInTheDocument();
    });

    const nameInput = screen.getByLabelText("Family Name");
    await user.clear(nameInput);
    await user.type(nameInput, "The Smiths Updated");
    await user.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => {
      expect(screen.getByText(/Edit admin-approved family\?/)).toBeInTheDocument();
    });

    // The confirm overlay is rendered on top of the still-open edit form, which
    // has its own Cancel button — scope to the overlay.
    const confirmOverlay = screen.getByText(/Edit admin-approved family\?/).closest<HTMLDivElement>("div.fixed");
    expect(confirmOverlay).not.toBeNull();
    await user.click(within(confirmOverlay!).getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByText(/Edit admin-approved family\?/)).not.toBeInTheDocument();
    });
    expect(api.adminUpdateFamily).not.toHaveBeenCalled();
  });

  it("editing an unlocked family updates without confirmation", async () => {
    const user = userEvent.setup();
    mockListApis();
    vi.spyOn(api, "adminGetFamily").mockImplementation((id: number) => Promise.resolve(id === 1 ? mockFamily1 : mockFamily2));
    vi.spyOn(api, "adminUpdateFamily").mockResolvedValue(makeFamily({ ...mockFamily1, family_name: "The Johnsons 2" }));

    wrap(<AdminFamilies />);

    await waitFor(() => {
      expect(screen.getByText("The Johnsons")).toBeInTheDocument();
    });

    // Row 0 = The Johnsons (family-locked)
    const editButtons = screen.getAllByText("Edit");
    await user.click(editButtons[0]!);

    await waitFor(() => {
      expect(screen.getByText(/Edit Family #F-101/)).toBeInTheDocument();
    });

    const nameInput = screen.getByLabelText("Family Name");
    await user.clear(nameInput);
    await user.type(nameInput, "The Johnsons 2");
    await user.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => {
      expect(api.adminUpdateFamily).toHaveBeenCalledWith(1, { family_name: "The Johnsons 2" });
    });
    expect(screen.queryByText(/Edit admin-approved family\?/)).not.toBeInTheDocument();
  });

  it("dropdown items respect the wish lock level", async () => {
    const user = userEvent.setup();
    mockListApis();

    wrap(<AdminFamilies />);

    await waitFor(() => {
      expect(screen.getByText("The Johnsons")).toBeInTheDocument();
    });

    // Row 0 — family lock: "Reset Lock" hidden, "Fully Approve" shown
    let menu = await openRowMenu(user, 0);
    expect(within(menu).queryByRole("menuitem", { name: "Reset Lock" })).not.toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Fully Approve" })).toBeInTheDocument();

    const triggers = screen.getAllByRole("button", { name: "More actions" });
    await user.click(triggers[0]!); // close
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    // Row 1 — admin lock: "Reset Lock" shown, "Fully Approve" hidden
    menu = await openRowMenu(user, 1);
    expect(within(menu).getByRole("menuitem", { name: "Reset Lock" })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "Fully Approve" })).not.toBeInTheDocument();
  });

  it("fully approve flow confirms and calls API", async () => {
    const user = userEvent.setup();
    mockListApis();
    vi.spyOn(api, "adminApproveWishes").mockResolvedValue(mockFamily1);

    wrap(<AdminFamilies />);

    await waitFor(() => {
      expect(screen.getByText("The Johnsons")).toBeInTheDocument();
    });

    const menu = await openRowMenu(user, 0);
    await user.click(within(menu).getByRole("menuitem", { name: "Fully Approve" }));

    await waitFor(() => {
      expect(screen.getByText(/Fully approve family/)).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Yes, fully approve" }));

    await waitFor(() => {
      expect(api.adminApproveWishes).toHaveBeenCalledWith(1, expect.anything());
    });
    await waitFor(() => {
      expect(screen.getByText("Family fully approved and visible to donors")).toBeInTheDocument();
    });
  });

  it("reset lock flow confirms and calls API", async () => {
    const user = userEvent.setup();
    mockListApis();
    vi.spyOn(api, "adminResetWishState").mockResolvedValue(mockFamily2);

    wrap(<AdminFamilies />);

    await waitFor(() => {
      expect(screen.getByText("The Smiths")).toBeInTheDocument();
    });

    const menu = await openRowMenu(user, 1);
    await user.click(within(menu).getByRole("menuitem", { name: "Reset Lock" }));

    await waitFor(() => {
      expect(screen.getByText(/Reset wish lock/)).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Yes, reset" }));

    await waitFor(() => {
      expect(api.adminResetWishState).toHaveBeenCalledWith(2, expect.anything());
    });
    await waitFor(() => {
      expect(screen.getByText("Wish lock reset — family can now edit their wishes")).toBeInTheDocument();
    });
  });

  it("person count header cycles sort asc/desc", async () => {
    const user = userEvent.setup();
    mockListApis();

    // Person Count column is hidden by default — seed column visibility
    localStorage.setItem(
      "kim:columns:adminFamilies",
      JSON.stringify(["display_id", "family_name", "family_wish", "contact_name", "referrer_id", "person_count"])
    );

    wrap(<AdminFamilies />);

    await waitFor(() => {
      expect(screen.getByText("The Johnsons")).toBeInTheDocument();
    });

    const sortButton = screen.getByRole("button", { name: /Person Count/ });
    await user.click(sortButton);

    await waitFor(() => {
      expect(api.adminListFamilies).toHaveBeenLastCalledWith(expect.objectContaining({ sort: "person_count" }));
    });

    await user.click(screen.getByRole("button", { name: /Person Count/ }));

    await waitFor(() => {
      expect(api.adminListFamilies).toHaveBeenLastCalledWith(expect.objectContaining({ sort: "-person_count" }));
    });
  });

  it("create family flow calls API with form values", async () => {
    const user = userEvent.setup();
    mockListApis();
    vi.spyOn(api, "adminCreateFamily").mockImplementation((data: Parameters<typeof api.adminCreateFamily>[0]) =>
      Promise.resolve(makeFamily({ ...mockFamily1, ...data }))
    );

    wrap(<AdminFamilies />);

    await waitFor(() => {
      expect(screen.getByText("The Johnsons")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "+ Add Family" }));

    await waitFor(() => {
      expect(screen.getByText("Add Family")).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("Family Name"), "The Browns");
    await user.type(screen.getByLabelText("Contact Name"), "Bob Brown");
    await user.type(screen.getByLabelText("Family Wish"), "Toys");
    await user.type(screen.getByPlaceholderText("555-123-4567"), "5559998888");

    // Referrer select is required on create
    const referrerSelect = screen.getByLabelText("Referrer") as HTMLSelectElement;
    await user.selectOptions(referrerSelect, "1");

    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(api.adminCreateFamily).toHaveBeenCalledWith(
        expect.objectContaining({
          family_name: "The Browns",
          contact_name: "Bob Brown",
          family_wish: "Toys",
          phone_number: "5559998888",
          referrer_id: 1,
        }),
        expect.anything()
      );
    });
  });
});
