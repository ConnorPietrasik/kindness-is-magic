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
  display_name: string | null;
  referrer_id: number | null;
  family_id: number | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Admin — Users
// ---------------------------------------------------------------------------

/** Payload for admin creating a new user. */
export interface AdminUserCreate {
  email: string;
  password: string;
  role: UserRole;
  display_name?: string | null;
  referrer_id?: number | null;
  family_id?: number | null;
}

/** Payload for admin updating an existing user. No password — use reset endpoint. */
export interface AdminUserUpdate {
  display_name?: string | null;
  role?: UserRole;
  referrer_id?: number | null;
  family_id?: number | null;
}

/** Payload for admin resetting a user's password. */
export interface UserPasswordReset {
  password: string;
}

/** Mirrors UserSummary — list item with joined names. */
export interface UserSummary {
  id: number;
  email: string;
  display_name: string | null;
  role: UserRole;
  referrer_id: number | null;
  family_id: number | null;
  deleted_at: string | null;
  created_at: string;
  referrer_name: string | null;
  family_name: string | null;
}

/** Mirrors UserDetail — full user with joined names. */
export interface UserDetail {
  id: number;
  display_id: string | null;
  email: string;
  display_name: string | null;
  role: UserRole;
  referrer_id: number | null;
  family_id: number | null;
  deleted_at: string | null;
  created_at: string;
  referrer_name: string | null;
  family_name: string | null;
}

// ---------------------------------------------------------------------------
// Referrer
// ---------------------------------------------------------------------------

/** Mirrors backend ReferrerApprovalStatus enum. */
export type ReferrerApprovalStatus = "pending" | "approved" | "rejected";

/** Mirrors ReferrerSummary. */
export interface ReferrerSummary {
  id: number;
  name: string;
  family_limit: number;
  family_count: number;
  family_invite_code: string;
  approval_status: ReferrerApprovalStatus;
  approved_by_admin_name: string | null;
  approved_at: string | null;
  deleted_at: string | null;
}

/** Mirrors ReferrerDetail (includes computed family_count). */
export interface ReferrerDetail {
  id: number;
  name: string;
  family_limit: number;
  phone_number: string;
  family_invite_code: string;
  family_count: number;
  approval_status: ReferrerApprovalStatus;
  approved_by_admin_name: string | null;
  approved_at: string | null;
  deleted_at: string | null;
}

/** Mirrors ReferrerInviteSummary. */
export interface ReferrerInviteSummary {
  id: number;
  code: string;
  family_limit: number;
  locked_email: string | null;
  expires_at: string;
  created_at: string;
  created_by_admin_name: string | null;
  redeemed: boolean;
  redeemed_by_referrer_name: string | null;
  referrer_approval_status: ReferrerApprovalStatus | null;
}

// ---------------------------------------------------------------------------
// Family
// ---------------------------------------------------------------------------

/** Family approval status — mirrors backend FamilyApprovalStatus enum. */
export type FamilyApprovalStatus = "pending" | "approved" | "rejected";

/** Mirrors FamilySummary. */
export interface FamilySummary {
  id: number;
  display_id: string;
  family_name: string;
  family_wish: string;
  contact_name: string;
  referrer_id: number | null;
  deleted_at: string | null;
  person_count: number;
  approval_status: FamilyApprovalStatus;
  pickup_window: string | null;
}

/** Mirrors FamilyDetail (includes computed person_count, display_id, referrer_name). */
export interface FamilyDetail {
  id: number;
  referrer_id: number | null;
  referrer_name: string | null;
  display_id: string;
  family_name: string;
  bio: string | null;
  address: string | null;
  phone_number: string;
  family_wish: string;
  contact_name: string;
  deleted_at: string | null;
  person_count: number;
  approval_status: FamilyApprovalStatus;
  pickup_window: string | null;
}

// ---------------------------------------------------------------------------
// Person
// ---------------------------------------------------------------------------

/** Mirrors PersonSummary. */
export interface PersonSummary {
  id: number;
  display_id: string;
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
  phone_number?: string;
  family_wish?: string;
  contact_name?: string;
  deleted_at?: string | null;
  pickup_window?: string | null;
}

/** Wish type — mirrors backend WishType enum. */
export type WishType = "adult" | "practical" | "fun";

/** Literal wish-type values — typed so `as WishType` casts are unnecessary. */
export const WISH_TYPE = {
  adult: "adult" as const,
  practical: "practical" as const,
  fun: "fun" as const,
};

/** Mirrors WishSummary — compact wish embedded in person responses. */
export interface WishSummary {
  id: number;
  type: WishType;
  description: string;
  size: string | null;
  purchased_by_id: number | null;
  purchased_at: string | null;
  purchased_where: string | null;
  deleted_at: string | null;
}

/** Payload for creating a single wish (person_id inferred from route). */
export interface WishCreate {
  type: WishType;
  description: string;
  size?: string | null;
}

/** Payload for creating or updating a person. `family_id` and `deleted_at` are admin-only.

    All fields are optional so the same type works for both create (all present) and
    update (partial) operations. The backend enforces required fields on create.
 */
export interface PersonPayload {
  family_id?: number;
  given_name?: string;
  title?: string | null;
  age?: number;
  wishes?: WishCreate[];
  note?: string | null;
  deleted_at?: string | null;
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
  locked_email: string | null;
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
  phone_number?: string;
}
export interface FamilySelfRegisterResponse {
  user: User;
  family: FamilySummary;
}

/** Response from the send-family-invite endpoint. */
export interface ReferrerFamilyInviteResponse {
  email_sent: boolean;
  email_send_reason: string | null;
}

/** Summary for pending families awaiting referrer approval. */
export interface PendingFamilySummary {
  id: number;
  display_id: string;
  family_name: string;
  family_wish: string;
  contact_name: string;
  approval_status: FamilyApprovalStatus;
  person_count: number;
  created_at: string | null;
  pickup_window: string | null;
}

// ---------------------------------------------------------------------------
// Family Wish List (public page)
// ---------------------------------------------------------------------------

/** Mirrors PersonWishItem on the backend wish-list response. */
export interface PersonWishItem {
  given_name: string;
  title: string | null;
  age: number;
  note: string | null;
  wishes: WishSummary[];
}

/** Mirrors FamilyWishListResponse. */
export interface FamilyWishListResponse {
  family_name: string;
  bio: string | null;
  family_wish: string;
  people: PersonWishItem[];
}

// ---------------------------------------------------------------------------
// Person
// ---------------------------------------------------------------------------

/** Mirrors PersonDetail. */
export interface PersonDetail {
  id: number;
  family_id: number;
  display_id: string;
  given_name: string;
  title: string | null;
  age: number;
  note: string | null;
  deleted_at: string | null;
  wishes: WishSummary[];
}
