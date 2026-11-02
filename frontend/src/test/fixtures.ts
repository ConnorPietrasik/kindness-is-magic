import type { User } from "../types";

/** Signed-in user seeded into the header's auth query cache. */
export const headerUser: User = {
  id: 1,
  email: "header@example.com",
  role: "admin",
  display_name: "Header",
  referrer_id: null,
  family_id: null,
  created_at: "2025-01-14T12:00:00Z",
};
