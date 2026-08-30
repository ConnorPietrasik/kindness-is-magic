import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import type { PurchaserWishSummary, WishDetail } from "../types";
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
  });

  it("renders assigned wishes and only links admin-locked families", async () => {
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

    // Admin-locked family links to the public wishlist
    expect(screen.getByText("2-1", { selector: "a" })).toHaveAttribute("href", "/families/5/wish-list");
    // Family-locked family has no public page — plain text, no link
    expect(screen.queryByText("2-2", { selector: "a" })).not.toBeInTheDocument();
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
});
