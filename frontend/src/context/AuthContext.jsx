/**
 * AuthContext — global auth state backed by React Query.
 *
 * Provides:
 *  - user: null | { id, email, role, referrer_id, family_id, is_active }
 *  - isLoading: boolean (true while checking session on mount)
 *  - login(email, password)
 *  - logout()
 *  - checkAuth() — re-fetch /api/auth/me
 */

import { createContext, useContext, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchCurrentUser,
  loginRequest,
  logoutRequest,
} from '../lib/api';

const AUTH_KEY = ['auth'];

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();

  const { data: user, isLoading } = useQuery({
    queryKey: AUTH_KEY,
    queryFn: fetchCurrentUser,
    staleTime: Infinity,       // auth doesn't become stale on its own
    refetchOnWindowFocus: false,
    retry: false,              // 401 → logged out, don't spin
  });

  const checkAuth = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: AUTH_KEY });
  }, [queryClient]);

  const login = useCallback(async (email, password) => {
    const { data } = await loginRequest(email, password);
    queryClient.setQueryData(AUTH_KEY, data.user);
    return data.user;
  }, [queryClient]);

  const logout = useCallback(async () => {
    try {
      await logoutRequest();
    } catch {
      // Best-effort — still clear local state
    }
    queryClient.setQueryData(AUTH_KEY, null);
  }, [queryClient]);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout, checkAuth }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
