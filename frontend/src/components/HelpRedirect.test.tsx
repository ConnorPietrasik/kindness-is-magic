import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";
import type { UserRole } from "../types";

// ---------------------------------------------------------------------------
// Mock useAuth — control isLoading and user
// ---------------------------------------------------------------------------
vi.mock("../context/AuthContext", () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from "../context/AuthContext";

// ---------------------------------------------------------------------------
// Mock Navigate — captures `to` prop without triggering real navigation
// ---------------------------------------------------------------------------
const navigateCalls: string[] = [];

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    Navigate: ({ to }: { to: string }) => {
      navigateCalls.push(to);
      return null;
    },
  };
});

import { HelpRedirect } from "./HelpRedirect";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("HelpRedirect", () => {
  afterEach(() => {
    navigateCalls.length = 0;
    cleanup();
  });

  const mockUseAuth = useAuth as unknown as Mock;

  const renderAs = (role: UserRole) => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, email: "user@example.com", role },
      isLoading: false,
    });
    render(
      <MemoryRouter initialEntries={["/help"]}>
        <HelpRedirect />
      </MemoryRouter>
    );
  };

  it.each([
    ["admin", "/help/admin"],
    ["referrer", "/help/referrer"],
    ["family", "/help/family"],
    ["purchaser", "/help/purchaser"],
    ["delivery", "/help/delivery"],
    ["donor", "/help/donor"],
  ] as Array<[UserRole, string]>)("redirects %s to %s", (role, target) => {
    renderAs(role);
    expect(navigateCalls).toEqual([target]);
  });

  it("shows a spinner while the session resolves", () => {
    mockUseAuth.mockReturnValue({ user: null, isLoading: true });

    render(
      <MemoryRouter initialEntries={["/help"]}>
        <HelpRedirect />
      </MemoryRouter>
    );

    expect(document.querySelector("svg.animate-spin")).toBeInTheDocument();
    expect(navigateCalls).toEqual([]);
  });
});
