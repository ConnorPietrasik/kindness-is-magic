import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/AuthContext";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import type { ReferrerSelfRegisterResponse, User } from "../types";
import ReferrerSelfRegister from "./ReferrerSelfRegister";

const mockUser: User = {
  id: 5,
  email: "newreferrer@example.com",
  role: "referrer",
  display_name: null,
  referrer_id: 5,
  family_id: null,
  created_at: "2025-01-14T12:00:00Z",
};

const mockResponse: ReferrerSelfRegisterResponse = {
  user: mockUser,
  referrer: {
    id: 5,
    name: "New Referrer",
    family_limit: 10,
    family_count: 0,
    family_invite_code: "KFI-ABC123",
    approval_status: "pending",
    approved_by_admin_name: null,
    approved_at: null,
    deleted_at: null,
  },
};

const createQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const wrap = (ui: React.ReactElement, path = "/register-referrer") => {
  const queryClient = createQueryClient();
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={queryClient}>
        <ToastContainer>
          <AuthProvider>{ui}</AuthProvider>
        </ToastContainer>
      </QueryClientProvider>
    </MemoryRouter>
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
        phone_number: "07123456789",
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

  // ── URL param autofill tests ──────────────────────────────────

  it("pre-fills code and email from URL params and locks both fields", () => {
    wrap(<ReferrerSelfRegister />, "/register-referrer?code=KMG-AUTO&email=locked@example.com");

    const codeInput = screen.getByLabelText("Invite Code");
    const emailInput = screen.getByLabelText("Email");

    expect(codeInput).toHaveValue("KMG-AUTO");
    expect(codeInput).toHaveAttribute("readonly");
    expect(emailInput).toHaveValue("locked@example.com");
    expect(emailInput).toHaveAttribute("readonly");
  });

  it("shows info message when email is locked from URL", () => {
    wrap(<ReferrerSelfRegister />, "/register-referrer?code=KMG-AUTO&email=locked@example.com");

    expect(screen.getByText(/This invite is for/)).toBeInTheDocument();
    expect(screen.getByText(/locked@example.com/)).toBeInTheDocument();
  });

  it("pre-fills code from URL but leaves email editable when no email param", () => {
    wrap(<ReferrerSelfRegister />, "/register-referrer?code=KMG-CODEONLY");

    const codeInput = screen.getByLabelText("Invite Code");
    const emailInput = screen.getByLabelText("Email");

    expect(codeInput).toHaveValue("KMG-CODEONLY");
    expect(codeInput).toHaveAttribute("readonly");
    expect(emailInput).toHaveValue("");
    expect(emailInput).not.toHaveAttribute("readonly");
  });

  it("leaves both fields editable when no URL params", () => {
    wrap(<ReferrerSelfRegister />, "/register-referrer");

    const codeInput = screen.getByLabelText("Invite Code");
    const emailInput = screen.getByLabelText("Email");

    expect(codeInput).toHaveValue("");
    expect(codeInput).not.toHaveAttribute("readonly");
    expect(emailInput).toHaveValue("");
    expect(emailInput).not.toHaveAttribute("readonly");
  });

  it("submits with pre-filled values from URL params", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "registerReferrerViaInvite").mockResolvedValue(mockResponse);
    vi.spyOn(api, "fetchCurrentUser").mockResolvedValue(null);

    wrap(<ReferrerSelfRegister />, "/register-referrer?code=KMG-AUTO&email=locked@example.com");

    // Code and email are pre-filled, just fill remaining fields
    await user.type(screen.getByLabelText("Name"), "Test Referrer");
    await user.type(screen.getByLabelText("Phone Number"), "07123 456789");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.type(screen.getByLabelText("Confirm Password"), "password123");

    await user.click(screen.getByRole("button", { name: "Create Account" }));

    await waitFor(() => {
      expect(api.registerReferrerViaInvite).toHaveBeenCalledWith({
        code: "KMG-AUTO",
        name: "Test Referrer",
        email: "locked@example.com",
        phone_number: "07123456789",
        password: "password123",
      });
    });
  });
});
