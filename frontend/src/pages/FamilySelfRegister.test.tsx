import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/AuthContext";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import type { FamilySelfRegisterResponse, User } from "../types";
import FamilySelfRegister from "./FamilySelfRegister";

const mockUser: User = {
  id: 10,
  email: "family@example.com",
  role: "family",
  display_name: "family",
  referrer_id: 1,
  family_id: 10,
  created_at: "2025-01-14T12:00:00Z",
};

const mockResponse: FamilySelfRegisterResponse = {
  user: mockUser,
  family: {
    id: 10,
    display_id: "PENDING",
    family_name: "The Test Family",
    family_wish: "A wonderful Christmas",
    contact_name: "Test Contact",
    referrer_id: 1,
    delivery_user_id: null,
    delivery_user_name: null,
    deleted_at: null,
    person_count: 0,
    verification_status: "verified",
    pickup_window: null,
    wish_lock_level: "family",
    wish_review_requested_at: null,
    wish_rejection_reason: null,
    has_notes: false,
  },
};

const createQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const wrap = (ui: React.ReactElement, path = "/register-family") => {
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

describe("FamilySelfRegister", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("renders all form fields", () => {
    wrap(<FamilySelfRegister />);
    expect(screen.getByLabelText("Invite Code")).toBeInTheDocument();
    expect(screen.getByLabelText("Family Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Family Wish")).toBeInTheDocument();
    expect(screen.getByLabelText("Contact Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Account" })).toBeInTheDocument();
    expect(screen.getByLabelText("Address")).toBeRequired();
    expect(screen.getByText("If no address, write 'none'")).toBeInTheDocument();
  });

  it("pre-fills invite code from URL param and locks the field", () => {
    wrap(<FamilySelfRegister />, "/register-family?code=KFI-FAMILY1");

    const codeInput = screen.getByLabelText("Invite Code");
    expect(codeInput).toHaveValue("KFI-FAMILY1");
    expect(codeInput).toHaveAttribute("readonly");
  });

  it("leaves code field empty and editable when no URL params", () => {
    wrap(<FamilySelfRegister />, "/register-family");

    const codeInput = screen.getByLabelText("Invite Code");
    expect(codeInput).toHaveValue("");
    expect(codeInput).not.toHaveAttribute("readonly");
  });

  it("submits with pre-filled code from URL params", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "registerFamilyViaInvite").mockResolvedValue(mockResponse);
    vi.spyOn(api, "fetchCurrentUser").mockResolvedValue(null);

    wrap(<FamilySelfRegister />, "/register-family?code=KFI-FAMILY1");

    await user.type(screen.getByLabelText("Family Name"), "The Test Family");
    await user.type(screen.getByLabelText("Family Wish"), "A wonderful Christmas");
    await user.type(screen.getByLabelText("Contact Name"), "Test Contact");
    await user.type(screen.getByLabelText("Email"), "family@example.com");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.type(screen.getByLabelText("Confirm Password"), "password123");
    await user.type(screen.getByLabelText("Address"), "none");
    await user.type(screen.getByLabelText("Phone Number"), "5551234567");

    await user.click(screen.getByRole("button", { name: "Create Account" }));

    await waitFor(() => {
      expect(api.registerFamilyViaInvite).toHaveBeenCalledWith({
        code: "KFI-FAMILY1",
        family_name: "The Test Family",
        family_wish: "A wonderful Christmas",
        contact_name: "Test Contact",
        email: "family@example.com",
        password: "password123",
        bio: null,
        address: "none",
        phone_number: "5551234567",
      });
    });
  });

  it("shows error when passwords do not match", async () => {
    const user = userEvent.setup();
    wrap(<FamilySelfRegister />);

    await user.type(screen.getByLabelText("Invite Code"), "KFI-TEST1");
    await user.type(screen.getByLabelText("Family Name"), "The Test Family");
    await user.type(screen.getByLabelText("Family Wish"), "A wonderful Christmas");
    await user.type(screen.getByLabelText("Contact Name"), "Test Contact");
    await user.type(screen.getByLabelText("Email"), "family@example.com");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.type(screen.getByLabelText("Confirm Password"), "different1");
    await user.type(screen.getByLabelText("Address"), "none");
    await user.type(screen.getByLabelText("Phone Number"), "5551234567");

    await user.click(screen.getByRole("button", { name: "Create Account" }));

    expect(screen.getByText("Passwords do not match.")).toBeInTheDocument();
  });

  it("shows a link back to login", () => {
    wrap(<FamilySelfRegister />);
    expect(screen.getByText("← Back to login")).toBeInTheDocument();
  });
});
