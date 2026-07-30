/**
 * AuthContext — global auth state backed by React Query.
 *
 * Provides:
 *  - user: null | { id, email, role, referrer_id, family_id }
 *  - isLoading: boolean (true while checking session on mount)
 *  - isAdmin, isReferrer, isFamily: boolean (derived from user?.role)
 *  - login(email, password)
 *  - logout()
 *  - checkAuth() — re-fetch /api/auth/me
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { _registerSetAuthQueryData, fetchCurrentUser, loginRequest, logoutRequest } from "../lib/api";
import { ROUTES } from "../lib/routes";
import type { AuthContextValue, User } from "../types";

const AUTH_KEY = ["auth"] as const;

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const {
    data: user,
    isLoading,
    status,
  } = useQuery<User | null>({
    queryKey: AUTH_KEY,
    queryFn: fetchCurrentUser,
    staleTime: Infinity, // auth doesn't become stale on its own
    refetchOnWindowFocus: false,
    retry: false, // 401 → logged out, don't spin
  });

  // Register the setAuthQueryData callback so the Axios interceptor can
  // clear auth state when token refresh fails.
  useEffect(() => {
    _registerSetAuthQueryData((data: null) => {
      queryClient.setQueryData(AUTH_KEY, data);
    });
  }, [queryClient]);

  // When the interceptor's refresh flow fails, it dispatches this event.
  // Clear the cached user (belt-and-suspenders with setAuthQueryData) and
  // navigate to /login.
  useEffect(() => {
    const handler = () => {
      queryClient.setQueryData(AUTH_KEY, null);
      navigate(ROUTES.LOGIN, { replace: true });
    };
    window.addEventListener("onFailedRefresh", handler);
    return () => window.removeEventListener("onFailedRefresh", handler);
  }, [queryClient, navigate]);

  // Initial page load with expired session: fetchCurrentUser throws 401,
  // query enters error state. Navigate to /login.
  // Note: fetchCurrentUser now returns null on 401, so this path should
  // rarely fire — kept as a safety net for edge cases.
  const navigatedRef = useRef(false);
  useEffect(() => {
    if (status === "error" && !navigatedRef.current) {
      navigatedRef.current = true;
      navigate(ROUTES.LOGIN, { replace: true });
    }
  }, [status, navigate]);

  const checkAuth = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: AUTH_KEY });
  }, [queryClient]);

  const login = useCallback(
    async (email: string, password: string): Promise<User> => {
      const { data } = await loginRequest(email, password);
      queryClient.setQueryData(AUTH_KEY, data.user);
      return data.user;
    },
    [queryClient]
  );

  const logout = useCallback(async (): Promise<void> => {
    try {
      await logoutRequest();
    } catch {
      // Best-effort — still clear local state
    }
    queryClient.setQueryData(AUTH_KEY, null);
  }, [queryClient]);

  const setUser = useCallback(
    (updatedUser: User): void => {
      queryClient.setQueryData(AUTH_KEY, updatedUser);
    },
    [queryClient]
  );

  const isAdmin = user?.role === "admin";
  const isReferrer = user?.role === "referrer";
  const isFamily = user?.role === "family";

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        login,
        logout,
        setUser,
        checkAuth,
        isAdmin,
        isReferrer,
        isFamily,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
