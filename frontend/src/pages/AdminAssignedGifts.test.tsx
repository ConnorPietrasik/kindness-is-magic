import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
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
});
