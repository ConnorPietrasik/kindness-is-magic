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
  deleted_at: string | null;
}

/** Mirrors ReferrerDetail (includes computed family_count). */
export interface ReferrerDetail {
  id: number;
  name: string;
  family_limit: number;
  phone_number: string;
  family_count: number;
  deleted_at: string | null;
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
  referrer_id: number | null;
  deleted_at: string | null;
  person_count: number;
}

/** Mirrors FamilyDetail (includes computed person_count). */
export interface FamilyDetail {
  id: number;
  referrer_id: number | null;
  family_name: string;
  bio: string | null;
  address: string | null;
  phone_number: string | null;
  family_wish: string;
  contact_name: string;
  deleted_at: string | null;
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
  deleted_at: string | null;
}

// ---------------------------------------------------------------------------
// Payload types — all fields optional (create = all present, update = partial)
// ---------------------------------------------------------------------------

/** Payload for creating or updating a referrer. `family_limit` and `deleted_at` are admin-only. */
export interface ReferrerPayload {
  name?: string;
  phone_number?: string;
  family_limit?: number;
  deleted_at?: string | null;
}

/** Payload for creating or updating a family. `referrer_id` and `deleted_at` are admin-only. */
export interface FamilyPayload {
  referrer_id?: number | null;
  family_name?: string;
  bio?: string | null;
  address?: string | null;
  phone_number?: string | null;
  family_wish?: string;
  contact_name?: string;
  deleted_at?: string | null;
}

/** Payload for creating or updating a person. `family_id` and `deleted_at` are admin-only. */
export interface PersonPayload {
  family_id?: number;
  given_name?: string;
  title?: string | null;
  age?: number;
  practical_wish?: string;
  fun_wish?: string;
  note?: string | null;
  deleted_at?: string | null;
}

/** Payload for user registration. */
export interface RegisterPayload {
  email?: string;
  password?: string;
  role?: string;
  referrer_id?: number | null;
  family_id?: number | null;
}

// ---------------------------------------------------------------------------
// Person
// ---------------------------------------------------------------------------

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
  deleted_at: string | null;
}
