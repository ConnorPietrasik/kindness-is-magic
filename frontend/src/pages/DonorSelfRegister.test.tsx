import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/AuthContext";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import { getPendingClaimFamilyId, setPendingClaimFamilyId } from "../lib/utils";
import type { DonorSelfRegisterResponse, User } from "../types";
import DonorSelfRegister from "./DonorSelfRegister";

const mockUser: User = {
  id: 20,
  email: "donor@example.com",
  role: "donor",
  display_name: "Test Donor",
  referrer_id: null,
  family_id: null,
  created_at: "2025-01-14T12:00:00Z",
};

const mockResponse: DonorSelfRegisterResponse = { user: mockUser };

const createQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

/** Renders the current location so tests can assert on post-registration navigation. */
function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}|{JSON.stringify(location.state)}
    </div>
  );
}

const wrap = (path = "/register-donor") => {
  const queryClient = createQueryClient();
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={queryClient}>
        <ToastContainer>
          <AuthProvider>
            <LocationProbe />
            <Routes>
              <Route path="/register-donor" element={<DonorSelfRegister />} />
              <Route path="/dashboard" element={<div>dashboard-page</div>} />
              <Route path="/families/:id/wish-list" element={<div>wish-list-page</div>} />
            </Routes>
          </AuthProvider>
        </ToastContainer>
      </QueryClientProvider>
    </MemoryRouter>
  );
};

const fillForm = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByLabelText("Display Name"), "Test Donor");
  await user.type(screen.getByLabelText("Email"), "donor@example.com");
  await user.type(screen.getByLabelText("Password"), "password123");
  await user.type(screen.getByLabelText("Confirm Password"), "password123");
};

describe("DonorSelfRegister", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("renders all form fields", () => {
    vi.spyOn(api, "fetchCurrentUser").mockResolvedValue(null);
    wrap();

    expect(screen.getByLabelText("Display Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Account" })).toBeInTheDocument();
  });

  it("shows error when passwords do not match", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "fetchCurrentUser").mockResolvedValue(null);
    wrap();

    await fillForm(user);
    await user.clear(screen.getByLabelText("Confirm Password"));
    await user.type(screen.getByLabelText("Confirm Password"), "different1");
    await user.click(screen.getByRole("button", { name: "Create Account" }));

    expect(screen.getByText("Passwords do not match.")).toBeInTheDocument();
  });

  it("navigates to the dashboard after registration when no family was pending", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "fetchCurrentUser").mockResolvedValue(null);
    vi.spyOn(api, "registerDonor").mockResolvedValue(mockResponse);
    wrap();

    await fillForm(user);
    await user.click(screen.getByRole("button", { name: "Create Account" }));

    await screen.findByText("dashboard-page");
    expect(api.registerDonor).toHaveBeenCalledWith({
      display_name: "Test Donor",
      email: "donor@example.com",
      password: "password123",
    });
    expect(screen.getByTestId("location")).toHaveTextContent("/dashboard|null");
  });

  it("navigates to the pending family's wish list with the claim modal open", async () => {
    const user = userEvent.setup();
    setPendingClaimFamilyId(7);
    vi.spyOn(api, "fetchCurrentUser").mockResolvedValue(null);
    vi.spyOn(api, "registerDonor").mockResolvedValue(mockResponse);
    wrap();

    await fillForm(user);
    await user.click(screen.getByRole("button", { name: "Create Account" }));

    await screen.findByText("wish-list-page");
    expect(screen.getByTestId("location")).toHaveTextContent('/families/7/wish-list|{"openClaim":true}');
    // Pending id is consumed
    expect(getPendingClaimFamilyId()).toBeNull();
  });
});
