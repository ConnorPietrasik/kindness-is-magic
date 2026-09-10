import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import type { FamilySelfServiceDetail, PersonDetail, WishSummary } from "../types";
import FamilyPeople from "./FamilyPeople";

/* ------------------------------------------------------------------ */
// Fixtures
/* ------------------------------------------------------------------ */

const mockFamily: FamilySelfServiceDetail = {
  id: 7,
  referrer_id: 2,
  referrer_name: "Referrer Ray",
  display_id: "2-3",
  family_name: "The Johnsons",
  bio: "Board game fans",
  address: "123 Main St",
  phone_number: "555-0100",
  family_wish: "A cozy family night",
  contact_name: "Alice Johnson",
  deleted_at: null,
  person_count: 2,
  verification_status: "verified",
  pickup_window: null,
  wish_lock_level: "family",
  wish_review_requested_at: null,
  wish_rejection_reason: null,
};

function makeWish(overrides: Partial<WishSummary> & Pick<WishSummary, "id" | "type" | "description">): WishSummary {
  return {
    display_id: null,
    size: null,
    color: null,
    assigned_to_id: null,
    purchased_at: null,
    purchased_where: null,
    received_at: null,
    purchaser_note: null,
    deleted_at: null,
    ...overrides,
  };
}

const childPerson: PersonDetail = {
  id: 11,
  family_id: 7,
  display_id: "2-3-1",
  given_name: "Sam",
  role: "son",
  age: 8,
  note: null,
  created_at: "2025-11-01T00:00:00Z",
  deleted_at: null,
  wishes: [
    makeWish({ id: 101, type: "practical", description: "Sweater", size: "M", color: "Blue" }),
    makeWish({ id: 102, type: "fun", description: "Board game" }),
  ],
};

const adultPerson: PersonDetail = {
  id: 12,
  family_id: 7,
  display_id: "2-3-2",
  given_name: "Alice",
  role: "mother",
  age: 38,
  note: null,
  created_at: "2025-11-01T00:00:00Z",
  deleted_at: null,
  wishes: [makeWish({ id: 103, type: "adult", description: "Espresso machine" })],
};

function renderPage({ family, people }: { family?: Partial<FamilySelfServiceDetail>; people?: PersonDetail[] } = {}) {
  const list = people ?? [childPerson, adultPerson];
  vi.spyOn(api, "getFamilyMe").mockResolvedValue({ ...mockFamily, ...family });
  vi.spyOn(api, "listFamilyPeople").mockResolvedValue({
    people: list,
    total: list.length,
    page: 1,
    page_size: 50,
    total_pages: 1,
  });
  vi.spyOn(api, "getPerson").mockImplementation((id: number) => {
    const person = list.find((p) => p.id === id);
    return person ? Promise.resolve(person) : Promise.reject(new Error(`Person ${id} not found`));
  });
  vi.spyOn(api, "createFamilyPerson").mockResolvedValue(childPerson);
  vi.spyOn(api, "updatePerson").mockResolvedValue(childPerson);
  vi.spyOn(api, "deletePerson").mockResolvedValue(undefined);

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={["/family/people"]}>
      <QueryClientProvider client={queryClient}>
        <ToastContainer>
          <FamilyPeople />
        </ToastContainer>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

/* ------------------------------------------------------------------ */
// Tests
/* ------------------------------------------------------------------ */

describe("FamilyPeople", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("renders people with adult and child wish cells", async () => {
    renderPage();

    expect(await screen.findByText("Manage People")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Add Person" })).toBeInTheDocument();

    // Child row — practical and fun wishes in separate columns
    expect(screen.getByText("Sam")).toBeInTheDocument();
    expect(screen.getByText("Sweater (M, Blue)")).toBeInTheDocument();
    expect(screen.getByText("Board game")).toBeInTheDocument();

    // Adult row — single adult wish spanning both wish columns
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Espresso machine")).toBeInTheDocument();

    // Edit + Delete on each row
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(2);
  });

  it("shows the empty state when the family has no people", async () => {
    renderPage({ people: [] });

    expect(await screen.findByText("No people yet. Add one to get started.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Add Person" })).toBeInTheDocument();
  });

  it("create flow calls createFamilyPerson with the form payload", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "+ Add Person" }));

    await user.type(screen.getByLabelText("Given Name"), "Jo");
    await user.type(screen.getByLabelText("Age"), "5");
    await user.selectOptions(screen.getByLabelText("Role"), "daughter");
    await user.type(screen.getByLabelText("Practical Wish"), "Jacket");
    await user.type(screen.getByLabelText("Size"), "100");
    await user.type(screen.getByLabelText("Color"), "Red");
    await user.type(screen.getByLabelText("Fun Wish"), "Story books");

    await user.click(screen.getByRole("button", { name: "Create" }));

    // Family page omits family_id (form default is 0); note "" → null
    expect(api.createFamilyPerson).toHaveBeenCalledWith(
      {
        given_name: "Jo",
        age: 5,
        role: "daughter",
        note: null,
        wishes: [
          { type: "practical", description: "Jacket", size: "100", color: "Red" },
          { type: "fun", description: "Story books", size: null, color: null },
        ],
      },
      expect.anything()
    ); // useCrudManager passes the mutation fn straight to useMutation
    await waitFor(() => {
      expect(screen.getByText("Person created")).toBeInTheDocument();
    });
  });

  it("edit flow prefills the form and sends a minimal patch", async () => {
    const user = userEvent.setup();
    renderPage();

    const samRow = await screen.findByRole("row", { name: /Sam/ });
    await user.click(within(samRow).getByRole("button", { name: "Edit" }));

    // Form prefills from the detail fetch
    const nameInput = await screen.findByLabelText("Given Name");
    expect(nameInput).toHaveValue("Sam");
    expect(screen.getByLabelText("Role")).toHaveValue("son");
    expect(screen.getByLabelText("Practical Wish")).toHaveValue("Sweater");
    expect(screen.getByLabelText("Fun Wish")).toHaveValue("Board game");

    await user.clear(nameInput);
    await user.type(nameInput, "Samuel");
    await user.click(screen.getByRole("button", { name: "Update" }));

    // Minimal patch: unchanged fields (age, role, note, family_id) omitted;
    // wishes are always rebuilt from the form state.
    await waitFor(() => {
      expect(api.updatePerson).toHaveBeenCalledWith(11, {
        given_name: "Samuel",
        wishes: [
          { type: "practical", description: "Sweater", size: "M", color: "Blue" },
          { type: "fun", description: "Board game", size: null, color: null },
        ],
      }); // update fn is wrapped by useCrudManager — no mutation context arg
    });
    await waitFor(() => {
      expect(screen.getByText("Person updated")).toBeInTheDocument();
    });
  });

  it("delete flow confirms and calls deletePerson", async () => {
    const user = userEvent.setup();
    renderPage();

    const samRow = await screen.findByRole("row", { name: /Sam/ });
    await user.click(within(samRow).getByRole("button", { name: "Delete" }));

    // Confirmation dialog names the person by ID
    expect(await screen.findByText("#11")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Yes, delete" }));

    expect(api.deletePerson).toHaveBeenCalledWith(11, expect.anything());
    await waitFor(() => {
      expect(screen.getByText("Person deleted")).toBeInTheDocument();
    });
  });

  describe("wish lock", () => {
    it("hides editing and shows the admin-locked message when the family is admin-locked", async () => {
      renderPage({ family: { wish_lock_level: "admin" } });

      await screen.findByText("Manage People");
      expect(screen.queryByRole("button", { name: "+ Add Person" })).not.toBeInTheDocument();
      expect(screen.getByText("Editing is currently locked.")).toBeInTheDocument();
      expect(
        screen.getByText("Your family profile is fully approved and visible to donors. Contact your referrer if changes are needed.")
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
      // Each row shows a "Locked" placeholder in the actions cell
      expect(screen.getAllByText("Locked")).toHaveLength(2);
    });

    it("shows the awaiting-review message while a review request is pending", async () => {
      renderPage({ family: { wish_review_requested_at: "2025-11-02T00:00:00Z" } });

      await screen.findByText("Manage People");
      expect(screen.queryByRole("button", { name: "+ Add Person" })).not.toBeInTheDocument();
      expect(screen.getByText("Your profile is awaiting referrer review. You'll be able to edit again after review.")).toBeInTheDocument();
    });

    it("shows the contact-referrer message when locked at the referrer level", async () => {
      renderPage({ family: { wish_lock_level: "referrer", wish_rejection_reason: "Wishes need more specificity" } });

      await screen.findByText("Manage People");
      expect(screen.queryByRole("button", { name: "+ Add Person" })).not.toBeInTheDocument();
      expect(screen.getByText("Contact your referrer to request changes.")).toBeInTheDocument();
    });
  });
});
