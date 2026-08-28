import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/AuthContext";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import { getPendingClaimFamilyId } from "../lib/utils";
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

    expect(screen.getByRole("heading", { name: "Sign in to Claim" })).toBeInTheDocument();
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
