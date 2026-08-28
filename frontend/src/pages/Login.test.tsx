import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/AuthContext";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import { ROUTES } from "../lib/routes";
import { getPendingClaimFamilyId, setPendingClaimFamilyId } from "../lib/utils";
import type { User } from "../types";
import Login from "./Login";

const donorUser: User = {
  id: 10,
  email: "donor@example.com",
  role: "donor",
  display_name: "Test Donor",
  referrer_id: null,
  family_id: null,
  created_at: "2025-01-14T12:00:00Z",
};

const familyUser: User = {
  ...donorUser,
  id: 11,
  email: "family@example.com",
  role: "family",
  family_id: 3,
};

const createQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

/** Renders the current location so tests can assert on post-login navigation. */
function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}|{JSON.stringify(location.state)}
    </div>
  );
}

const wrap = () => {
  const queryClient = createQueryClient();
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <QueryClientProvider client={queryClient}>
        <ToastContainer>
          <AuthProvider>
            <LocationProbe />
            <Login />
          </AuthProvider>
        </ToastContainer>
      </QueryClientProvider>
    </MemoryRouter>
  );
};

const fillLoginForm = async (user: ReturnType<typeof userEvent.setup>, email: string) => {
  await user.type(screen.getByLabelText("Email"), email);
  await user.type(screen.getByLabelText("Password"), "password123");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
};

describe("Login post-login redirect", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    cleanup();
  });

  it("navigates to the dashboard when no family was pending", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "fetchCurrentUser").mockResolvedValue(null);
    vi.spyOn(api, "loginRequest").mockResolvedValue({ data: { user: donorUser } } as never);
    wrap();

    await fillLoginForm(user, "donor@example.com");

    expect(screen.getByTestId("location")).toHaveTextContent(`${ROUTES.DASHBOARD}|null`);
  });

  it("navigates to the pending family's wish list with the claim modal open and consumes the id", async () => {
    const user = userEvent.setup();
    setPendingClaimFamilyId(7);
    vi.spyOn(api, "fetchCurrentUser").mockResolvedValue(null);
    vi.spyOn(api, "loginRequest").mockResolvedValue({ data: { user: donorUser } } as never);
    wrap();

    await fillLoginForm(user, "donor@example.com");

    expect(screen.getByTestId("location")).toHaveTextContent('/families/7/wish-list|{"openClaim":true}');
    expect(getPendingClaimFamilyId()).toBeNull();
  });

  it("family users go to the family dashboard even with a pending family", async () => {
    const user = userEvent.setup();
    setPendingClaimFamilyId(7);
    vi.spyOn(api, "fetchCurrentUser").mockResolvedValue(null);
    vi.spyOn(api, "loginRequest").mockResolvedValue({ data: { user: familyUser } } as never);
    wrap();

    await fillLoginForm(user, "family@example.com");

    expect(screen.getByTestId("location")).toHaveTextContent(`${ROUTES.FAMILY_DASHBOARD}|null`);
    expect(getPendingClaimFamilyId()).toBeNull();
  });
});
