/** Domain entities derived from backend/app/schemas.py */

// ---------------------------------------------------------------------------
// User / Auth
// ---------------------------------------------------------------------------

/** Mirrors backend UserRole enum. */
export type UserRole = "admin" | "referrer" | "family";

/** Mirrors UserResponse — the shape returned by /api/auth/me. */
export interface User {
  id: number;
  email: string;
  role: UserRole;
  referrer_id: number | null;
  family_id: number | null;
  is_active: boolean;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Referrer
// ---------------------------------------------------------------------------

/** Mirrors ReferrerSummary. */
export interface ReferrerSummary {
  id: number;
  name: string;
  family_limit: number;
}

/** Mirrors ReferrerDetail (includes computed family_count). */
export interface ReferrerDetail {
  id: number;
  name: string;
  family_limit: number;
  phone_number: string;
  family_count: number;
}

// ---------------------------------------------------------------------------
// Family
// ---------------------------------------------------------------------------

/** Mirrors FamilySummary. */
export interface FamilySummary {
  id: number;
  family_name: string;
  family_wish: string;
  contact_name: string;
  referrer_id: number;
  is_deleted: boolean;
  person_count: number;
}

/** Mirrors FamilyDetail (includes computed person_count). */
export interface FamilyDetail {
  id: number;
  referrer_id: number;
  family_name: string;
  bio: string | null;
  address: string | null;
  phone_number: string | null;
  family_wish: string;
  contact_name: string;
  is_deleted: boolean;
  person_count: number;
}

// ---------------------------------------------------------------------------
// Person
// ---------------------------------------------------------------------------

/** Mirrors PersonSummary. */
export interface PersonSummary {
  id: number;
  family_id: number;
  given_name: string;
  age: number;
  is_deleted: boolean;
}

/** Mirrors PersonDetail. */
export interface PersonDetail {
  id: number;
  family_id: number;
  given_name: string;
  title: string | null;
  age: number;
  practical_wish: string;
  fun_wish: string;
  note: string | null;
  is_deleted: boolean;
}
