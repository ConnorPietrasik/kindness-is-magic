import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/AuthContext";
import { CartProvider } from "../context/CartContext";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import { getPendingClaimFamilyId } from "../lib/utils";
import type { Deadline, FamilyClaimSummary } from "../types";
import { ClaimModal } from "./ClaimModal";

const createQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

/** Renders the current location so tests can assert on navigation targets. */
function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}|{JSON.stringify(location.state)}
    </div>
  );
}

/** Renders the open guest auth-gate modal at a wish-list location. */
function Host() {
  const location = useLocation();
  return <ClaimModal familyId={5} open onClose={() => {}} currentLocation={location} />;
}

const wrap = () => {
  const queryClient = createQueryClient();
  return render(
    <MemoryRouter initialEntries={["/families/5/wish-list"]}>
      <QueryClientProvider client={queryClient}>
        <ToastContainer>
          <AuthProvider>
            <CartProvider>
              <LocationProbe />
              <Host />
            </CartProvider>
          </AuthProvider>
        </ToastContainer>
      </QueryClientProvider>
    </MemoryRouter>
  );
};

describe("ClaimModal guest auth gate", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    cleanup();
  });

  it("Sign in remembers the family and carries the wish list as the login destination", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "fetchCurrentUser").mockResolvedValue(null);
    wrap();

    expect(screen.getByRole("heading", { name: "Sign in to Sponsor" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(screen.getByTestId("location")).toHaveTextContent("/login|");
    // Login page reads state.from.pathname as the post-login destination
    expect(screen.getByTestId("location")).toHaveTextContent('"pathname":"/families/5/wish-list"');
    expect(getPendingClaimFamilyId()).toBe(5);
  });

  it("Register remembers the family and navigates to donor self-registration", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "fetchCurrentUser").mockResolvedValue(null);
    wrap();

    await user.click(screen.getByRole("button", { name: "Register" }));

    // No router state — the redirect is driven by the stored pending family id
    expect(screen.getByTestId("location")).toHaveTextContent("/register-donor|null");
    expect(getPendingClaimFamilyId()).toBe(5);
  });
});

/* ------------------------------------------------------------------ */
// Authenticated claim → success view
/* ------------------------------------------------------------------ */

const mockDonorUser = {
  id: 4,
  email: "donor@example.com",
  role: "donor" as const,
  display_name: "Alice Donor",
  referrer_id: null,
  family_id: null,
  created_at: "2025-01-01T00:00:00Z",
};

const giftDeadline: Deadline = {
  id: 1,
  type: "gift_dropoff",
  label: "Gift drop-off",
  due_date: "2025-12-15",
  mode: "display",
  created_at: "2025-01-01T00:00:00Z",
};

const giftsClaim: FamilyClaimSummary = {
  id: 77,
  family: { id: 5, display_id: "12-3", bio: null, person_count: 4, min_age: 2, max_age: 39 },
  commitment_type: "gifts",
  payment_status: "paid",
  notes: null,
  created_at: "2025-12-01T00:00:00Z",
  fulfilled_at: null,
  paid_at: null,
  payment_expires_at: null,
  zeffy_payment_id: null,
  includes_groceries: false,
};

function renderAuthedClaim(claim: FamilyClaimSummary, deadlines: Deadline[] = []) {
  vi.spyOn(api, "fetchCurrentUser").mockResolvedValue(mockDonorUser);
  vi.spyOn(api, "claimFamily").mockResolvedValue(claim);
  vi.spyOn(api, "listDeadlines").mockResolvedValue({ deadlines });
  const queryClient = createQueryClient();
  return render(
    <MemoryRouter initialEntries={["/families/5/wish-list"]}>
      <QueryClientProvider client={queryClient}>
        <ToastContainer>
          <AuthProvider>
            <CartProvider>
              <LocationProbe />
              <ClaimModal familyId={5} open onClose={() => {}} />
            </CartProvider>
          </AuthProvider>
        </ToastContainer>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

/** Host that actually closes the modal on onClose, like the page does. */
function StatefulHost({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <ClaimModal
      familyId={5}
      open={open}
      onClose={() => {
        setOpen(false);
        onClose();
      }}
    />
  );
}

function renderStatefulClaim(claim: FamilyClaimSummary, onClose: () => void) {
  vi.spyOn(api, "fetchCurrentUser").mockResolvedValue(mockDonorUser);
  vi.spyOn(api, "claimFamily").mockResolvedValue(claim);
  vi.spyOn(api, "listDeadlines").mockResolvedValue({ deadlines: [] });
  const queryClient = createQueryClient();
  return render(
    <MemoryRouter initialEntries={["/families/5/wish-list"]}>
      <QueryClientProvider client={queryClient}>
        <ToastContainer>
          <AuthProvider>
            <CartProvider>
              <LocationProbe />
              <StatefulHost onClose={onClose} />
            </CartProvider>
          </AuthProvider>
        </ToastContainer>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

/** Waits for the claim form, optionally picks cash, submits, and waits for the success heading. */
async function submitClaim(user: ReturnType<typeof userEvent.setup>, commitment: "gifts" | "cash" = "gifts") {
  await screen.findByRole("button", { name: "Sponsor family" });
  if (commitment === "cash") {
    await user.click(screen.getByRole("radio", { name: /monetary support/ }));
  }
  await user.click(screen.getByRole("button", { name: commitment === "cash" ? "Add to cart" : "Sponsor family" }));
  await screen.findByRole("heading", { name: commitment === "cash" ? "Added to your cart" : /You made Family 12-3/ });
}

describe("ClaimModal success view", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    cleanup();
  });

  it("gifts success celebrates, shows email + deadline lines, and navigates to the claim detail", async () => {
    const user = userEvent.setup();
    renderAuthedClaim(giftsClaim, [giftDeadline]);

    await submitClaim(user);

    expect(screen.getByRole("heading", { name: /You made Family 12-3's Christmas magical/ })).toBeInTheDocument();
    expect(screen.getByText("We've emailed you the family's full wish list.")).toBeInTheDocument();
    expect(screen.getByText(/Drop your wrapped gifts off by/)).toBeInTheDocument();
    // The form is replaced by the success view
    expect(screen.queryByRole("heading", { name: "Sponsor This Family" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "View your sponsorship" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/donor/claims/77");
  });

  it("omits the deadline line when no gift_dropoff row exists", async () => {
    const user = userEvent.setup();
    renderAuthedClaim(giftsClaim, []);

    await submitClaim(user);

    expect(screen.queryByText(/Drop your wrapped gifts off by/)).not.toBeInTheDocument();
  });

  it("email failure swaps in the fallback line instead of the email line", async () => {
    const user = userEvent.setup();
    renderAuthedClaim({ ...giftsClaim, email_error: "SMTP down" });

    await submitClaim(user);

    expect(screen.getByText("We couldn't email you the wish list — you can view it on your sponsorship page.")).toBeInTheDocument();
    expect(screen.queryByText("We've emailed you the family's full wish list.")).not.toBeInTheDocument();
  });

  it("cash adds to the local cart without calling the claim API, and offers the cart CTA", async () => {
    const user = userEvent.setup();
    const claimSpy = vi.spyOn(api, "claimFamily");
    renderAuthedClaim(giftsClaim);

    await submitClaim(user, "cash");

    expect(screen.getByRole("heading", { name: "Added to your cart" })).toBeInTheDocument();
    // No claim was created — the cash door is checkout-only
    expect(claimSpy).not.toHaveBeenCalled();
    // The family is in the local cart, keyed by the donor's user id
    const stored = JSON.parse(localStorage.getItem("kim:cart:4") ?? "[]") as { family_id: number; includes_groceries: boolean }[];
    expect(stored).toEqual([{ family_id: 5, includes_groceries: false }]);
    // No external donation link (the old DONATE_URL path is gone)
    expect(screen.queryByRole("link", { name: "Complete your donation" })).not.toBeInTheDocument();
  });

  it("cart CTA closes the modal and navigates to the donor cart", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderStatefulClaim(giftsClaim, onClose);

    await submitClaim(user, "cash");
    await user.click(screen.getByRole("button", { name: "Go to cart & checkout" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("location")).toHaveTextContent("/donor/cart");
  });

  it("Keep browsing closes the modal without navigating", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderStatefulClaim(giftsClaim, onClose);

    await submitClaim(user);

    await user.click(screen.getByRole("button", { name: "Keep browsing" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("heading", { name: /You made Family 12-3/ })).not.toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/families/5/wish-list");
  });
});
