/** AuthContext value shape (derived from src/context/AuthContext.jsx) */

import type { User } from "./domain";

export interface AuthContextValue {
  user: User | null | undefined;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  checkAuth: () => void;
  isAdmin: boolean;
  isReferrer: boolean;
  isFamily: boolean;
}
