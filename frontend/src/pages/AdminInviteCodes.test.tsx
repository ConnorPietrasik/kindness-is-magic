import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/AuthContext";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import type { ReferrerInviteResponse, User } from "../types";
import AdminInviteCodes from "./AdminInviteCodes";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const emptyListResponse = { invites: [], total: 0, page: 1, page_size: 20, total_pages: 0 };

const mockAdminUser: User = {
  id: 1,
  email: "admin@test.com",
  role: "admin",
  display_name: "Admin",
  referrer_id: null,
  family_id: null,
  created_at: "2025-01-01T00:00:00Z",
};

const mockInviteResponse: ReferrerInviteResponse = {
  code: "KRI-TEST01",
  family_limit: 5,
  locked_email: null,
  expires_at: "2026-01-08T00:00:00Z",
  created_at: "2026-01-01T00:00:00Z",
  email_error: null,
};

/* InviteGenerator calls useAuth() for the inviter display name, so the
   page needs an AuthProvider (and a resolved current user) to render. */
const wrap = (path: string, user: User = mockAdminUser) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(api, "fetchCurrentUser").mockResolvedValue(user);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ToastContainer>
            <AdminInviteCodes />
          </ToastContainer>
        </AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
};

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe("AdminInviteCodes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
    localStorage.clear();
  });

  it("keeps the generator closed by default", async () => {
    vi.spyOn(api, "adminListInvites").mockResolvedValue(emptyListResponse);

    wrap("/admin/invite-codes");

    await waitFor(() => {
      expect(screen.getByText("No invite codes found.")).toBeInTheDocument();
    });

    expect(screen.queryByText("Generate Invite Code")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Generate new" })).toBeInTheDocument();
  });

  it("opens the generator when navigated with ?generate=1", async () => {
    vi.spyOn(api, "adminListInvites").mockResolvedValue(emptyListResponse);

    wrap("/admin/invite-codes?generate=1");

    await waitFor(() => {
      expect(screen.getByText("Generate Invite Code")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Hide generator" })).toBeInTheDocument();
  });

  it("opens the generator when ?generate=1 appears on an already-mounted page", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminListInvites").mockResolvedValue(emptyListResponse);

    function NavControl() {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => navigate("/admin/invite-codes?generate=1")}>
          Go with param
        </button>
      );
    }

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.spyOn(api, "fetchCurrentUser").mockResolvedValue(mockAdminUser);
    render(
      <MemoryRouter initialEntries={["/admin/invite-codes"]}>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <ToastContainer>
              <Routes>
                <Route path="/admin/invite-codes" element={<AdminInviteCodes />} />
              </Routes>
              <NavControl />
            </ToastContainer>
          </AuthProvider>
        </QueryClientProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("No invite codes found.")).toBeInTheDocument();
    });
    expect(screen.queryByText("Generate Invite Code")).not.toBeInTheDocument();

    // Search-only navigation keeps the same element instance mounted
    await user.click(screen.getByRole("button", { name: "Go with param" }));

    await waitFor(() => {
      expect(screen.getByText("Generate Invite Code")).toBeInTheDocument();
    });
  });

  it("sends the custom message in the payload when the message field is filled", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminListInvites").mockResolvedValue(emptyListResponse);
    const createSpy = vi.spyOn(api, "createReferrerInvite").mockResolvedValue(mockInviteResponse);

    wrap("/admin/invite-codes");
    await waitFor(() => {
      expect(screen.getByText("No invite codes found.")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "+ Generate new" }));
    /* Message field + preview appear only once an email is set (no email → no email sent) */
    expect(screen.queryByLabelText("Custom Message (optional)")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Email (optional)"), "newref@example.com");
    /* Client-side cap mirrors the backend's 5000-char limit (ReferrerInviteCreate.email_message) */
    expect(screen.getByLabelText("Custom Message (optional)")).toHaveAttribute("maxlength", "5000");
    await user.type(screen.getByLabelText("Custom Message (optional)"), "Welcome to the magic!");
    await user.type(screen.getByLabelText("Family Limit"), "5");
    await user.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith({
        family_limit: 5,
        email: "newref@example.com",
        email_message: "Welcome to the magic!",
      });
    });
  });

  it("hides the custom message field and preview until an email is entered", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminListInvites").mockResolvedValue(emptyListResponse);

    wrap("/admin/invite-codes");
    await waitFor(() => {
      expect(screen.getByText("No invite codes found.")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "+ Generate new" }));

    /* No email → the backend sends nothing, so neither the message field nor the preview renders */
    expect(screen.queryByLabelText("Custom Message (optional)")).not.toBeInTheDocument();
    expect(screen.queryByText("KRI-XXXXXX")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Email (optional)"), "newref@example.com");
    expect(screen.getByLabelText("Custom Message (optional)")).toBeInTheDocument();
    expect(screen.getByText("KRI-XXXXXX")).toBeInTheDocument();
  });

  it("falls back to the Kindness Fairy greeting for an admin without a display name", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminListInvites").mockResolvedValue(emptyListResponse);

    // Mirrors _get_inviter_name in backend/app/auth_routes.py: an admin without a
    // display name signs invite emails as "Kindness Fairy", and the preview matches.
    wrap("/admin/invite-codes?generate=1", { ...mockAdminUser, display_name: "" });

    await waitFor(() => {
      expect(screen.getByText("Generate Invite Code")).toBeInTheDocument();
    });
    // The preview only renders once an email is set
    await user.type(screen.getByLabelText("Email (optional)"), "newref@example.com");
    await waitFor(() => {
      expect(screen.getByText("Kindness Fairy")).toBeInTheDocument();
    });
    expect(screen.queryByText(/You're invited to help make a difference/)).not.toBeInTheDocument();
  });

  it("sends a null message when no message is provided", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminListInvites").mockResolvedValue(emptyListResponse);
    const createSpy = vi.spyOn(api, "createReferrerInvite").mockResolvedValue(mockInviteResponse);

    wrap("/admin/invite-codes");
    await waitFor(() => {
      expect(screen.getByText("No invite codes found.")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "+ Generate new" }));
    await user.type(screen.getByLabelText("Family Limit"), "5");
    await user.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith({ family_limit: 5, email: null, email_message: null });
    });
  });
});
