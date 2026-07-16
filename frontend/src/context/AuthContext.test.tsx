import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { AxiosResponse } from "axios";
import { MemoryRouter } from "react-router-dom";
import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "../types";

// ---------------------------------------------------------------------------
// Mock the API layer *before* importing AuthContext
// ---------------------------------------------------------------------------
let mockFetchCurrentUser: Mock<() => Promise<User | null>>;
let mockLoginRequest: Mock<(email: string, password: string) => Promise<AxiosResponse<{ user: User }>>>;
let mockLogoutRequest: Mock<() => Promise<void>>;

vi.mock("../lib/api", () => ({
  fetchCurrentUser: vi.fn(),
  loginRequest: vi.fn(),
  logoutRequest: vi.fn(),
}));

import * as api from "../lib/api";
import { AuthProvider, useAuth } from "./AuthContext";

// Capture the mocked functions
mockFetchCurrentUser = api.fetchCurrentUser as Mock<() => Promise<User | null>>;
mockLoginRequest = api.loginRequest as Mock<(email: string, password: string) => Promise<AxiosResponse<{ user: User }>>>;
mockLogoutRequest = api.logoutRequest as Mock<() => Promise<void>>;

const AUTH_KEY = ["auth"] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let queryClient: QueryClient;

function wrap() {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const qc = queryClient;
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <AuthProvider>{children}</AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  };
}

interface MakeUserOptions {
  id?: number;
  email?: string;
  role?: "admin" | "referrer" | "family";
  referrer_id?: number | null;
  family_id?: number | null;
  is_active?: boolean;
  created_at?: string;
}

function makeUser({
  id = 1,
  email = "test@example.com",
  role = "admin",
  referrer_id = null,
  family_id = null,
  is_active = true,
  created_at = "2024-01-01T00:00:00",
}: MakeUserOptions = {}): User {
  return { id, email, role, referrer_id, family_id, is_active, created_at };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("AuthContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (queryClient) queryClient.clear();
  });

  /* ── Initial state ──────────────────────────────────────── */

  it("starts with isLoading true and user undefined before fetch", () => {
    mockFetchCurrentUser.mockResolvedValueOnce(null);

    const { result } = renderHook(() => useAuth(), { wrapper: wrap() });

    expect(result.current.isLoading).toBe(true);
    // React Query returns undefined for data before the first fetch completes
    expect(result.current.user).toBeUndefined();
  });

  it("resolves to user null when fetchCurrentUser returns null", async () => {
    mockFetchCurrentUser.mockResolvedValueOnce(null);

    const { result } = renderHook(() => useAuth(), { wrapper: wrap() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.user).toBeNull();
  });

  it("resolves to user undefined on 401 (logged out)", async () => {
    const error = Object.assign(new Error("Unauthorized"), {
      response: { status: 401, data: { detail: "Not authenticated" } },
    });
    mockFetchCurrentUser.mockRejectedValueOnce(error);

    const { result } = renderHook(() => useAuth(), { wrapper: wrap() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // No prior data, so data stays undefined after error
    expect(result.current.user).toBeUndefined();
  });

  /* ── Successful session fetch ───────────────────────────── */

  it("populates user after successful fetchCurrentUser", async () => {
    const user = makeUser({ role: "admin" });
    mockFetchCurrentUser.mockResolvedValueOnce(user);

    const { result } = renderHook(() => useAuth(), { wrapper: wrap() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.user).toEqual(user);
    });
  });

  /* ── Role booleans ──────────────────────────────────────── */

  it("sets isAdmin true when role is admin", async () => {
    mockFetchCurrentUser.mockResolvedValueOnce(makeUser({ role: "admin" }));

    const { result } = renderHook(() => useAuth(), { wrapper: wrap() });

    await waitFor(() => {
      expect(result.current.isAdmin).toBe(true);
      expect(result.current.isReferrer).toBe(false);
      expect(result.current.isFamily).toBe(false);
    });
  });

  it("sets isReferrer true when role is referrer", async () => {
    mockFetchCurrentUser.mockResolvedValueOnce(makeUser({ role: "referrer" }));

    const { result } = renderHook(() => useAuth(), { wrapper: wrap() });

    await waitFor(() => {
      expect(result.current.isAdmin).toBe(false);
      expect(result.current.isReferrer).toBe(true);
      expect(result.current.isFamily).toBe(false);
    });
  });

  it("sets isFamily true when role is family", async () => {
    mockFetchCurrentUser.mockResolvedValueOnce(makeUser({ role: "family" }));

    const { result } = renderHook(() => useAuth(), { wrapper: wrap() });

    await waitFor(() => {
      expect(result.current.isAdmin).toBe(false);
      expect(result.current.isReferrer).toBe(false);
      expect(result.current.isFamily).toBe(true);
    });
  });

  it("all role booleans are false when user is null", async () => {
    mockFetchCurrentUser.mockResolvedValueOnce(null);

    const { result } = renderHook(() => useAuth(), { wrapper: wrap() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isAdmin).toBe(false);
    expect(result.current.isReferrer).toBe(false);
    expect(result.current.isFamily).toBe(false);
  });

  /* ── login ──────────────────────────────────────────────── */

  it("login calls loginRequest and sets user in query cache", async () => {
    mockFetchCurrentUser.mockResolvedValueOnce(null); // initial check

    const loginUser = makeUser({ role: "admin" });
    mockLoginRequest.mockResolvedValueOnce({ data: { user: loginUser } } as never);

    const { result } = renderHook(() => useAuth(), { wrapper: wrap() });

    // Wait for initial fetch to settle
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.login("admin@example.com", "password");
    });

    expect(mockLoginRequest).toHaveBeenCalledWith("admin@example.com", "password");
    // setQueryData is sync but re-render may be batched — verify cache directly
    expect(queryClient?.getQueryData(AUTH_KEY)).toEqual(loginUser);
    // Also verify the component re-renders with the new user
    await waitFor(() => {
      expect(result.current.user).toEqual(loginUser);
    });
    expect(result.current.isAdmin).toBe(true);
  });

  it("login returns the user object", async () => {
    mockFetchCurrentUser.mockResolvedValueOnce(null);

    const loginUser = makeUser({ role: "referrer" });
    mockLoginRequest.mockResolvedValueOnce({ data: { user: loginUser } } as never);

    const { result } = renderHook(() => useAuth(), { wrapper: wrap() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    let returnedUser: User | undefined;
    await act(async () => {
      returnedUser = await result.current.login("ref@example.com", "pass");
    });

    expect(returnedUser).toEqual(loginUser);
  });

  /* ── logout ─────────────────────────────────────────────── */

  it("logout calls logoutRequest and clears user", async () => {
    const user = makeUser({ role: "admin" });
    mockFetchCurrentUser.mockResolvedValueOnce(user);
    mockLogoutRequest.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useAuth(), { wrapper: wrap() });

    await waitFor(() => {
      expect(result.current.user).toEqual(user);
    });

    await act(async () => {
      await result.current.logout();
    });

    expect(mockLogoutRequest).toHaveBeenCalled();
    // Verify cache was cleared
    expect(queryClient?.getQueryData(AUTH_KEY)).toBeNull();
    // Verify component re-renders with null user
    await waitFor(() => {
      expect(result.current.user).toBeNull();
    });
    expect(result.current.isAdmin).toBe(false);
  });

  it("logout clears user even if logoutRequest fails", async () => {
    const user = makeUser({ role: "admin" });
    mockFetchCurrentUser.mockResolvedValueOnce(user);
    mockLogoutRequest.mockRejectedValueOnce(new Error("Network error"));

    const { result } = renderHook(() => useAuth(), { wrapper: wrap() });

    await waitFor(() => {
      expect(result.current.user).toEqual(user);
    });

    await act(async () => {
      await result.current.logout();
    });

    // User should still be cleared despite the error (best-effort logout)
    expect(queryClient?.getQueryData(AUTH_KEY)).toBeNull();
    await waitFor(() => {
      expect(result.current.user).toBeNull();
    });
  });

  /* ── checkAuth ──────────────────────────────────────────── */

  it("checkAuth invalidates the auth query triggering a refetch", async () => {
    mockFetchCurrentUser.mockResolvedValueOnce(null);

    const { result } = renderHook(() => useAuth(), { wrapper: wrap() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Mock the next fetchCurrentUser call (triggered by invalidation refetch)
    const newUser = makeUser({ role: "family" });
    mockFetchCurrentUser.mockResolvedValueOnce(newUser);

    await act(async () => {
      result.current.checkAuth();
      // Allow the refetch to fire
      await Promise.resolve();
    });

    // fetchCurrentUser called twice: initial mount + invalidation refetch
    expect(mockFetchCurrentUser.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("checkAuth on 401 retains previous user data (React Query keeps stale data on error)", async () => {
    const user = makeUser({ role: "admin" });
    mockFetchCurrentUser.mockResolvedValueOnce(user);

    const { result } = renderHook(() => useAuth(), { wrapper: wrap() });

    await waitFor(() => {
      expect(result.current.user).toEqual(user);
    });

    // Simulate session expiring — next fetch returns 401
    const error = Object.assign(new Error("Unauthorized"), {
      response: { status: 401, data: { detail: "Token expired" } },
    });
    mockFetchCurrentUser.mockRejectedValueOnce(error);

    await act(async () => {
      result.current.checkAuth();
      await Promise.resolve();
    });

    // React Query with retry:false keeps previous data on error,
    // so user retains the old value. The query status becomes 'error'.
    // This is expected — the interceptor layer handles actual 401 flows.
    expect(result.current.user).toEqual(user);
    // Verify the refetch was attempted (at least 2: mount + checkAuth invalidation)
    expect(mockFetchCurrentUser.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
