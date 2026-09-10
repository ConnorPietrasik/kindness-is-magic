import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastContainer } from "../context/ToastContext";
import type { PurchaserWishesListParams } from "../lib/api";
import * as api from "../lib/api";
import type { PurchaserWishListResponse, PurchaserWishSummary, WishDetail } from "../types";
import PurchaserAssignedGifts from "./PurchaserAssignedGifts";

/* ------------------------------------------------------------------ */
// Fixtures
/* ------------------------------------------------------------------ */

const wishBase = {
  person_id: 1,
  assigned_to_id: null,
  purchased_at: null,
  purchased_where: null,
  received_at: null,
  purchaser_note: null,
};

const adminLockedWish: PurchaserWishSummary = {
  ...wishBase,
  id: 1,
  display_id: "2-1-1A",
  type: "practical",
  description: "Coat",
  size: "S",
  color: "Blue",
  person_given_name: "Alice",
  family_id: 5,
  family_display_id: "2-1",
  wish_lock_level: "admin",
};

const familyLockedWish: PurchaserWishSummary = {
  ...wishBase,
  id: 2,
  display_id: "2-2-F",
  type: "fun",
  description: "LEGO",
  size: null,
  color: null,
  person_given_name: null,
  family_id: 6,
  family_display_id: "2-2",
  wish_lock_level: "family",
};

const mockWishDetail: WishDetail = {
  id: 1,
  display_id: "2-1-1A",
  type: "practical",
  description: "Coat",
  size: "S",
  color: "Blue",
  assigned_to_id: null,
  purchased_at: null,
  purchased_where: null,
  received_at: null,
  purchaser_note: null,
  deleted_at: null,
  person_id: 1,
  person_given_name: "Alice",
  person_family_name: "The Johnsons",
};

function listResponse(wishes: PurchaserWishSummary[]): PurchaserWishListResponse {
  return { wishes, total: wishes.length, page: 1, page_size: 50, total_pages: 1 };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={["/purchaser/gifts"]}>
      <QueryClientProvider client={queryClient}>
        <ToastContainer>
          <PurchaserAssignedGifts />
        </ToastContainer>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

/* ------------------------------------------------------------------ */
// Tests
/* ------------------------------------------------------------------ */

describe("PurchaserAssignedGifts", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("renders assigned wishes and only links admin-locked families", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "purchaserListWishes").mockResolvedValue({
      wishes: [adminLockedWish, familyLockedWish],
      total: 2,
      page: 1,
      page_size: 50,
      total_pages: 1,
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Coat")).toBeInTheDocument();
    });

    // The Family column is hidden by default (a subset of the display_id) —
    // reveal it via the gear to check the cell's link gating
    await user.click(screen.getByRole("button", { name: "Toggle columns" }));
    await user.click(screen.getByLabelText("Family"));
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(screen.getByRole("columnheader", { name: "Family" })).toBeInTheDocument());

    // Admin-locked family links to the public wishlist
    expect(screen.getByText("2-1", { selector: "a" })).toHaveAttribute("href", "/families/5/wish-list");
    // Family-locked family has no public page — plain text, no link
    expect(screen.queryByText("2-2", { selector: "a" })).not.toBeInTheDocument();
  });

  it("renders the table at wide width by default", async () => {
    vi.spyOn(api, "purchaserListWishes").mockResolvedValue(listResponse([adminLockedWish]));

    renderPage();

    await screen.findByText("Coat");

    // The purchaser page defaults to wide (its table has fewer columns than
    // the compact-default list pages) — <main> carries the width class
    const main = document.querySelector("main");
    expect(main).toHaveClass("max-w-7xl");
    expect(main).not.toHaveClass("max-w-[960px]");
  });

  it("shows the fixed ID column with each wish's display_id", async () => {
    vi.spyOn(api, "purchaserListWishes").mockResolvedValue({
      wishes: [adminLockedWish, familyLockedWish],
      total: 2,
      page: 1,
      page_size: 50,
      total_pages: 1,
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Coat")).toBeInTheDocument();
    });

    expect(screen.getByRole("columnheader", { name: "ID" })).toBeInTheDocument();
    // Person wish → person display_id + type letter; family wish → family display_id + "-F"
    expect(screen.getByText("2-1-1A")).toBeInTheDocument();
    expect(screen.getByText("2-2-F")).toBeInTheDocument();
  });

  it("marks a wish as purchased through the dialog", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "purchaserListWishes").mockResolvedValue({
      wishes: [adminLockedWish],
      total: 1,
      page: 1,
      page_size: 50,
      total_pages: 1,
    });
    const markSpy = vi.spyOn(api, "purchaserMarkPurchased").mockResolvedValue(mockWishDetail);

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

  it("refetches with the wish type filter when changed", async () => {
    const user = userEvent.setup();
    const listSpy = vi.spyOn(api, "purchaserListWishes").mockResolvedValue({
      wishes: [adminLockedWish],
      total: 1,
      page: 1,
      page_size: 50,
      total_pages: 1,
    });

    renderPage();

    await screen.findByText("Coat");
    await user.selectOptions(screen.getByLabelText("Wish type filter"), "family");

    await waitFor(() => {
      expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ wish_type: "family" }));
    });
  });

  it("refetches with the debounced search query", async () => {
    const user = userEvent.setup();
    // Auto-advance time so debounce fires quickly without freezing waitFor/userEvent
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 50 });
    try {
      const listSpy = vi.spyOn(api, "purchaserListWishes").mockResolvedValue({
        wishes: [adminLockedWish],
        total: 1,
        page: 1,
        page_size: 50,
        total_pages: 1,
      });

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

  it("batch marks selected wishes through the dialog", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "purchaserListWishes").mockResolvedValue({
      wishes: [adminLockedWish, familyLockedWish],
      total: 2,
      page: 1,
      page_size: 50,
      total_pages: 1,
    });
    const batchSpy = vi.spyOn(api, "purchaserBatchMarkPurchased").mockResolvedValue({ marked_count: 2 });

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

  it("clears checkbox selection when the purchased filter changes", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "purchaserListWishes")
      .mockResolvedValueOnce({
        wishes: [adminLockedWish, familyLockedWish],
        total: 2,
        page: 1,
        page_size: 50,
        total_pages: 1,
      })
      // Faithful to the API: under "Purchased" only purchased wishes come back
      .mockResolvedValueOnce({
        wishes: [{ ...adminLockedWish, purchased_at: "2025-06-01T12:00:00Z" }],
        total: 1,
        page: 1,
        page_size: 50,
        total_pages: 1,
      });

    renderPage();

    await screen.findByText("Coat");
    await user.click(screen.getByLabelText("Select all wishes on this page"));
    expect(screen.getByRole("button", { name: "Mark Purchased (2)" })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Purchased filter"), "true");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Mark Purchased (0)" })).toBeInTheDocument();
    });
  });

  it("sends the changed purchaser note on save", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "purchaserListWishes").mockResolvedValue({
      wishes: [adminLockedWish],
      total: 1,
      page: 1,
      page_size: 50,
      total_pages: 1,
    });
    vi.spyOn(api, "purchaserGetWish").mockResolvedValue(mockWishDetail);
    const updateSpy = vi.spyOn(api, "purchaserUpdateWish").mockResolvedValue(mockWishDetail);

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

  /* ── Spreadsheet columns: per-column filters, sort, reorder ── */

  const lastListParams = () => {
    const calls = (api.purchaserListWishes as ReturnType<typeof vi.spyOn>).mock.calls;
    return calls[calls.length - 1]?.[0] as PurchaserWishesListParams | undefined;
  };

  const headerOrder = () => screen.getAllByRole("columnheader").map((h) => h.textContent?.trim());

  // The Family column is hidden by default (a subset of the display_id)
  const defaultHeaders = ["", "ID", "Person", "Type", "Description", "Size", "Color", "Purchased", "Actions"];

  it("cycles column sort asc → desc → default on header click and sends sort", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "purchaserListWishes").mockResolvedValue(listResponse([adminLockedWish, familyLockedWish]));

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

  it("renders per-column filter inputs without a Family filter or sort", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "purchaserListWishes").mockResolvedValue(listResponse([adminLockedWish, familyLockedWish]));

    renderPage();

    await screen.findByText("Coat");

    // Text inputs for the visible text-searchable columns
    expect(screen.getByLabelText("Filter by Person")).toBeInTheDocument();
    expect(screen.getByLabelText("Filter by Description")).toBeInTheDocument();
    expect(screen.getByLabelText("Filter by Size")).toBeInTheDocument();
    expect(screen.getByLabelText("Filter by Color")).toBeInTheDocument();

    // From/to date pair for the visible Purchased column
    expect(screen.getByLabelText("Purchased from")).toBeInTheDocument();
    expect(screen.getByLabelText("Purchased to")).toBeInTheDocument();

    // The family column is presentational only (no family PII) — hidden by
    // default, and a plain header with no filter input or sort button when
    // revealed via the gear
    expect(screen.queryByRole("columnheader", { name: "Family" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Toggle columns" }));
    await user.click(screen.getByLabelText("Family"));
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(screen.getByRole("columnheader", { name: "Family" })).toBeInTheDocument());
    expect(screen.queryByLabelText("Filter by Family")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sort by Family" })).not.toBeInTheDocument();

    // No input for the non-searchable ID or sort-only Type column
    expect(screen.queryByLabelText("Filter by ID")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Filter by Type")).not.toBeInTheDocument();
  });

  it("sends debounced per-column filter values to the list endpoint", async () => {
    const user = userEvent.setup();
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 50 });
    try {
      vi.spyOn(api, "purchaserListWishes").mockResolvedValue(listResponse([adminLockedWish]));

      renderPage();

      await screen.findByText("Coat");

      await user.type(screen.getByLabelText("Filter by Size"), "S");
      await user.type(screen.getByLabelText("Filter by Description"), "coat");

      await waitFor(() => {
        expect(api.purchaserListWishes).toHaveBeenCalledWith(expect.objectContaining({ size: "S", description: "coat" }));
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("drag reorders columns, persists to localStorage, and survives remount", async () => {
    vi.spyOn(api, "purchaserListWishes").mockResolvedValue(listResponse([adminLockedWish, familyLockedWish]));

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

    expect(headerOrder()).toEqual(["", "ID", "Person", "Type", "Description", "Color", "Size", "Purchased", "Actions"]);
    expect(JSON.parse(localStorage.getItem("kim:columnOrder:purchaserAssignedGifts")!)).toEqual([
      "display_id",
      "person_given_name",
      "family_display_id",
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
    expect(headerOrder()).toEqual(["", "ID", "Person", "Type", "Description", "Color", "Size", "Purchased", "Actions"]);
  });
});
