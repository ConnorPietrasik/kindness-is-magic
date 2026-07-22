import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/AuthContext";
import * as api from "../lib/api";
import type { ReferrerSelfRegisterResponse, User } from "../types";
import ReferrerSelfRegister from "./ReferrerSelfRegister";

const mockUser: User = {
  id: 5,
  email: "newreferrer@example.com",
  role: "referrer",
  referrer_id: 5,
  family_id: null,
  is_active: true,
  created_at: "2025-01-14T12:00:00Z",
};

const mockResponse: ReferrerSelfRegisterResponse = {
  user: mockUser,
  referrer: {
    id: 5,
    name: "New Referrer",
    family_limit: 10,
    family_invite_code: "KFI-ABC123",
    deleted_at: null,
  },
};

const createQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const wrap = (ui: React.ReactElement) => {
  const queryClient = createQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter>{ui}</MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
};

describe("ReferrerSelfRegister", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("renders all form fields", () => {
    wrap(<ReferrerSelfRegister />);
    expect(screen.getByLabelText("Invite Code")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Phone Number")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Account" })).toBeInTheDocument();
  });

  it("shows error when passwords do not match", async () => {
    const user = userEvent.setup();
    wrap(<ReferrerSelfRegister />);

    await user.type(screen.getByLabelText("Invite Code"), "KMG-TEST1");
    await user.type(screen.getByLabelText("Name"), "Test Referrer");
    await user.type(screen.getByLabelText("Email"), "test@example.com");
    await user.type(screen.getByLabelText("Phone Number"), "07123 456789");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.type(screen.getByLabelText("Confirm Password"), "different1");

    await user.click(screen.getByRole("button", { name: "Create Account" }));

    expect(screen.getByText("Passwords do not match.")).toBeInTheDocument();
  });

  it("shows error when password is too short", async () => {
    const user = userEvent.setup();
    wrap(<ReferrerSelfRegister />);

    await user.type(screen.getByLabelText("Invite Code"), "KMG-TEST1");
    await user.type(screen.getByLabelText("Name"), "Test Referrer");
    await user.type(screen.getByLabelText("Email"), "test@example.com");
    await user.type(screen.getByLabelText("Phone Number"), "07123 456789");
    await user.type(screen.getByLabelText("Password"), "short");
    await user.type(screen.getByLabelText("Confirm Password"), "short");

    await user.click(screen.getByRole("button", { name: "Create Account" }));

    expect(screen.getByText("Password must be at least 8 characters.")).toBeInTheDocument();
  });

  it("calls registerReferrerViaInvite with correct payload on valid submission", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "registerReferrerViaInvite").mockResolvedValue(mockResponse);

    wrap(<ReferrerSelfRegister />);

    await user.type(screen.getByLabelText("Invite Code"), "KMG-TEST1");
    await user.type(screen.getByLabelText("Name"), "Test Referrer");
    await user.type(screen.getByLabelText("Email"), "test@example.com");
    await user.type(screen.getByLabelText("Phone Number"), "07123 456789");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.type(screen.getByLabelText("Confirm Password"), "password123");

    await user.click(screen.getByRole("button", { name: "Create Account" }));

    await waitFor(() => {
      expect(api.registerReferrerViaInvite).toHaveBeenCalledWith({
        code: "KMG-TEST1",
        name: "Test Referrer",
        email: "test@example.com",
        phone_number: "07123 456789",
        password: "password123",
      });
    });
  });

  it("shows error message when API returns invalid code error", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "registerReferrerViaInvite").mockRejectedValue({
      response: { data: { detail: "Invalid or already-used invite code" } },
    });

    wrap(<ReferrerSelfRegister />);

    await user.type(screen.getByLabelText("Invite Code"), "INVALID");
    await user.type(screen.getByLabelText("Name"), "Test Referrer");
    await user.type(screen.getByLabelText("Email"), "test@example.com");
    await user.type(screen.getByLabelText("Phone Number"), "07123 456789");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.type(screen.getByLabelText("Confirm Password"), "password123");

    await user.click(screen.getByRole("button", { name: "Create Account" }));

    await waitFor(() => {
      expect(screen.getByText("Invalid or already-used invite code")).toBeInTheDocument();
    });
  });

  it("shows error message when API returns expired code error", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "registerReferrerViaInvite").mockRejectedValue({
      response: { data: { detail: "Invite code has expired" } },
    });

    wrap(<ReferrerSelfRegister />);

    await user.type(screen.getByLabelText("Invite Code"), "KMG-OLD");
    await user.type(screen.getByLabelText("Name"), "Test Referrer");
    await user.type(screen.getByLabelText("Email"), "test@example.com");
    await user.type(screen.getByLabelText("Phone Number"), "07123 456789");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.type(screen.getByLabelText("Confirm Password"), "password123");

    await user.click(screen.getByRole("button", { name: "Create Account" }));

    await waitFor(() => {
      expect(screen.getByText("Invite code has expired")).toBeInTheDocument();
    });
  });

  it("shows error message when API returns duplicate email error", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "registerReferrerViaInvite").mockRejectedValue({
      response: { data: { detail: "Email already registered" } },
    });

    wrap(<ReferrerSelfRegister />);

    await user.type(screen.getByLabelText("Invite Code"), "KMG-TEST1");
    await user.type(screen.getByLabelText("Name"), "Test Referrer");
    await user.type(screen.getByLabelText("Email"), "existing@example.com");
    await user.type(screen.getByLabelText("Phone Number"), "07123 456789");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.type(screen.getByLabelText("Confirm Password"), "password123");

    await user.click(screen.getByRole("button", { name: "Create Account" }));

    await waitFor(() => {
      expect(screen.getByText("Email already registered")).toBeInTheDocument();
    });
  });

  it("shows loading state on submit button", async () => {
    const user = userEvent.setup();
    let resolve: () => void;
    vi.spyOn(api, "registerReferrerViaInvite").mockReturnValue(
      new Promise((res) => {
        resolve = () => res(mockResponse);
      })
    );

    wrap(<ReferrerSelfRegister />);

    await user.type(screen.getByLabelText("Invite Code"), "KMG-TEST1");
    await user.type(screen.getByLabelText("Name"), "Test Referrer");
    await user.type(screen.getByLabelText("Email"), "test@example.com");
    await user.type(screen.getByLabelText("Phone Number"), "07123 456789");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.type(screen.getByLabelText("Confirm Password"), "password123");

    await user.click(screen.getByRole("button", { name: "Create Account" }));

    expect(screen.getByText("Creating account…")).toBeInTheDocument();

    resolve!();
  });

  it("shows a link back to login", () => {
    wrap(<ReferrerSelfRegister />);
    expect(screen.getByText("← Back to login")).toBeInTheDocument();
  });
});
