import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/AuthContext";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import { auth } from "../lib/queryKeys";
import { headerUser } from "../test/fixtures";
import type { User } from "../types";
import { HeaderBar } from "./HeaderBar";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const familyUser: User = { ...headerUser, role: "family" };

interface WrapOptions {
  user?: User | null;
  left?: React.ReactNode;
  right?: React.ReactNode;
  path?: string;
  /** When true, the session query never resolves (isLoading stays true). */
  pending?: boolean;
}

/**
 * Renders the header inside router + query + auth providers.
 * Pre-seeds the auth query cache (staleTime: Infinity) so no /api/auth/me
 * request is made and the auth state is deterministic per test.
 */
const wrap = ({ user = null, left, right, path = "/families", pending = false }: WrapOptions = {}) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (!pending) {
    queryClient.setQueryData(auth, user);
  }
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={queryClient}>
        <ToastContainer>
          <AuthProvider>
            <Routes>
              <Route path="/families" element={<HeaderBar left={left} right={right} />} />
              <Route path="/home" element={<HeaderBar left={left} right={right} />} />
              <Route path="/login" element={<div data-testid="login-page">Login page</div>} />
            </Routes>
          </AuthProvider>
        </ToastContainer>
      </QueryClientProvider>
    </MemoryRouter>
  );
};

/** A mounted app-data query — the header's refresh button only renders while one is active. */
function Probe() {
  useQuery({ queryKey: ["probe"], queryFn: () => 1 });
  return null;
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe("HeaderBar", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    cleanup();
  });

  describe("guest", () => {
    it("links the title and logo to /home from another page", () => {
      wrap();

      expect(screen.getByRole("link", { name: "Kindness is Magic" })).toHaveAttribute("href", "/home");
      expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/home");
    });

    it("shows the section nav for guests", () => {
      wrap();

      expect(screen.getByRole("link", { name: "How it works" })).toHaveAttribute("href", "/home#how-it-works");
      expect(screen.getByRole("link", { name: "Our mission" })).toHaveAttribute("href", "/home#mission");
    });

    it("shows a sign in link to /login", () => {
      wrap();

      expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    });

    it("hides sign out", () => {
      wrap();

      expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
    });

    it("title and logo are buttons that scroll to the top on /home", async () => {
      const event = userEvent.setup();
      const scrollToSpy = vi.fn();
      vi.stubGlobal("scrollTo", scrollToSpy);

      wrap({ path: "/home" });

      await event.click(screen.getByRole("button", { name: "Kindness is Magic" }));
      expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
      expect(screen.getByRole("button", { name: "Home" })).toBeInTheDocument();
    });
  });

  describe("signed in", () => {
    it("links the title and logo to the role home", () => {
      wrap({ user: headerUser });

      expect(screen.getByRole("link", { name: "Kindness is Magic" })).toHaveAttribute("href", "/dashboard");
      expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/dashboard");
    });

    it("links the family role to the family dashboard", () => {
      wrap({ user: familyUser });

      expect(screen.getByRole("link", { name: "Kindness is Magic" })).toHaveAttribute("href", "/family/dashboard");
    });

    it("always shows sign out and hides the sign in link and section nav", () => {
      wrap({ user: headerUser });

      expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "How it works" })).not.toBeInTheDocument();
    });

    it("clicking sign out logs out and navigates to login", async () => {
      const event = userEvent.setup();
      const logoutSpy = vi.spyOn(api, "logoutRequest").mockResolvedValue(undefined);

      wrap({ user: headerUser, path: "/families" });

      const signOutButton = await screen.findByRole("button", { name: "Sign out" });
      await event.click(signOutButton);

      await waitFor(() => {
        expect(screen.getByTestId("login-page")).toBeInTheDocument();
      });
      expect(logoutSpy).toHaveBeenCalledOnce();
    });
  });

  describe("session pending", () => {
    it("renders a plain title with no controls while the session resolves", async () => {
      vi.spyOn(api, "fetchCurrentUser").mockReturnValue(new Promise(() => {}));

      wrap({ pending: true });

      // No auth-dependent controls while the session check is in flight.
      expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "How it works" })).not.toBeInTheDocument();
      // Title is present but not interactive.
      expect(screen.getByText("Kindness is Magic")).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Kindness is Magic" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Kindness is Magic" })).not.toBeInTheDocument();
    });
  });

  describe("slots and refresh", () => {
    it("renders the left slot", () => {
      wrap({ left: <Link to="/families">← Back</Link> });

      expect(screen.getByRole("link", { name: "← Back" })).toHaveAttribute("href", "/families");
    });

    it("renders the right slot for page-specific actions", () => {
      wrap({ right: <button type="button">Print</button> });

      expect(screen.getByRole("button", { name: "Print" })).toBeInTheDocument();
    });

    it("renders the refresh button while a page query is active", async () => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      queryClient.setQueryData(auth, headerUser);
      render(
        <MemoryRouter initialEntries={["/families"]}>
          <QueryClientProvider client={queryClient}>
            <ToastContainer>
              <AuthProvider>
                <HeaderBar />
                <Probe />
              </AuthProvider>
            </ToastContainer>
          </QueryClientProvider>
        </MemoryRouter>
      );

      // The probe query's observer attaches in an effect, so the button appears
      // on the re-render that follows — wait for it rather than asserting at once.
      expect(await screen.findByRole("button", { name: "Refresh data" })).toBeInTheDocument();
    });
  });
});
