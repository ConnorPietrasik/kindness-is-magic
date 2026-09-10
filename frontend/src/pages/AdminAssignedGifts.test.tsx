import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssignedGiftsListParams } from "../components/AssignedGifts";
import { AuthProvider } from "../context/AuthContext";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import type { User, WishDetail, WishListResponse, WishListSummary } from "../types";
import AdminAssignedGifts from "./AdminAssignedGifts";

/* ------------------------------------------------------------------ */
// Fixtures
/* ------------------------------------------------------------------ */

const mockAdminUser: User = {
  id: 42,
  email: "admin@example.com",
  role: "admin",
  display_name: "Admin",
  referrer_id: null,
  family_id: null,
  created_at: "2025-01-01T00:00:00Z",
};

const wishBase = {
  person_role: null,
  person_age: null,
  person_note: null,
  family_name: null,
  family_contact_name: null,
  family_phone_number: null,
  family_address: null,
  family_verification_status: null,
  family_pickup_window: null,
  family_bio: null,
  referrer_name: null,
  referrer_phone_number: null,
  created_at: null,
  assigned_to_id: 42,
  assigned_to_name: "Admin",
  purchased_at: null,
  purchased_where: null,
  received_at: null,
  purchaser_note: null,
};

const personWish: WishListSummary = {
  ...wishBase,
  id: 1,
  display_id: "2-1-1A",
  type: "practical",
  description: "Coat",
  size: "S",
  color: "Blue",
  person_id: 1,
  person_given_name: "Alice",
  family_id: 5,
};

const familyWish: WishListSummary = {
  ...wishBase,
  id: 2,
  display_id: "2-2-F",
  type: "fun",
  description: "LEGO",
  size: null,
  color: null,
  person_id: null,
  person_given_name: null,
  family_id: 6,
};

const mockWishDetail: WishDetail = {
  id: 1,
  display_id: "2-1-1A",
  type: "practical",
  description: "Coat",
  size: "S",
  color: "Blue",
  assigned_to_id: 42,
  purchased_at: null,
  purchased_where: null,
  received_at: null,
  purchaser_note: null,
  deleted_at: null,
  person_id: 1,
  person_given_name: "Alice",
  person_family_name: "The Johnsons",
};

function listResponse(wishes: WishListSummary[]): WishListResponse {
  return { wishes, total: wishes.length, page: 1, page_size: 50, total_pages: 1 };
}

function renderPage() {
  vi.spyOn(api, "fetchCurrentUser").mockResolvedValue(mockAdminUser);
  vi.spyOn(api, "adminGetFamiliesDropdown").mockResolvedValue([
    { id: 5, family_name: "The Johnsons" },
    { id: 6, family_name: "The Smiths" },
  ]);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={["/admin/assigned-gifts"]}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ToastContainer>
            <AdminAssignedGifts />
          </ToastContainer>
        </AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

/* ------------------------------------------------------------------ */
// Tests
/* ------------------------------------------------------------------ */

describe("AdminAssignedGifts", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("lists wishes scoped to the current admin", async () => {
    const listSpy = vi.spyOn(api, "adminListWishes").mockResolvedValue(listResponse([personWish, familyWish]));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Coat")).toBeInTheDocument();
    });

    expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ assigned_to_id: 42 }));
    // Person wish and family wish both render with their display ids
    expect(screen.getByText("LEGO")).toBeInTheDocument();
    expect(screen.getByText("2-1-1A")).toBeInTheDocument();
    expect(screen.getByText("2-2-F")).toBeInTheDocument();
  });

  it("links the family column to the admin family page", async () => {
    vi.spyOn(api, "adminListWishes").mockResolvedValue(listResponse([personWish, familyWish]));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Coat")).toBeInTheDocument();
    });

    const johnsonsLink = screen.getByRole("link", { name: "The Johnsons" });
    expect(johnsonsLink).toHaveAttribute("href", "/admin/families/5/people");
    const smithsLink = screen.getByRole("link", { name: "The Smiths" });
    expect(smithsLink).toHaveAttribute("href", "/admin/families/6/people");
  });

  it("refetches with the purchased filter when changed", async () => {
    const user = userEvent.setup();
    const listSpy = vi.spyOn(api, "adminListWishes").mockResolvedValue(listResponse([personWish]));

    renderPage();

    await screen.findByText("Coat");
    const select = screen.getByLabelText("Purchased filter");
    await user.selectOptions(select, "true");

    await waitFor(() => {
      expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ purchased: "true" }));
    });
  });

  it("marks a wish as purchased through the dialog", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminListWishes").mockResolvedValue(listResponse([personWish]));
    const markSpy = vi.spyOn(api, "adminMarkPurchased").mockResolvedValue(mockWishDetail);

    renderPage();

    await user.click(await screen.findByRole("button", { name: "Mark Purchased" }));

    await user.type(await screen.findByLabelText("Purchased Where"), "Amazon");
    // Dialog confirm shares the label — it is the last matching button
    const buttons = screen.getAllByRole("button", { name: "Mark Purchased" });
    const confirmButton = buttons[buttons.length - 1];
    if (!confirmButton) throw new Error("confirm button not found");
    await user.click(confirmButton);

    await waitFor(() => {
      expect(markSpy).toHaveBeenCalledWith(1, expect.objectContaining({ purchased_where: "Amazon" }));
    });
  });

  it("batch marks selected wishes through the dialog", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminListWishes").mockResolvedValue(listResponse([personWish, familyWish]));
    const batchSpy = vi.spyOn(api, "adminBatchMarkPurchased").mockResolvedValue({ marked_count: 2 });

    renderPage();

    // Select both rows, then open the batch dialog from the header button
    await user.click(await screen.findByLabelText("Select all wishes on this page"));
    await user.click(await screen.findByRole("button", { name: "Mark Purchased (2)" }));

    await user.type(await screen.findByLabelText("Purchased Where"), "Amazon");
    const dialog = within(screen.getByRole("dialog"));
    await user.click(dialog.getByRole("button", { name: "Mark Purchased" }));

    await waitFor(() => {
      expect(batchSpy).toHaveBeenCalledWith(expect.objectContaining({ wish_ids: [1, 2], purchased_where: "Amazon", received_at: "" }));
    });
    // Success toast + selection cleared
    await waitFor(() => {
      expect(screen.getByText("2 wishes marked as purchased")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Mark Purchased (0)" })).toBeDisabled();
    });
  });

  it("refetches with the wish type filter when changed", async () => {
    const user = userEvent.setup();
    const listSpy = vi.spyOn(api, "adminListWishes").mockResolvedValue(listResponse([personWish]));

    renderPage();

    await screen.findByText("Coat");
    await user.selectOptions(screen.getByLabelText("Wish type filter"), "family");

    await waitFor(() => {
      expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ wish_type: "family" }));
    });
  });

  it("clears checkbox selection when the purchased filter changes", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminListWishes")
      .mockResolvedValueOnce(listResponse([personWish, familyWish]))
      // Faithful to the API: under "Purchased" only purchased wishes come back
      .mockResolvedValueOnce(listResponse([{ ...personWish, purchased_at: "2025-06-01T12:00:00Z" }]));

    renderPage();

    await screen.findByText("Coat");
    await user.click(screen.getByLabelText("Select all wishes on this page"));
    expect(screen.getByRole("button", { name: "Mark Purchased (2)" })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Purchased filter"), "true");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Mark Purchased (0)" })).toBeInTheDocument();
    });
  });

  it("refetches with the debounced search query", async () => {
    const user = userEvent.setup();
    // Auto-advance time so debounce fires quickly without freezing waitFor/userEvent
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 50 });
    try {
      const listSpy = vi.spyOn(api, "adminListWishes").mockResolvedValue(listResponse([personWish]));

      renderPage();

      await screen.findByText("Coat");
      await user.type(screen.getByPlaceholderText("Search wishes…"), "coat");

      await waitFor(() => {
        expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ search: "coat" }));
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends the changed purchaser note on save", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminListWishes").mockResolvedValue(listResponse([personWish]));
    vi.spyOn(api, "adminGetWish").mockResolvedValue(mockWishDetail);
    const updateSpy = vi.spyOn(api, "adminUpdateWish").mockResolvedValue(mockWishDetail);

    const { container } = renderPage();

    await user.click(await screen.findByRole("button", { name: "Edit" }));

    // The note textarea has no associated label — select it directly
    const textarea = (await waitFor(() => {
      const el = container.querySelector("textarea");
      if (!el) throw new Error("note textarea not found");
      return el;
    })) as HTMLTextAreaElement;
    await user.type(textarea, "Bought with gift card");

    await user.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith(1, expect.objectContaining({ purchaser_note: "Bought with gift card" }));
    });
  });

  /* ── Spreadsheet columns: per-column filters, sort, reorder, visibility ── */

  const lastListParams = () => {
    const calls = (api.adminListWishes as ReturnType<typeof vi.spyOn>).mock.calls;
    return calls[calls.length - 1]?.[0] as AssignedGiftsListParams | undefined;
  };

  const headerOrder = () => screen.getAllByRole("columnheader").map((h) => h.textContent?.trim());

  const defaultHeaders = ["", "ID", "Person", "Family", "Type", "Description", "Size", "Color", "Purchased", "Actions"];

  it("cycles column sort asc → desc → default on header click and sends sort", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminListWishes").mockResolvedValue(listResponse([personWish, familyWish]));

    renderPage();

    await screen.findByText("Coat");

    const sortButton = () => screen.getByRole("button", { name: "Sort by Description" });

    // asc
    await user.click(sortButton());
    await waitFor(() => expect(lastListParams()?.sort).toBe("description"));
    expect(sortButton()).toHaveTextContent("↑");

    // desc
    await user.click(sortButton());
    await waitFor(() => expect(lastListParams()?.sort).toBe("-description"));
    expect(sortButton()).toHaveTextContent("↓");

    // cleared → back to the grouped-by-family default
    await user.click(sortButton());
    await waitFor(() => expect(lastListParams()?.sort).toBeUndefined());
    expect(sortButton()).not.toHaveTextContent(/↑|↓/);

    // The ID header is draggable but not sortable
    expect(screen.queryByRole("button", { name: "Sort by ID" })).not.toBeInTheDocument();
  });

  it("renders per-column filter inputs only for visible searchable columns", async () => {
    vi.spyOn(api, "adminListWishes").mockResolvedValue(listResponse([personWish, familyWish]));

    renderPage();

    await screen.findByText("Coat");

    // Text inputs for the visible text-searchable columns
    expect(screen.getByLabelText("Filter by Person")).toBeInTheDocument();
    expect(screen.getByLabelText("Filter by Family")).toBeInTheDocument();
    expect(screen.getByLabelText("Filter by Description")).toBeInTheDocument();
    expect(screen.getByLabelText("Filter by Size")).toBeInTheDocument();
    expect(screen.getByLabelText("Filter by Color")).toBeInTheDocument();

    // From/to date pair for the visible Purchased column
    expect(screen.getByLabelText("Purchased from")).toBeInTheDocument();
    expect(screen.getByLabelText("Purchased to")).toBeInTheDocument();

    // No input for the non-searchable ID or sort-only Type column, and none
    // for the columns hidden by default
    expect(screen.queryByLabelText("Filter by ID")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Filter by Type")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Filter by Purchased Where")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Received At from")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Filter by Purchaser Note")).not.toBeInTheDocument();
  });

  it("sends debounced per-column filter values to the list endpoint", async () => {
    const user = userEvent.setup();
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 50 });
    try {
      vi.spyOn(api, "adminListWishes").mockResolvedValue(listResponse([personWish]));

      renderPage();

      await screen.findByText("Coat");

      await user.type(screen.getByLabelText("Filter by Size"), "S");
      await user.type(screen.getByLabelText("Filter by Family"), "Johnson");

      // Both non-empty entries are ANDed into the list params
      await waitFor(() => {
        expect(api.adminListWishes).toHaveBeenCalledWith(expect.objectContaining({ size: "S", family_name: "Johnson" }));
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops a column's filter when the column is hidden", async () => {
    const user = userEvent.setup();
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 50 });
    try {
      vi.spyOn(api, "adminListWishes").mockResolvedValue(listResponse([personWish]));

      renderPage();

      await screen.findByText("Coat");

      await user.type(screen.getByLabelText("Filter by Size"), "S");
      await waitFor(() => expect(lastListParams()?.size).toBe("S"));

      // Hide the Size column via the ColumnToggle popover
      await user.click(screen.getByRole("button", { name: "Toggle columns" }));
      await user.click(screen.getByLabelText("Size"));
      await user.click(screen.getByRole("button", { name: "Apply" }));

      // The input is gone and the param stops being sent
      expect(screen.queryByLabelText("Filter by Size")).not.toBeInTheDocument();
      await waitFor(
        () => {
          expect(lastListParams()?.size).toBeUndefined();
        },
        { timeout: 3000 }
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("drag reorders columns, persists to localStorage, and survives remount", async () => {
    vi.spyOn(api, "adminListWishes").mockResolvedValue(listResponse([personWish, familyWish]));

    const view = renderPage();
    await screen.findByText("Coat");
    expect(headerOrder()).toEqual(defaultHeaders);

    const color = screen.getByRole("columnheader", { name: "Color" });
    const size = screen.getByRole("columnheader", { name: "Size" });
    size.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, bottom: 0, right: 200, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

    // jsdom drag events carry no clientX; the component treats that as the
    // left edge, so the column drops before the target.
    fireEvent.dragStart(color, { dataTransfer: {} });
    fireEvent.dragOver(size, { dataTransfer: {} });
    fireEvent.drop(size, { dataTransfer: {} });

    expect(headerOrder()).toEqual(["", "ID", "Person", "Family", "Type", "Description", "Color", "Size", "Purchased", "Actions"]);
    expect(JSON.parse(localStorage.getItem("kim:columnOrder:adminAssignedGifts")!)).toEqual([
      "display_id",
      "person_given_name",
      "family_name",
      "type",
      "description",
      "color",
      "size",
      "purchased_at",
      "purchased_where",
      "received_at",
      "purchaser_note",
    ]);

    // The order survives remount (same localStorage)
    view.unmount();
    cleanup();
    renderPage();
    await screen.findByText("Coat");
    expect(headerOrder()).toEqual(["", "ID", "Person", "Family", "Type", "Description", "Color", "Size", "Purchased", "Actions"]);
  });

  it("arrow-key reorder moves the focused column and persists", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminListWishes").mockResolvedValue(listResponse([personWish]));

    renderPage();

    await screen.findByText("Coat");
    expect(headerOrder()).toEqual(defaultHeaders);

    // The Purchased header's accessible name is composed from its date
    // inputs' aria-labels — locate it via the th's visible text instead.
    const purchased = screen.getAllByRole("columnheader").find((h) => h.textContent?.trim().startsWith("Purchased"));
    if (!purchased) throw new Error("Purchased column header not found");
    purchased.focus();
    await user.keyboard("{ArrowLeft}");

    // Steps one visible column at a time — Purchased lands before Color
    expect(headerOrder()).toEqual(["", "ID", "Person", "Family", "Type", "Description", "Size", "Purchased", "Color", "Actions"]);
    expect(JSON.parse(localStorage.getItem("kim:columnOrder:adminAssignedGifts")!)).toEqual([
      "display_id",
      "person_given_name",
      "family_name",
      "type",
      "description",
      "size",
      "purchased_at",
      "color",
      "purchased_where",
      "received_at",
      "purchaser_note",
    ]);
  });

  it("ColumnToggle hides a column and the edit-row colSpan follows", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminListWishes").mockResolvedValue(listResponse([personWish]));
    vi.spyOn(api, "adminGetWish").mockResolvedValue(mockWishDetail);

    renderPage();

    await user.click(await screen.findByRole("button", { name: "Edit" }));

    const getEditTd = () => document.querySelector("tbody td[colspan]") as HTMLTableCellElement | null;
    // 8 default visible columns + checkbox + actions
    await waitFor(() => expect(getEditTd()?.getAttribute("colspan")).toBe("10"));

    // Hide the Color column via the ColumnToggle popover
    await user.click(screen.getByRole("button", { name: "Toggle columns" }));
    await user.click(screen.getByLabelText("Color"));
    await user.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(getEditTd()?.getAttribute("colspan")).toBe("9"));
  });
});
