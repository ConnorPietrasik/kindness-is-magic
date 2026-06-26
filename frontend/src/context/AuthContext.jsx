/**
 * AuthContext — global auth state for the app.
 *
 * Provides:
 *  - user: null | { id, email, role, referrer_id, family_id, is_active }
 *  - isLoading: boolean (true while checking session on mount)
 *  - login(email, password)
 *  - logout()
 *  - checkAuth() — re-fetch /api/auth/me
 */

import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import {
  fetchCurrentUser,
  loginRequest,
  logoutRequest,
} from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  /** Restore session from cookie on mount */
  const checkAuth = useCallback(async () => {
    try {
      const data = await fetchCurrentUser();
      setUser(data);
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = useCallback(async (email, password) => {
    const { data } = await loginRequest(email, password);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await logoutRequest();
    } catch {
      // Best-effort — still clear local state
    }
    setUser(null);
  }, []);

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
