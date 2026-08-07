import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock useAuth — control isLoading and user
// ---------------------------------------------------------------------------
vi.mock("../context/AuthContext", () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from "../context/AuthContext";

// ---------------------------------------------------------------------------
// Mock AlreadyLoggedIn — verify it renders without triggering navigation
// ---------------------------------------------------------------------------
vi.mock("../pages/AlreadyLoggedIn", () => ({
  default: () => <div data-testid="already-logged-in">Already Logged In</div>,
}));

import { PublicRoute } from "./PublicRoute";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PublicRoute", () => {
  afterEach(() => {
    cleanup();
  });

  const mockUseAuth = useAuth as unknown as Mock;

  /* ── Loading state ──────────────────────────────────────── */

  it("shows spinner while isLoading is true", () => {
    mockUseAuth.mockReturnValue({ user: null, isLoading: true });

    render(
      <MemoryRouter>
        <PublicRoute>
          <div data-testid="child">Login Form</div>
        </PublicRoute>
      </MemoryRouter>
    );

    // PageSpinner renders an SVG with animate-spin class
    expect(document.querySelector("svg.animate-spin")).toBeInTheDocument();
    // Children should NOT be rendered
    expect(screen.queryByTestId("child")).not.toBeInTheDocument();
  });

  /* ── Unauthenticated — render children ──────────────────── */

  it("renders children when user is null", () => {
    mockUseAuth.mockReturnValue({ user: null, isLoading: false });

    render(
      <MemoryRouter>
        <PublicRoute>
          <div data-testid="child">Login Form</div>
        </PublicRoute>
      </MemoryRouter>
    );

    expect(screen.getByTestId("child")).toBeInTheDocument();
    expect(screen.queryByTestId("already-logged-in")).not.toBeInTheDocument();
  });

  it("renders children when user is undefined", () => {
    mockUseAuth.mockReturnValue({ user: undefined, isLoading: false });

    render(
      <MemoryRouter>
        <PublicRoute>
          <div data-testid="child">Register Form</div>
        </PublicRoute>
      </MemoryRouter>
    );

    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  /* ── Authenticated — show AlreadyLoggedIn ───────────────── */

  it("renders AlreadyLoggedIn when user is authenticated (admin)", () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, email: "admin@test.com", role: "admin" },
      isLoading: false,
    });

    render(
      <MemoryRouter>
        <PublicRoute>
          <div data-testid="child">Login Form</div>
        </PublicRoute>
      </MemoryRouter>
    );

    expect(screen.queryByTestId("child")).not.toBeInTheDocument();
    expect(screen.getByTestId("already-logged-in")).toBeInTheDocument();
  });

  it("renders AlreadyLoggedIn when user is authenticated (family)", () => {
    mockUseAuth.mockReturnValue({
      user: { id: 2, email: "family@test.com", role: "family" },
      isLoading: false,
    });

    render(
      <MemoryRouter>
        <PublicRoute>
          <div data-testid="child">Register Form</div>
        </PublicRoute>
      </MemoryRouter>
    );

    expect(screen.queryByTestId("child")).not.toBeInTheDocument();
    expect(screen.getByTestId("already-logged-in")).toBeInTheDocument();
  });

  it("renders AlreadyLoggedIn when user is authenticated (referrer)", () => {
    mockUseAuth.mockReturnValue({
      user: { id: 3, email: "referrer@test.com", role: "referrer" },
      isLoading: false,
    });

    render(
      <MemoryRouter>
        <PublicRoute>
          <div data-testid="child">Forgot Password</div>
        </PublicRoute>
      </MemoryRouter>
    );

    expect(screen.queryByTestId("child")).not.toBeInTheDocument();
    expect(screen.getByTestId("already-logged-in")).toBeInTheDocument();
  });
});
