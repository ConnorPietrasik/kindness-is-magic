import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/AuthContext";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import { DONATE_URL } from "../lib/links";
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
            <LocationProbe />
            <Host />
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
  notes: null,
  created_at: "2025-12-01T00:00:00Z",
  fulfilled_at: null,
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
            <LocationProbe />
            <ClaimModal familyId={5} open onClose={() => {}} />
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
            <LocationProbe />
            <StatefulHost onClose={onClose} />
          </AuthProvider>
        </ToastContainer>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

/** Waits for the claim form, optionally picks cash, submits, and waits for the success heading. */
async function submitClaim(user: ReturnType<typeof userEvent.setup>, commitment: "gifts" | "cash" = "gifts") {
  await screen.findByRole("button", { name: "Sponsor Family" });
  if (commitment === "cash") {
    await user.click(screen.getByRole("radio", { name: /monetary support/ }));
  }
  await user.click(screen.getByRole("button", { name: "Sponsor Family" }));
  await screen.findByRole("heading", { name: /You made Family 12-3/ });
}

describe("ClaimModal success view", () => {
  afterEach(() => {
    vi.restoreAllMocks();
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

  it("cash success shows the volunteer line and donation link, not the gifts lines", async () => {
    const user = userEvent.setup();
    renderAuthedClaim({ ...giftsClaim, commitment_type: "cash" }, [giftDeadline]);

    await submitClaim(user, "cash");

    expect(screen.getByText("Our volunteers will purchase the family's wishes with your donation.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Complete your donation" })).toHaveAttribute("href", DONATE_URL);
    expect(screen.queryByText("We've emailed you the family's full wish list.")).not.toBeInTheDocument();
    expect(screen.queryByText(/Drop your wrapped gifts off by/)).not.toBeInTheDocument();
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
