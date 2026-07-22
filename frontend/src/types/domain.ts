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
  family_invite_code: string | null;
  deleted_at: string | null;
}

/** Mirrors ReferrerDetail (includes computed family_count). */
export interface ReferrerDetail {
  id: number;
  name: string;
  family_limit: number;
  phone_number: string;
  family_invite_code: string | null;
  family_count: number;
  deleted_at: string | null;
}

// ---------------------------------------------------------------------------
// Family
// ---------------------------------------------------------------------------

/** Family approval status — mirrors backend FamilyApprovalStatus enum. */
export type FamilyApprovalStatus = "pending" | "approved" | "rejected";

/** Mirrors FamilySummary. */
export interface FamilySummary {
  id: number;
  family_name: string;
  family_wish: string;
  contact_name: string;
  referrer_id: number | null;
  deleted_at: string | null;
  person_count: number;
  approval_status: FamilyApprovalStatus;
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
  approval_status: FamilyApprovalStatus;
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
// Referrer Invite
// ---------------------------------------------------------------------------

/** Payload for admin creating an invite token. */
export interface ReferrerInviteCreatePayload {
  family_limit: number;
  email?: string | null;
}

/** Response when admin creates an invite. Mirrors ReferrerInviteResponse. */
export interface ReferrerInviteResponse {
  code: string;
  family_limit: number;
  expires_at: string;
  created_at: string;
  email_sent: boolean | null;
  email_send_reason: string | null;
}

/** Payload for public referrer self-registration via invite. */
export interface ReferrerSelfRegisterPayload {
  code: string;
  name: string;
  email: string;
  phone_number: string;
  password: string;
}

/** Response when a referrer self-registers via invite. */
export interface ReferrerSelfRegisterResponse {
  user: User;
  referrer: ReferrerSummary;
}

// ---------------------------------------------------------------------------
// Family Invite / Self-Registration
// ---------------------------------------------------------------------------

/** Payload for public family self-registration via invite. */
export interface FamilySelfRegisterPayload {
  code: string;
  family_name: string;
  family_wish: string;
  contact_name: string;
  email: string;
  password: string;
  bio?: string | null;
  address?: string | null;
  phone_number?: string | null;
}

/** Response when a family self-registers via invite. */
export interface FamilySelfRegisterResponse {
  user: User;
  family: FamilySummary;
}

/** Summary for pending families awaiting referrer approval. */
export interface PendingFamilySummary {
  id: number;
  family_name: string;
  family_wish: string;
  contact_name: string;
  approval_status: FamilyApprovalStatus;
  person_count: number;
  created_at: string | null;
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
