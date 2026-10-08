import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/AuthContext";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import type { ReferrerInviteResponse, User } from "../types";
import { InviteGenerator } from "./InviteGenerator";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

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

/* The component reads the inviter display name via useAuth(), so it needs
   an AuthProvider (and a resolved current user). MemoryRouter is required
   by the AuthProvider's navigate usage. */
const wrap = (user: User = mockAdminUser) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(api, "fetchCurrentUser").mockResolvedValue(user);
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ToastContainer>
            <InviteGenerator />
          </ToastContainer>
        </AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
};

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe("InviteGenerator", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
    localStorage.clear();
  });

  it("shows a validation error and does not call the API for an out-of-range limit", async () => {
    const user = userEvent.setup();
    const createSpy = vi.spyOn(api, "createReferrerInvite");

    wrap();

    await user.type(screen.getByLabelText("Family Limit"), "0");
    /* fireEvent (not user.click): jsdom runs the input's HTML constraint validation
       (min=1) on submit-button clicks, which the app's identical 1–999 range can't
       distinguish — dispatching submit directly reaches the app-level check. */
    fireEvent.submit(screen.getByRole("button", { name: "Generate" }).closest("form")!);

    await waitFor(() => {
      expect(screen.getByText("Family limit must be between 1 and 999.")).toBeInTheDocument();
    });
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("displays the generated code after a successful create", async () => {
    const user = userEvent.setup();
    const createSpy = vi.spyOn(api, "createReferrerInvite").mockResolvedValue(mockInviteResponse);

    wrap();

    await user.type(screen.getByLabelText("Family Limit"), "5");
    await user.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith({ family_limit: 5, email: null, email_message: null });
    });
    expect(await screen.findByText("Invite Code Generated")).toBeInTheDocument();
    expect(screen.getByText("KRI-TEST01")).toBeInTheDocument();
  });

  it("shows an info toast when the invite was created but the email failed to send", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "createReferrerInvite").mockResolvedValue({
      ...mockInviteResponse,
      locked_email: "newref@example.com",
      email_error: "Email could not be delivered.",
    });

    wrap();

    await user.type(screen.getByLabelText("Family Limit"), "5");
    await user.type(screen.getByLabelText("Email (optional)"), "newref@example.com");
    await user.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(screen.getByText("Email could not be delivered.")).toBeInTheDocument();
    });
    /* The code itself still displays */
    expect(screen.getByText("Invite Code Generated")).toBeInTheDocument();
  });

  it("sends the custom message in the payload when the message field is filled", async () => {
    const user = userEvent.setup();
    const createSpy = vi.spyOn(api, "createReferrerInvite").mockResolvedValue(mockInviteResponse);

    wrap();
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

    wrap();

    /* No email → the backend sends nothing, so neither the message field nor the preview renders */
    expect(screen.queryByLabelText("Custom Message (optional)")).not.toBeInTheDocument();
    expect(screen.queryByText("KRI-XXXXXX")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Email (optional)"), "newref@example.com");
    expect(screen.getByLabelText("Custom Message (optional)")).toBeInTheDocument();
    expect(screen.getByText("KRI-XXXXXX")).toBeInTheDocument();
  });

  it("falls back to the Kindness Fairy greeting for an admin without a display name", async () => {
    const user = userEvent.setup();

    // Mirrors _get_inviter_name in backend/app/auth_routes.py: an admin without a
    // display name signs invite emails as "Kindness Fairy", and the preview matches.
    wrap({ ...mockAdminUser, display_name: "" });

    // The preview only renders once an email is set
    await user.type(screen.getByLabelText("Email (optional)"), "newref@example.com");
    await waitFor(() => {
      expect(screen.getByText("Kindness Fairy")).toBeInTheDocument();
    });
    expect(screen.queryByText(/You're invited to help make a difference/)).not.toBeInTheDocument();
  });

  it("restores the custom message from a previous visit via localStorage", async () => {
    const user = userEvent.setup();

    const firstVisit = wrap();
    await user.type(screen.getByLabelText("Email (optional)"), "newref@example.com");
    await user.type(screen.getByLabelText("Custom Message (optional)"), "Hello from Kindness!");
    firstVisit.unmount();

    // Simulate returning later: fresh render, new email typed
    wrap();
    await user.type(screen.getByLabelText("Email (optional)"), "another@example.com");

    expect(screen.getByLabelText("Custom Message (optional)")).toHaveValue("Hello from Kindness!");
  });

  it("sends a null message when no message is provided", async () => {
    const user = userEvent.setup();
    const createSpy = vi.spyOn(api, "createReferrerInvite").mockResolvedValue(mockInviteResponse);

    wrap();

    await user.type(screen.getByLabelText("Family Limit"), "5");
    await user.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith({ family_limit: 5, email: null, email_message: null });
    });
  });
});
