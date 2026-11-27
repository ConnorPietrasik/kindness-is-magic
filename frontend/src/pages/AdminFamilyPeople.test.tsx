import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/AuthContext";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import { auth } from "../lib/queryKeys";
import { headerUser } from "../test/fixtures";
import type { FamilyDetail, PersonDetail, ReferrerDetail, WishSummary } from "../types";
import AdminFamilyPeople from "./AdminFamilyPeople";

/* ------------------------------------------------------------------ */
// Fixtures
/* ------------------------------------------------------------------ */

const mockFamily: FamilyDetail = {
  id: 5,
  referrer_id: 2,
  referrer_name: "Referrer Ray",
  delivery_user_id: null,
  delivery_user_name: null,
  display_id: "2-1",
  family_name: "The Johnsons",
  bio: "Board game fans",
  address: "123 Main St",
  phone_number: "555-0100",
  contact_name: "Alice Johnson",
  deleted_at: null,
  person_count: 1,
  verification_status: "verified",
  wish_lock_level: "family",
  wish_review_requested_at: null,
  wish_rejection_reason: null,
  referrer_notes: null,
  contact_email: "alice@example.com",
  claim_status: null,
  claim_commitment_type: null,
  claim_donor_name: null,
  claim_id: null,
};

const mockPerson: PersonDetail = {
  id: 11,
  family_id: 5,
  display_id: "2-1-1",
  given_name: "Sam",
  role: "son",
  age: 8,
  note: "Likes blue",
  created_at: "2025-11-01T00:00:00Z",
  deleted_at: null,
  wishes: [],
};

// The lazy referrer fetch fires whenever the email composer opens, so this is
// always mocked (mockFamily's referrer_id points at it)
const mockReferrer: ReferrerDetail = {
  id: 2,
  name: "Referrer Ray",
  family_limit: 10,
  phone_number: "555-0000",
  pickup_window: null,
  family_invite_code: "KRI-123456",
  family_count: 1,
  approval_status: "approved",
  approved_by_admin_name: null,
  approved_at: null,
  created_at: "2025-11-01T00:00:00Z",
  deleted_at: null,
  invite_count: null,
  email: "ray@example.com",
};

function makeWish(overrides: Partial<WishSummary> & { type: WishSummary["type"] }): WishSummary {
  return {
    id: 0,
    display_id: null,
    description: "A wish",
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

function renderPage(familyOverrides: Partial<FamilyDetail> = {}, personOverrides: Partial<PersonDetail> = {}) {
  const family = { ...mockFamily, ...familyOverrides };
  const person = { ...mockPerson, ...personOverrides };
  vi.spyOn(api, "adminGetFamily").mockResolvedValue(family);
  vi.spyOn(api, "adminListFamilyPeople").mockResolvedValue({
    people: [person],
    total: 1,
    page: 1,
    page_size: 50,
    total_pages: 1,
  });
  vi.spyOn(api, "adminGetReferrersDropdown").mockResolvedValue([]);
  vi.spyOn(api, "adminGetUsersDropdown").mockResolvedValue([]);
  vi.spyOn(api, "adminGetReferrer").mockResolvedValue(mockReferrer);

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(auth, headerUser);
  return render(
    <MemoryRouter initialEntries={["/admin/families/5/people"]}>
      <QueryClientProvider client={queryClient}>
        <ToastContainer>
          <AuthProvider>
            <Routes>
              <Route path="/admin/families/:id/people" element={<AdminFamilyPeople />} />
            </Routes>
          </AuthProvider>
        </ToastContainer>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

/* ------------------------------------------------------------------ */
// Tests
/* ------------------------------------------------------------------ */

describe("AdminFamilyPeople", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("renders the family card and the people table", async () => {
    renderPage();

    expect(screen.getByText("Family & People")).toBeInTheDocument();

    // Family card loads async — wait for it (name appears in the card header and info row)
    expect((await screen.findAllByText("The Johnsons")).length).toBeGreaterThan(0);
    // Card header renders "Referrer: <name>" as one element
    expect(await screen.findByText("Referrer: Referrer Ray")).toBeInTheDocument();

    // People table row (ID/Name/Age/Wishes visible by default)
    expect(await screen.findByText("Sam")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    // Note column is hidden by default (adminPeople column visibility)
    expect(screen.queryByText("Likes blue")).not.toBeInTheDocument();
  });

  it("shows the Fully approve button for non-admin-locked families", async () => {
    renderPage();

    await screen.findAllByText("The Johnsons");
    expect(screen.getByRole("button", { name: "Fully approve" })).toBeInTheDocument();
  });

  it("hides Fully approve and shows View wish list for admin-locked families", async () => {
    renderPage({ wish_lock_level: "admin" });

    await screen.findAllByText("The Johnsons");
    expect(screen.queryByRole("button", { name: "Fully approve" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View wish list" })).toBeInTheDocument();
  });

  it("header Send email opens the composer prefilled with the family contact email", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findAllByText("The Johnsons");
    await user.click(screen.getByRole("button", { name: "Send email" }));

    // Dialog heading (the header button keeps the same label)
    expect(await screen.findByRole("heading", { name: "Send email" })).toBeInTheDocument();
    expect(screen.getByText("Family 2-1 — The Johnsons")).toBeInTheDocument();
    expect(screen.getByLabelText("Recipient")).toHaveValue("alice@example.com");
    // Opening the composer also lazily loads the referrer, offered as a switchable option
    expect(await screen.findByRole("option", { name: "Referrer — ray@example.com" })).toBeInTheDocument();
  });

  it("offers the referrer as a recipient option and selects it on click", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findAllByText("The Johnsons");
    await user.click(screen.getByRole("button", { name: "Send email" }));

    expect(await screen.findByRole("heading", { name: "Send email" })).toBeInTheDocument();
    // The referrer option arrives with the lazy referrer fetch
    const referrerOption = await screen.findByRole("option", { name: "Referrer — ray@example.com" });
    await user.selectOptions(screen.getByLabelText("Recipient"), referrerOption);
    expect(screen.getByLabelText("Recipient")).toHaveValue("ray@example.com");
    // The family contact is also offered in the select
    expect(screen.getByRole("option", { name: "Family contact — alice@example.com" })).toBeInTheDocument();
  });

  it("offers no referrer option when the family has no referrer", async () => {
    const user = userEvent.setup();
    renderPage({ referrer_id: null, referrer_name: null });

    await screen.findAllByText("The Johnsons");
    await user.click(screen.getByRole("button", { name: "Send email" }));
    expect(await screen.findByRole("heading", { name: "Send email" })).toBeInTheDocument();
    // Contact prefilled, no referrer option (fetch disabled for referrer_id null)
    expect(screen.getByLabelText("Recipient")).toHaveValue("alice@example.com");
    expect(screen.queryByRole("option", { name: /Referrer — / })).not.toBeInTheDocument();
  });

  it("shows the family's wishes in the composer's context block", async () => {
    const user = userEvent.setup();
    renderPage(
      { family_wish: "A new blanket fort" },
      {
        wishes: [
          makeWish({ id: 21, type: "practical", description: "Sweater", size: "M", color: "Blue" }),
          makeWish({ id: 22, type: "fun", description: "Trampoline" }),
        ],
      }
    );

    await screen.findAllByText("The Johnsons");
    await user.click(screen.getByRole("button", { name: "Send email" }));

    const dialog = await screen.findByRole("dialog");
    // The context block shows the family wish plus one line per person
    expect(within(dialog).getByText("Family wishes")).toBeInTheDocument();
    expect(within(dialog).getByText("A new blanket fort")).toBeInTheDocument();
    expect(within(dialog).getByText("Sam (8):")).toBeInTheDocument();
    expect(within(dialog).getByText(/Practical: Sweater \(M, Blue\) · Fun: Trampoline/)).toBeInTheDocument();
  });

  it("Escape on the delete confirm dismisses the confirm, not the composer", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findAllByText("The Johnsons");
    await user.click(screen.getByRole("button", { name: "Send email" }));
    await screen.findByRole("heading", { name: "Send email" });

    // The page stays interactive under the non-modal drawer — open the row's
    // delete confirm from the kebab menu
    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();

    // Escape goes to the confirm first — the composer stays open
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Send email" })).toBeInTheDocument();
  });

  it("fully approve flow confirms and calls API", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminApproveWishes").mockResolvedValue({ ...mockFamily, wish_lock_level: "admin" });
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Fully approve" }));
    await user.click(await screen.findByRole("button", { name: "Yes, fully approve" }));

    await waitFor(() => {
      expect(api.adminApproveWishes).toHaveBeenCalledWith(mockFamily.id);
    });
    await waitFor(() => {
      expect(screen.getByText("Family fully approved and visible to donors")).toBeInTheDocument();
    });
  });

  describe("people table column order", () => {
    const headerOrder = () => screen.getAllByRole("columnheader").map((h) => h.textContent?.trim());

    const dragBefore = (source: HTMLElement, target: HTMLElement) => {
      target.getBoundingClientRect = () =>
        ({ left: 0, width: 200, top: 0, bottom: 0, right: 200, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      // jsdom drag events carry no clientX; the component treats that as
      // the left edge, so the unit drops before the target.
      fireEvent.dragStart(source, { dataTransfer: {} });
      fireEvent.dragOver(target, { dataTransfer: {} });
      fireEvent.drop(target, { dataTransfer: {} });
    };

    it("renders the columns in a persisted custom order (shared with the main people page)", async () => {
      localStorage.setItem("kim:columnOrder:adminPeople", JSON.stringify(["age", "given_name", "wishes", "display_id"]));
      renderPage();
      await screen.findByText("Sam");

      // The Family column is omitted on this page even though it's in the order.
      expect(headerOrder()).toEqual(["Age", "Name", "Practical Wish", "Fun Wish", "ID", "Actions"]);
    });

    it("drag reorders the paired wish headers as one unit and persists", async () => {
      renderPage();
      await screen.findByText("Sam");
      expect(headerOrder()).toEqual(["ID", "Name", "Age", "Practical Wish", "Fun Wish", "Actions"]);

      // Drag the second wish header — the whole pair lands before Name.
      const funWish = screen.getByRole("columnheader", { name: "Fun Wish" });
      const name = screen.getByRole("columnheader", { name: "Name" });
      dragBefore(funWish, name);

      expect(headerOrder()).toEqual(["ID", "Practical Wish", "Fun Wish", "Name", "Age", "Actions"]);
      expect(JSON.parse(localStorage.getItem("kim:columnOrder:adminPeople")!)).toEqual([
        "display_id",
        "wishes",
        "given_name",
        "age",
        "family_id",
        "role",
        "note",
        "created_at",
      ]);
    });

    it("reset order restores the registry order and hides the button", async () => {
      const user = userEvent.setup();
      localStorage.setItem("kim:columnOrder:adminPeople", JSON.stringify(["age", "given_name", "wishes", "display_id"]));
      renderPage();
      await screen.findByText("Sam");

      const resetBtn = screen.getByRole("button", { name: "Reset order" });
      await user.click(resetBtn);

      expect(headerOrder()).toEqual(["ID", "Name", "Age", "Practical Wish", "Fun Wish", "Actions"]);
      expect(screen.queryByRole("button", { name: "Reset order" })).not.toBeInTheDocument();
    });
  });

  describe("persisted tab state", () => {
    it("hydrates the deleted tab from storage (scoped to the family)", async () => {
      const user = userEvent.setup();
      const deletedPerson = { given_name: "Ghost", deleted_at: "2025-02-02T00:00:00Z" };
      vi.spyOn(api, "adminListDeletedPeople").mockResolvedValue({
        people: [{ ...mockPerson, ...deletedPerson }],
        total: 1,
        page: 1,
        page_size: 20,
        total_pages: 1,
      });
      localStorage.setItem("kim:listView:adminFamilyPeople:5:tab", JSON.stringify("deleted"));

      renderPage();

      // The deleted endpoint backs the list, not the active one
      await screen.findByText("Ghost");
      expect(api.adminListDeletedPeople).toHaveBeenCalled();
      expect(screen.getByRole("tab", { name: "Deleted" })).toHaveAttribute("aria-selected", "true");

      // Non-default view → the clear affordance resets the saved tab
      await user.click(screen.getByRole("button", { name: "Clear filters" }));
      expect(JSON.parse(localStorage.getItem("kim:listView:adminFamilyPeople:5:tab")!)).toBe("active");
      expect(screen.getByRole("tab", { name: "Active" })).toHaveAttribute("aria-selected", "true");
      expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
    });

    it("ignores another family's saved tab", async () => {
      localStorage.setItem("kim:listView:adminFamilyPeople:99:tab", JSON.stringify("deleted"));

      renderPage();

      await screen.findByText("Sam");
      expect(screen.getByRole("tab", { name: "Active" })).toHaveAttribute("aria-selected", "true");
      expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
    });

    it("persists tab switches to storage", async () => {
      const user = userEvent.setup();
      vi.spyOn(api, "adminListDeletedPeople").mockResolvedValue({ people: [], total: 0, page: 1, page_size: 20, total_pages: 0 });

      renderPage();
      await screen.findByText("Sam");

      await user.click(screen.getByRole("tab", { name: "Deleted" }));
      expect(JSON.parse(localStorage.getItem("kim:listView:adminFamilyPeople:5:tab")!)).toBe("deleted");
      expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();

      await user.click(screen.getByRole("tab", { name: "Active" }));
      expect(JSON.parse(localStorage.getItem("kim:listView:adminFamilyPeople:5:tab")!)).toBe("active");
      expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
    });

    it("re-hydrates the target family's view when the route param changes (no remount)", async () => {
      // Family 7 has its own saved view (the deleted tab); family 5 has none
      localStorage.setItem("kim:listView:adminFamilyPeople:7:tab", JSON.stringify("deleted"));

      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      queryClient.setQueryData(auth, headerUser);
      const user = userEvent.setup();
      vi.spyOn(api, "adminGetFamily").mockResolvedValue(mockFamily);
      vi.spyOn(api, "adminListFamilyPeople").mockResolvedValue({ people: [mockPerson], total: 1, page: 1, page_size: 20, total_pages: 1 });
      vi.spyOn(api, "adminListDeletedPeople").mockResolvedValue({ people: [], total: 0, page: 1, page_size: 20, total_pages: 0 });
      vi.spyOn(api, "adminGetReferrersDropdown").mockResolvedValue([]);
      vi.spyOn(api, "adminGetUsersDropdown").mockResolvedValue([]);
      vi.spyOn(api, "adminGetReferrer").mockResolvedValue(mockReferrer);
      render(
        <MemoryRouter initialEntries={["/admin/families/5/people"]}>
          <QueryClientProvider client={queryClient}>
            <ToastContainer>
              <AuthProvider>
                <Link to="/admin/families/7/people">to-family-7</Link>
                <Routes>
                  <Route path="/admin/families/:id/people" element={<AdminFamilyPeople />} />
                </Routes>
              </AuthProvider>
            </ToastContainer>
          </QueryClientProvider>
        </MemoryRouter>
      );

      // Family 5's page shows its own (default) view
      await screen.findByText("Sam");
      expect(screen.getByRole("tab", { name: "Active" })).toHaveAttribute("aria-selected", "true");

      // Navigate to family 7 within the same router — same route element, so
      // the inner key must force the remount that re-reads storage
      await user.click(screen.getByRole("link", { name: "to-family-7" }));

      // Family 7's saved view is re-hydrated from its own slot…
      await screen.findByRole("tab", { name: "Deleted" });
      expect(screen.getByRole("tab", { name: "Deleted" })).toHaveAttribute("aria-selected", "true");
      // …and the navigation did not clobber the saved tab with family 5's
      expect(JSON.parse(localStorage.getItem("kim:listView:adminFamilyPeople:7:tab")!)).toBe("deleted");
    });
  });
});
