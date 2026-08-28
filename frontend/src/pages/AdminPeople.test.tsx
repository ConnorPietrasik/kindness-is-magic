import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import type { FamilyDetail, FamilyDropdownItem, PersonDetail, PersonListResponse, WishSummary } from "../types";
import AdminPeople from "./AdminPeople";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function makeWish(overrides: Partial<WishSummary>): WishSummary {
  return {
    id: 0,
    type: "practical",
    description: "A wish",
    size: null,
    assigned_to_id: null,
    purchased_at: null,
    purchased_where: null,
    received_at: null,
    purchaser_note: null,
    deleted_at: null,
    ...overrides,
  };
}

function makePerson(overrides: Partial<PersonDetail>): PersonDetail {
  return {
    id: 0,
    family_id: 5,
    display_id: null,
    given_name: "Someone",
    title: null,
    age: 0,
    note: null,
    created_at: "2025-01-01T00:00:00Z",
    deleted_at: null,
    wishes: [],
    ...overrides,
  };
}

const mockAdult = makePerson({
  id: 1,
  display_id: "P-1",
  given_name: "Alice",
  age: 30,
  wishes: [makeWish({ id: 10, type: "adult", description: "Bike", size: "L" })],
});

const mockChild = makePerson({
  id: 2,
  display_id: "P-2",
  given_name: "Bob",
  age: 8,
  wishes: [
    makeWish({ id: 11, type: "practical", description: "Sweater", size: "S" }),
    makeWish({ id: 12, type: "fun", description: "LEGO" }),
  ],
});

const mockDeletedPerson = makePerson({
  id: 4,
  display_id: "P-4",
  given_name: "Gone G",
  age: 40,
  deleted_at: "2025-02-02T00:00:00Z",
});

const mockListResponse: PersonListResponse = { people: [mockAdult, mockChild], total: 2, page: 1, page_size: 20, total_pages: 1 };
const mockDeletedResponse: PersonListResponse = { people: [mockDeletedPerson], total: 1, page: 1, page_size: 20, total_pages: 1 };

const mockFamily: FamilyDropdownItem = { id: 5, family_name: "The Johnsons" };
const mockFamilyDetail: FamilyDetail = {
  id: 5,
  referrer_id: null,
  referrer_name: null,
  delivery_user_id: null,
  delivery_user_name: null,
  display_id: "F-101",
  family_name: "The Johnsons",
  bio: null,
  address: "123 Main St",
  phone_number: "",
  family_wish: "",
  contact_name: "",
  deleted_at: null,
  person_count: 2,
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

const createQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const wrap = (ui: React.ReactElement) => {
  const queryClient = createQueryClient();
  return render(
    <MemoryRouter initialEntries={["/admin/people"]}>
      <QueryClientProvider client={queryClient}>
        <ToastContainer>{ui}</ToastContainer>
      </QueryClientProvider>
    </MemoryRouter>
  );
};

function mockListApis() {
  vi.spyOn(api, "adminListPeople").mockResolvedValue(mockListResponse);
  vi.spyOn(api, "adminListDeletedPeople").mockResolvedValue(mockDeletedResponse);
  vi.spyOn(api, "adminGetFamiliesDropdown").mockResolvedValue([mockFamily]);
}

/** Builds the error shape the restore-person endpoint returns when the family is deleted. */
function makeFamilyDeletedError() {
  const error = new Error("400 Bad Request") as Error & { response?: { data?: { detail?: string } } };
  error.response = { data: { detail: "family_deleted" } };
  return error;
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe("AdminPeople", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
    localStorage.clear();
  });

  it("renders loading state initially", () => {
    vi.spyOn(api, "adminListPeople").mockReturnValue(new Promise(() => {}));
    vi.spyOn(api, "adminGetFamiliesDropdown").mockResolvedValue([]);

    wrap(<AdminPeople />);
    expect(document.querySelector("svg.animate-spin")).toBeInTheDocument();
  });

  it("renders people with wish cells and family links", async () => {
    mockListApis();

    wrap(<AdminPeople />);

    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });

    expect(screen.getByText("Bob")).toBeInTheDocument();
    // Adult single wish renders with size
    expect(screen.getByText("Bike (L)")).toBeInTheDocument();
    // Child gets separate practical + fun wish cells
    expect(screen.getByText("Sweater (S)")).toBeInTheDocument();
    expect(screen.getByText("LEGO")).toBeInTheDocument();
    // Family link on each row (role query ignores the filter dropdown option)
    expect(screen.getAllByRole("link", { name: "The Johnsons" })).toHaveLength(2);
  });

  it("shows empty state when no people", async () => {
    vi.spyOn(api, "adminListPeople").mockResolvedValue({ people: [], total: 0, page: 1, page_size: 20, total_pages: 0 });
    vi.spyOn(api, "adminGetFamiliesDropdown").mockResolvedValue([]);

    wrap(<AdminPeople />);

    await waitFor(() => {
      expect(screen.getByText("No people yet.")).toBeInTheDocument();
    });
  });

  it("family filter refetches with the selected family", async () => {
    const user = userEvent.setup();
    mockListApis();

    wrap(<AdminPeople />);

    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });

    const familySelect = screen.getByText("All families").closest("select");
    expect(familySelect).not.toBeNull();
    await user.selectOptions(familySelect!, "5");

    await waitFor(() => {
      expect(api.adminListPeople).toHaveBeenLastCalledWith(expect.objectContaining({ family_id: 5 }));
    });
  });

  it("age header cycles sort asc/desc", async () => {
    const user = userEvent.setup();
    mockListApis();

    wrap(<AdminPeople />);

    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /Age/ }));

    await waitFor(() => {
      expect(api.adminListPeople).toHaveBeenLastCalledWith(expect.objectContaining({ sort: "age" }));
    });

    await user.click(screen.getByRole("button", { name: /Age/ }));

    await waitFor(() => {
      expect(api.adminListPeople).toHaveBeenLastCalledWith(expect.objectContaining({ sort: "-age" }));
    });
  });

  it("delete flow confirms and calls API", async () => {
    const user = userEvent.setup();
    mockListApis();
    vi.spyOn(api, "adminDeletePerson").mockResolvedValue(undefined);

    wrap(<AdminPeople />);

    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });

    const triggers = screen.getAllByRole("button", { name: "More actions" });
    await user.click(triggers[0]!);
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));

    await waitFor(() => {
      expect(screen.getByText(/Delete person/)).toBeInTheDocument();
    });
    expect(api.adminDeletePerson).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Yes, delete" }));

    await waitFor(() => {
      expect(api.adminDeletePerson).toHaveBeenCalledWith(1, expect.anything());
    });
    await waitFor(() => {
      expect(screen.getByText("Person deleted")).toBeInTheDocument();
    });
  });

  it("restore person succeeds and shows toast", async () => {
    const user = userEvent.setup();
    mockListApis();
    vi.spyOn(api, "adminRestorePerson").mockResolvedValue(makePerson({ ...mockDeletedPerson, deleted_at: null }));

    wrap(<AdminPeople />);

    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("tab", { name: "Deleted" }));

    await waitFor(() => {
      expect(api.adminListDeletedPeople).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByText("Gone G")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Restore" }));

    await waitFor(() => {
      expect(screen.getByText(/Restore person/)).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Yes, restore" }));

    await waitFor(() => {
      expect(api.adminRestorePerson).toHaveBeenCalledWith(4);
    });
    await waitFor(() => {
      expect(screen.getByText("Person restored")).toBeInTheDocument();
    });
  });

  it("restore person with deleted family offers to restore the whole family", async () => {
    const user = userEvent.setup();
    mockListApis();
    vi.spyOn(api, "adminRestorePerson").mockRejectedValue(makeFamilyDeletedError());
    vi.spyOn(api, "adminRestoreFamily").mockResolvedValue(mockFamilyDetail);

    wrap(<AdminPeople />);

    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("tab", { name: "Deleted" }));

    await waitFor(() => {
      expect(screen.getByText("Gone G")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Restore" }));

    await waitFor(() => {
      expect(screen.getByText(/Restore person/)).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Yes, restore" }));

    // The person restore fails with family_deleted → family restore dialog appears
    await waitFor(() => {
      expect(screen.getByText(/Family is deleted/)).toBeInTheDocument();
    });
    expect(screen.queryByText("Person restored")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Yes, restore family" }));

    await waitFor(() => {
      expect(api.adminRestoreFamily).toHaveBeenCalledWith(5);
    });
    await waitFor(() => {
      expect(screen.getByText("Family restored")).toBeInTheDocument();
    });
  });

  it("create child person builds practical + fun wishes", async () => {
    const user = userEvent.setup();
    mockListApis();
    vi.spyOn(api, "adminCreatePerson").mockImplementation(
      // `wishes` (WishCreate[]) is overridden — the resolved PersonDetail only needs a valid shape
      (data: Parameters<typeof api.adminCreatePerson>[0]) => Promise.resolve(makePerson({ ...mockChild, ...data, wishes: [], id: 9 }))
    );

    wrap(<AdminPeople />);

    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "+ Add Person" }));

    await waitFor(() => {
      expect(screen.getByText("Add Person")).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText("Family") as HTMLSelectElement, "5");
    await user.type(screen.getByLabelText("Given Name"), "Carol");
    await user.type(screen.getByLabelText("Age"), "10");

    // Child (age < 18): separate practical + fun wish fields.
    // Size is required even when not applicable — "0" normalizes to null.
    await user.type(screen.getByLabelText("Practical Wish"), "Jumper");
    await user.type(screen.getByLabelText("Size"), "0");
    await user.type(screen.getByLabelText("Fun Wish"), "Board game");

    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(api.adminCreatePerson).toHaveBeenCalledWith(
        {
          given_name: "Carol",
          age: 10,
          title: null,
          note: null,
          wishes: [
            { type: "practical", description: "Jumper", size: null },
            { type: "fun", description: "Board game", size: null },
          ],
          family_id: 5,
        },
        expect.anything()
      );
    });
    await waitFor(() => {
      expect(screen.getByText("Person created")).toBeInTheDocument();
    });
  });

  it("create adult person builds a single adult wish", async () => {
    const user = userEvent.setup();
    mockListApis();
    vi.spyOn(api, "adminCreatePerson").mockImplementation((data: Parameters<typeof api.adminCreatePerson>[0]) =>
      Promise.resolve(makePerson({ ...mockAdult, ...data, wishes: [], id: 10 }))
    );

    wrap(<AdminPeople />);

    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "+ Add Person" }));

    await waitFor(() => {
      expect(screen.getByText("Add Person")).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText("Family") as HTMLSelectElement, "5");
    await user.type(screen.getByLabelText("Given Name"), "Dan");
    await user.type(screen.getByLabelText("Age"), "25");

    // Adult (age >= 18): single wish field + size
    await user.type(screen.getByLabelText("Wish"), "Coffee");
    await user.type(screen.getByLabelText("Size"), "M");

    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(api.adminCreatePerson).toHaveBeenCalledWith(
        {
          given_name: "Dan",
          age: 25,
          title: null,
          note: null,
          wishes: [{ type: "adult", description: "Coffee", size: "M" }],
          family_id: 5,
        },
        expect.anything()
      );
    });
  });
});
