import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/AuthContext";
import { CartProvider } from "../context/CartContext";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import { auth } from "../lib/queryKeys";
import type { DonorCart, DonorCartItem, FamilyWishListResponse, User } from "../types";
import DonorCartPage from "./DonorCart";

/* ------------------------------------------------------------------ */
// Fixtures
/* ------------------------------------------------------------------ */

const mockDonor: User = {
  id: 4,
  email: "donor@example.com",
  role: "donor",
  display_name: "Alice Donor",
  referrer_id: null,
  family_id: null,
  created_at: "2025-01-01T00:00:00Z",
};

const committedItem: DonorCartItem = {
  claim_id: 31,
  family: { id: 20, display_id: "3-1", bio: "The board-game family.", person_count: 4, min_age: 5, max_age: 12 },
  includes_groceries: false,
  line_total_usd: 500,
  payment_expires_at: "2099-12-04T00:00:00Z",
};

function cartResponse(items: DonorCartItem[], emailError: string | null = null): DonorCart {
  return {
    items,
    item_count: items.length,
    total_usd: items.reduce((sum, item) => sum + item.line_total_usd, 0),
    payment_expires_at: items[0]?.payment_expires_at ?? null,
    email_error: emailError,
  };
}

function wishList(displayId: string, claimStatus: string | null = null): FamilyWishListResponse {
  return {
    display_id: displayId,
    bio: "A family in need.",
    family_wish: "Wishes.",
    people: [{ given_name: "Alex", role: "son", age: 8, note: null, wishes: [] }],
    claimed_by_current_user: false,
    claim_status: claimStatus,
    claim_id: claimStatus != null ? 99 : null,
  };
}

/** An axios-shaped error (what the api layer throws on non-2xx). */
function httpError(status: number, detail: string): Error {
  const error = new Error("Request failed");
  (error as unknown as { response: { status: number; data: { detail: string } } }).response = { status, data: { detail } };
  return error;
}

/* ------------------------------------------------------------------ */
// Wrap
/* ------------------------------------------------------------------ */

function wrap(user: User | null = mockDonor) {
  vi.spyOn(api, "fetchCurrentUser").mockResolvedValue(user);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(auth, user);
  return render(
    <MemoryRouter initialEntries={["/donor/cart"]}>
      <QueryClientProvider client={queryClient}>
        <ToastContainer>
          <AuthProvider>
            <CartProvider>
              <Routes>
                <Route path="/donor/cart" element={<DonorCartPage />} />
                <Route path="/donor/claims" element={<div>claims page</div>} />
              </Routes>
            </CartProvider>
          </AuthProvider>
        </ToastContainer>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

function seedLocalCart(entries: { family_id: number; includes_groceries: boolean }[]) {
  localStorage.setItem("kim:cart:4", JSON.stringify(entries));
}

/* ------------------------------------------------------------------ */
// Tests
/* ------------------------------------------------------------------ */

describe("DonorCart", () => {
  let openMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // jsdom's window.open is a not-implemented stub — replace it with a spy
    openMock = vi.spyOn(window, "open").mockImplementation(() => null);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("shows the empty state when there is nothing to sponsor", async () => {
    vi.spyOn(api, "donorGetCart").mockResolvedValue(cartResponse([]));

    wrap();

    expect(await screen.findByText("Your sponsorship cart is empty.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Browse families to sponsor/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pay with Zeffy" })).not.toBeInTheDocument();
  });

  it("merges local and committed items and sums the total (incl. groceries)", async () => {
    seedLocalCart([{ family_id: 10, includes_groceries: true }]);
    vi.spyOn(api, "donorGetCart").mockResolvedValue(cartResponse([committedItem]));
    vi.spyOn(api, "getFamilyWishList").mockImplementation((familyId: number) => Promise.resolve(wishList(familyId === 10 ? "3-2" : "??")));

    wrap();

    // Committed item
    expect(await screen.findByText("3-1")).toBeInTheDocument();
    // Local item resolved via the wish list
    expect(await screen.findByText("3-2")).toBeInTheDocument();
    // 500 (committed, no groceries) + 600 (local, +groceries) = 1100
    expect(screen.getByText("$1100")).toBeInTheDocument();
    expect(screen.getByText("Total (2 families)")).toBeInTheDocument();
    // Pay button in the cart phase
    expect(screen.getByRole("button", { name: "Pay with Zeffy" })).toBeInTheDocument();
    // How-to-pay instructions: exact amount (Zeffy can't pre-fill it) +
    // tip-to-$0 screenshot
    expect(screen.getByRole("heading", { name: "How to pay on Zeffy" })).toBeInTheDocument();
    expect(screen.getByText(/Enter \$1100 exactly/)).toBeInTheDocument();
    expect(screen.getByText(/The 11% default tip goes to Zeffy, not the family/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Help keep Zeffy free/ })).toHaveAttribute("src", "/zeffy-tip-zero.png");
    // Reassurance that a non-matched payment is still handled
    expect(screen.getByText(/If your payment isn't auto-matched, no worries — an admin will match it manually/)).toBeInTheDocument();
    // No waiting-state controls yet
    expect(screen.queryByRole("button", { name: "I completed my payment" })).not.toBeInTheDocument();
  });

  it("checkout opens the Zeffy URL, clears the committed local items, and enters the waiting state", async () => {
    const user = userEvent.setup();
    seedLocalCart([{ family_id: 10, includes_groceries: true }]);

    const newItem: DonorCartItem = {
      claim_id: 32,
      family: { id: 10, display_id: "3-2", bio: "A family in need.", person_count: 2, min_age: 3, max_age: 8 },
      includes_groceries: true,
      line_total_usd: 600,
      payment_expires_at: "2099-12-04T00:00:00Z",
    };
    let committed = false;
    vi.spyOn(api, "donorGetCart").mockImplementation(() => Promise.resolve(committed ? cartResponse([newItem]) : cartResponse([])));
    vi.spyOn(api, "getFamilyWishList").mockImplementation((familyId: number) => Promise.resolve(wishList(`x-${familyId}`)));
    const checkoutSpy = vi.spyOn(api, "donorCartCheckout").mockImplementation(() => {
      committed = true;
      return Promise.resolve({ zeffy_url: "https://zeffy.example/form?email=donor@example.com", claim_ids: [32] });
    });

    wrap();

    await screen.findByRole("button", { name: "Pay with Zeffy" });
    await user.click(screen.getByRole("button", { name: "Pay with Zeffy" }));

    await waitFor(() => {
      expect(checkoutSpy).toHaveBeenCalledWith([{ family_id: 10, includes_groceries: true }]);
    });
    // The Zeffy form opens in a new tab (email pre-filled; the amount is
    // not — Zeffy can't pre-fill it, so the donor enters it by hand)
    expect(openMock).toHaveBeenCalledWith("https://zeffy.example/form?email=donor@example.com", "_blank", "noopener,noreferrer");
    // Waiting state now
    expect(await screen.findByRole("button", { name: "I completed my payment" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pay with Zeffy" })).not.toBeInTheDocument();
    // The how-to-pay instructions follow into the waiting state (the donor
    // is paying in the other tab), now showing the committed cart's total
    expect(screen.getByRole("heading", { name: "How to pay on Zeffy" })).toBeInTheDocument();
    expect(screen.getByText(/Enter \$600 exactly/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Help keep Zeffy free/ })).toHaveAttribute("src", "/zeffy-tip-zero.png");
    // Reassurance copy is always visible in the waiting state
    expect(screen.getByText("If your payment doesn't match automatically, an admin will review it within a day.")).toBeInTheDocument();
    // The local item left the local cart
    await waitFor(() => expect(JSON.parse(localStorage.getItem("kim:cart:4") ?? "[]")).toEqual([]));
    // The same family now shows as the committed row
    expect(screen.getByText("3-2")).toBeInTheDocument();
  });

  it("does not flash a false success panel while the post-checkout cart refetch is in flight", async () => {
    const user = userEvent.setup();
    seedLocalCart([{ family_id: 10, includes_groceries: false }]);

    // Initial fetch → empty cart (nothing committed yet). The refetch
    // triggered by the checkout invalidation hangs until we resolve it — a
    // real network round-trip always lands after the render that flips the
    // page to the waiting state, so the stale empty data is always visible.
    let resolveRefetch: ((value: DonorCart) => void) | null = null;
    let cartCalls = 0;
    vi.spyOn(api, "donorGetCart").mockImplementation(() => {
      cartCalls += 1;
      if (cartCalls === 1) return Promise.resolve(cartResponse([]));
      return new Promise<DonorCart>((resolve) => {
        resolveRefetch = resolve;
      });
    });
    vi.spyOn(api, "getFamilyWishList").mockImplementation((familyId: number) => Promise.resolve(wishList(`f-${familyId}`)));
    vi.spyOn(api, "donorCartCheckout").mockResolvedValue({
      zeffy_url: "https://zeffy.example/form?email=donor@example.com",
      claim_ids: [33],
    });

    wrap();

    await screen.findByRole("button", { name: "Pay with Zeffy" });
    await user.click(screen.getByRole("button", { name: "Pay with Zeffy" }));

    // Waiting state renders while the refetch is in flight — no false
    // success panel, no "cart is empty" card
    expect(await screen.findByRole("button", { name: "I completed my payment" })).toBeInTheDocument();
    expect(screen.queryByText("Your payment was received")).not.toBeInTheDocument();
    expect(screen.queryByText("Your sponsorship cart is empty.")).not.toBeInTheDocument();

    // Refetch lands with the committed item → committed row, still no success
    const newItem: DonorCartItem = {
      claim_id: 33,
      family: { id: 10, display_id: "3-2", bio: "A family in need.", person_count: 2, min_age: 3, max_age: 8 },
      includes_groceries: false,
      line_total_usd: 500,
      payment_expires_at: "2099-12-04T00:00:00Z",
    };
    await act(async () => {
      resolveRefetch?.(cartResponse([newItem]));
    });
    expect(await screen.findByText("3-2")).toBeInTheDocument();
    expect(screen.queryByText("Your payment was received")).not.toBeInTheDocument();
  });

  it("a 409 at checkout drops exactly the conflicted local family (id parsed from the detail)", async () => {
    const user = userEvent.setup();
    seedLocalCart([
      { family_id: 9, includes_groceries: false },
      { family_id: 8, includes_groceries: false },
    ]);
    vi.spyOn(api, "donorGetCart").mockResolvedValue(cartResponse([]));
    vi.spyOn(api, "getFamilyWishList").mockImplementation((familyId: number) => Promise.resolve(wishList(`f-${familyId}`)));
    vi.spyOn(api, "donorCartCheckout").mockRejectedValue(
      httpError(409, "Family 3-2-1 (id 9) was just sponsored — it has been removed from your cart")
    );

    wrap();

    await screen.findByRole("button", { name: "Pay with Zeffy" });
    await user.click(screen.getByRole("button", { name: "Pay with Zeffy" }));

    // The 409 detail is shown
    expect(await screen.findByText("Family 3-2-1 (id 9) was just sponsored — it has been removed from your cart")).toBeInTheDocument();
    // Family 9 is gone from the local cart; family 8 remains
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem("kim:cart:4") ?? "[]")).toEqual([{ family_id: 8, includes_groceries: false }]);
    });
    expect(screen.getByText("f-8")).toBeInTheDocument();
    expect(screen.queryByText("f-9")).not.toBeInTheDocument();
  });

  it("polls the cart in the waiting state and stops polling once the payment lands (success panel)", async () => {
    vi.useFakeTimers();
    try {
      let lastApplied = false;
      const cartSpy = vi
        .spyOn(api, "donorGetCart")
        .mockImplementation(() => Promise.resolve(lastApplied ? cartResponse([]) : cartResponse([committedItem])));

      wrap();

      // Flush the initial fetch (microtasks) — fake timers only fake clock time
      const flush = async (ms = 0) => {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(ms);
        });
      };

      // Arriving with a committed cart and nothing local → waiting state
      await flush();
      expect(screen.getByRole("button", { name: "I completed my payment" })).toBeInTheDocument();
      expect(screen.getByText("3-1")).toBeInTheDocument();

      // The webhook applies the payment between polls
      lastApplied = true;

      // Polling (15s) catches the empty cart → success panel
      for (let i = 0; i < 4 && !screen.queryByText("Your payment was received"); i++) {
        await flush(15_000);
      }
      expect(screen.getByText("Your payment was received")).toBeInTheDocument();
      // The success panel lists what was sponsored
      expect(screen.getByText(/Family 3-1/)).toBeInTheDocument();

      // Polling has stopped — advancing more time triggers no further fetches
      const calls = cartSpy.mock.calls.length;
      await flush(60_000);
      expect(cartSpy.mock.calls.length).toBe(calls);
    } finally {
      vi.useRealTimers();
    }
  });

  it("an expired cart emptied by the sweep shows the neutral empty state, not a false success", async () => {
    vi.useFakeTimers();
    try {
      let swept = false;
      const expiredItem: DonorCartItem = { ...committedItem, payment_expires_at: "2020-01-01T00:00:00Z" };
      vi.spyOn(api, "donorGetCart").mockImplementation(() => Promise.resolve(swept ? cartResponse([]) : cartResponse([expiredItem])));

      wrap();

      const flush = async (ms = 0) => {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(ms);
        });
      };

      // Arrive with an expired committed item → waiting state
      await flush();
      expect(screen.getByRole("button", { name: "I completed my payment" })).toBeInTheDocument();
      expect(screen.getByText("Expired")).toBeInTheDocument();

      // The hourly sweep soft-deletes the lapsed claim
      swept = true;
      for (let i = 0; i < 4 && screen.queryByText("Your sponsorship cart is empty.") == null; i++) {
        await flush(15_000);
      }

      // No payment was received — the neutral empty state, not the success panel
      expect(screen.getByText("Your sponsorship cart is empty.")).toBeInTheDocument();
      expect(screen.queryByText("Your payment was received")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the mismatch banner with both amounts and keeps the reassurance copy", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "donorGetCart").mockResolvedValue(cartResponse([committedItem]));
    vi.spyOn(api, "donorCartConfirm").mockResolvedValue({ status: "mismatch", expected_usd: 500, found_usd: 600 });

    wrap();

    const confirmButton = await screen.findByRole("button", { name: "I completed my payment" });
    await user.click(confirmButton);

    expect(
      await screen.findByText("We found a payment of $600, but your cart total is $500. An admin will match it manually.")
    ).toBeInTheDocument();
    expect(screen.getByText("If your payment doesn't match automatically, an admin will review it within a day.")).toBeInTheDocument();
  });

  it("shows an inline hint on confirm 429 (no error toast)", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "donorGetCart").mockResolvedValue(cartResponse([committedItem]));
    vi.spyOn(api, "donorCartConfirm").mockRejectedValue(httpError(429, "Rate limit exceeded. try again in a moment"));

    wrap();

    const confirmButton = await screen.findByRole("button", { name: "I completed my payment" });
    await user.click(confirmButton);

    expect(await screen.findByText("Rate limit exceeded. try again in a moment")).toBeInTheDocument();
  });

  it("a pending confirm result clears a previous mismatch", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "donorGetCart").mockResolvedValue(cartResponse([committedItem]));
    const confirmSpy = vi
      .spyOn(api, "donorCartConfirm")
      .mockResolvedValueOnce({ status: "mismatch", expected_usd: 500, found_usd: 600 })
      .mockResolvedValueOnce({ status: "pending" });

    wrap();

    const confirmButton = await screen.findByRole("button", { name: "I completed my payment" });
    await user.click(confirmButton);
    expect(await screen.findByText(/We found a payment of \$600/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "I completed my payment" }));
    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByText(/We found a payment of/)).not.toBeInTheDocument();
  });

  it("renders expired committed items (past payment_expires_at) as expired", async () => {
    const expired: DonorCartItem = { ...committedItem, payment_expires_at: "2020-01-01T00:00:00Z" };
    vi.spyOn(api, "donorGetCart").mockResolvedValue(cartResponse([expired]));

    wrap();

    expect(await screen.findByText("Expired")).toBeInTheDocument();
    expect(screen.getByText(/Payment window closed/)).toBeInTheDocument();
    // Groceries is locked on expired items
    const checkbox = screen.getByLabelText("Groceries for family 3-1") as HTMLInputElement;
    expect(checkbox).toBeDisabled();
  });

  it("shows the payment-window note for committed items", async () => {
    vi.spyOn(api, "donorGetCart").mockResolvedValue(cartResponse([committedItem]));

    wrap();

    expect(await screen.findByText(/Complete your payment by/)).toBeInTheDocument();
  });

  it("renders a local item as unavailable when its wish list no longer resolves", async () => {
    seedLocalCart([{ family_id: 999, includes_groceries: false }]);
    vi.spyOn(api, "donorGetCart").mockResolvedValue(cartResponse([]));
    vi.spyOn(api, "getFamilyWishList").mockRejectedValue(httpError(404, "Family not found"));

    wrap();

    expect(await screen.findByText("No longer available")).toBeInTheDocument();
    expect(screen.getByText("Family 999")).toBeInTheDocument();
  });

  it("renders a local item as unavailable when the family was claimed in the meantime", async () => {
    seedLocalCart([{ family_id: 998, includes_groceries: false }]);
    vi.spyOn(api, "donorGetCart").mockResolvedValue(cartResponse([]));
    vi.spyOn(api, "getFamilyWishList").mockResolvedValue(wishList("3-9", "active"));

    wrap();

    expect(await screen.findByText("No longer available")).toBeInTheDocument();
    // Still removable
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Remove family 998" }));
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem("kim:cart:4") ?? "[]")).toEqual([]);
    });
  });

  it("removes a local item directly without a confirm dialog", async () => {
    const user = userEvent.setup();
    seedLocalCart([{ family_id: 10, includes_groceries: false }]);
    vi.spyOn(api, "donorGetCart").mockResolvedValue(cartResponse([]));
    vi.spyOn(api, "getFamilyWishList").mockImplementation((familyId: number) => Promise.resolve(wishList(`f-${familyId}`)));

    wrap();

    await screen.findByRole("button", { name: "Remove family 10" });
    await user.click(screen.getByRole("button", { name: "Remove family 10" }));

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem("kim:cart:4") ?? "[]")).toEqual([]);
    });
    expect(screen.getByText("Your sponsorship cart is empty.")).toBeInTheDocument();
  });

  it("removes a committed item via the confirm dialog and cancels the claim", async () => {
    const user = userEvent.setup();
    let cancelled = false;
    vi.spyOn(api, "donorCancelClaim").mockImplementation(() => {
      cancelled = true;
      return Promise.resolve(undefined);
    });
    vi.spyOn(api, "donorGetCart").mockImplementation(() => Promise.resolve(cancelled ? cartResponse([]) : cartResponse([committedItem])));
    const cancelSpy = api.donorCancelClaim;

    wrap();

    await screen.findByRole("button", { name: "I completed my payment" }); // waiting phase
    await user.click(screen.getByRole("button", { name: "Remove family 3-1" }));

    expect(await screen.findByRole("button", { name: "Yes, cancel" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Yes, cancel" }));

    await waitFor(() => {
      expect(cancelSpy).toHaveBeenCalledWith(31);
    });
    expect(await screen.findByText("Sponsorship cancelled")).toBeInTheDocument();
    // Cancelling (not paying) empties the cart into the neutral state, no success panel
    expect(screen.queryByText("Your payment was received")).not.toBeInTheDocument();
    expect(await screen.findByText("Your sponsorship cart is empty.")).toBeInTheDocument();
  });

  it("toggling groceries on a committed item re-fetches the cart", async () => {
    const user = userEvent.setup();
    let withGroceries = false;
    vi.spyOn(api, "donorToggleCartGroceries").mockImplementation((_claimId: number, value: boolean) => {
      withGroceries = value;
      return Promise.resolve({ ...committedItem, includes_groceries: value, line_total_usd: value ? 600 : 500 });
    });
    vi.spyOn(api, "donorGetCart").mockImplementation(() =>
      Promise.resolve(cartResponse([{ ...committedItem, includes_groceries: withGroceries, line_total_usd: withGroceries ? 600 : 500 }]))
    );
    const toggleSpy = api.donorToggleCartGroceries;

    wrap();

    await screen.findByRole("button", { name: "I completed my payment" });
    const checkbox = screen.getByLabelText("Groceries for family 3-1") as HTMLInputElement;
    expect(checkbox).not.toBeChecked();
    await user.click(checkbox);

    await waitFor(() => {
      expect(toggleSpy).toHaveBeenCalledWith(31, true);
    });
    // Total reflects the server-side line price after invalidation (row + total)
    await waitFor(() => expect(screen.getAllByText("$600").length).toBe(2));
    expect(checkbox).toBeChecked();
  });

  it("reopening the payment form in the waiting state is a pure re-checkout (no local items)", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "donorGetCart").mockResolvedValue(cartResponse([committedItem]));
    const checkoutSpy = vi.spyOn(api, "donorCartCheckout").mockResolvedValue({ zeffy_url: "https://zeffy.example/again", claim_ids: [] });

    wrap();

    await screen.findByRole("button", { name: "I completed my payment" });
    await user.click(screen.getByRole("button", { name: "Reopen payment form" }));

    await waitFor(() => {
      expect(checkoutSpy).toHaveBeenCalledWith([]);
    });
    expect(openMock).toHaveBeenCalledWith("https://zeffy.example/again", "_blank", "noopener,noreferrer");
  });

  it("shows the email nudge failure note when set", async () => {
    vi.spyOn(api, "donorGetCart").mockResolvedValue(cartResponse([committedItem], "We couldn't email you the payment link: SMTP down"));

    wrap();

    expect(await screen.findByText("We couldn't email you the payment link: SMTP down")).toBeInTheDocument();
  });

  it("shows an error page when the cart query fails", async () => {
    vi.spyOn(api, "donorGetCart").mockRejectedValue(new Error("boom"));

    wrap();

    expect(await screen.findByText("Unable to Load Cart")).toBeInTheDocument();
  });

  it("shows the error page for non-2xx without a JSON body too", async () => {
    vi.spyOn(api, "donorGetCart").mockRejectedValue(httpError(500, "Internal Server Error"));

    wrap();

    expect(await screen.findByText("Unable to Load Cart")).toBeInTheDocument();
    expect(screen.getByText("Internal Server Error")).toBeInTheDocument();
  });
});
