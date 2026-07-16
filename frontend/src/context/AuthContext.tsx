/**
 * AuthContext — global auth state backed by React Query.
 *
 * Provides:
 *  - user: null | { id, email, role, referrer_id, family_id, is_active }
 *  - isLoading: boolean (true while checking session on mount)
 *  - isAdmin, isReferrer, isFamily: boolean (derived from user?.role)
 *  - login(email, password)
 *  - logout()
 *  - checkAuth() — re-fetch /api/auth/me
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createContext, useCallback, useContext } from "react";
import { fetchCurrentUser, loginRequest, logoutRequest } from "../lib/api";
import type { AuthContextValue, User } from "../types";

const AUTH_KEY = ["auth"] as const;

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const queryClient = useQueryClient();

  const { data: user, isLoading } = useQuery<User | null>({
    queryKey: AUTH_KEY,
    queryFn: fetchCurrentUser,
    staleTime: Infinity, // auth doesn't become stale on its own
    refetchOnWindowFocus: false,
    retry: false, // 401 → logged out, don't spin
  });

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
