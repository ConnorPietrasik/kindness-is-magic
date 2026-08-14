/** Domain entities derived from backend/app/schemas.py */

// ---------------------------------------------------------------------------
// User / Auth
// ---------------------------------------------------------------------------

/** Mirrors backend UserRole enum. */
export type UserRole = "admin" | "referrer" | "family" | "purchaser" | "delivery" | "donor";

/** Mirrors UserResponse — the shape returned by /api/auth/me. */
export interface User {
  id: number;
  email: string;
  role: UserRole;
  display_name: string;
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

/** Mirrors UserDetail — full user with joined names. */
export interface UserDetail {
  id: number;
  email: string;
  display_name: string;
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
  created_at: string;
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

/** Wish lock level — who has final edit control on a family's wishes. */
export type WishLockLevel = "family" | "referrer" | "admin";

/** Mirrors FamilySummary. */
export interface FamilySummary {
  id: number;
  display_id: string;
  family_name: string;
  family_wish: string;
  contact_name: string;
  referrer_id: number | null;
  delivery_user_id: number | null;
  delivery_user_name: string | null;
  deleted_at: string | null;
  person_count: number;
  approval_status: FamilyApprovalStatus;
  pickup_window: string | null;
  wish_lock_level: WishLockLevel;
  wish_review_requested_at: string | null;
  wish_rejection_reason: string | null;
  has_notes: boolean;
}

/** Mirrors FamilyDetail (includes computed person_count, display_id, referrer_name). */
export interface FamilyDetail {
  id: number;
  referrer_id: number | null;
  referrer_name: string | null;
  delivery_user_id: number | null;
  delivery_user_name: string | null;
  display_id: string | null;
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
  wish_lock_level: WishLockLevel;
  wish_review_requested_at: string | null;
  wish_rejection_reason: string | null;
  referrer_notes: string | null;
  // Claim info for admin families table
  claim_status: string | null;
  claim_commitment_type: string | null;
  claim_donor_name: string | null;
  claim_id: number | null;
}

/** Family detail returned to family self-service endpoints (no referrer_notes). */
export interface FamilySelfServiceDetail {
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
  wish_lock_level: WishLockLevel;
  wish_review_requested_at: string | null;
  wish_rejection_reason: string | null;
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
  delivery_user_id?: number | null;
  family_name?: string;
  bio?: string | null;
  address?: string | null;
  phone_number?: string;
  family_wish?: string;
  contact_name?: string;
  deleted_at?: string | null;
  pickup_window?: string | null;
  referrer_notes?: string | null;
}

/** Payload for family self-service update — no referrer_notes. */
export interface FamilySelfPayload {
  family_name?: string;
  bio?: string | null;
  address?: string | null;
  phone_number?: string;
  family_wish?: string;
  contact_name?: string;
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
  assigned_to_id: number | null;
  purchased_at: string | null;
  purchased_where: string | null;
  received_at: string | null;
  purchaser_note: string | null;
  deleted_at: string | null;
}

/** Mirrors WishListSummary — wish with person/family/assignee context for admin list. */
export interface WishListSummary {
  id: number;
  type: WishType;
  description: string;
  size: string | null;
  person_id: number;
  person_given_name: string;
  family_id: number;
  assigned_to_id: number | null;
  assigned_to_name: string | null;
  purchased_at: string | null;
  purchased_where: string | null;
  received_at: string | null;
  purchaser_note: string | null;
}

/** Payload for marking a wish as purchased. */
export interface WishPurchaseMark {
  purchased_where?: string | null;
  purchaser_note?: string | null;
  received_at?: string | null;
}

/** Payload for batch-assigning wishes to a user. */
export interface WishBatchAssign {
  wish_ids: number[];
  assigned_to_id: number;
}

/** Admin-only wish update schema (includes purchase-tracking fields). */
export interface AdminWishUpdate {
  type?: WishType;
  description?: string;
  size?: string | null;
  assigned_to_id?: number | null;
  purchased_at?: string | null;
  purchased_where?: string | null;
  received_at?: string | null;
  purchaser_note?: string | null;
}

/** Mirrors WishDetail — full wish with person context (returned by detail endpoint). */
export interface WishDetail extends WishSummary {
  person_id: number;
  person_given_name: string | null;
  person_family_name: string | null;
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

/** Response when admin creates an invite. */
export interface ReferrerInviteResponse {
  code: string;
  family_limit: number;
  locked_email: string | null;
  expires_at: string;
  created_at: string;
  email_error: string | null;
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

/** Response from the send-family-invite endpoint (200 = sent, 429/500 = error). */
export interface ReferrerFamilyInviteResponse {
  message: string;
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

/** Item in the review queue list (referrer and admin queues). Mirrors backend FamilyReviewList. */
export interface FamilyReviewQueueItem {
  id: number;
  family_name: string;
  contact_name: string;
  referrer_id: number | null;
  referrer_name: string | null;
  person_count: number;
  wish_review_requested_at: string;
  wish_rejection_reason: string | null;
}

// ---------------------------------------------------------------------------
// Public Families (donor browse)
// ---------------------------------------------------------------------------

/** Mirrors backend PublicFamilySummary — compact family card for the browse page. */
export interface PublicFamilySummary {
  id: number;
  display_id: string;
  bio: string | null;
  person_count: number;
  min_age: number | null;
  max_age: number | null;
  claimed_by_current_user: boolean;
}

/** Mirrors backend PublicFamilyListResponse — paginated public families list. */
export interface PublicFamilyListResponse {
  families: PublicFamilySummary[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
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

/** Mirrors FamilyWishListResponse (family_name excluded for privacy). */
export interface FamilyWishListResponse {
  display_id: string;
  bio: string | null;
  family_wish: string;
  people: PersonWishItem[];
  claimed_by_current_user: boolean;
  claim_status: string | null;
  claim_id: number | null;
}

// ---------------------------------------------------------------------------
// Packing Slips
// ---------------------------------------------------------------------------

/** Mirrors backend PackingSlipPersonItem (no family/contact/bio — volunteer-safe). */
export interface PackingSlipPersonItem {
  display_id: string;
  given_name: string;
  title: string | null;
  age: number;
  note: string | null;
  wishes: WishSummary[];
}

/** Mirrors backend PackingSlipItem. */
export interface PackingSlipItem {
  id: number;
  display_id: string;
  family_wish: string;
  people: PackingSlipPersonItem[];
}

// ---------------------------------------------------------------------------
// Person (detail)
// ---------------------------------------------------------------------------

/** Mirrors PersonDetail. */
export interface PersonDetail {
  id: number;
  family_id: number;
  display_id: string | null;
  given_name: string;
  title: string | null;
  age: number;
  note: string | null;
  created_at: string;
  deleted_at: string | null;
  wishes: WishSummary[];
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

/** Summary of a family assigned to a delivery person (returned by /api/delivery/families). */
export interface DeliveryFamilySummary {
  id: number;
  display_id: string;
  family_name: string;
  address: string | null;
  phone_number: string;
  contact_name: string;
  person_count: number;
}

// ---------------------------------------------------------------------------
// Purchaser
// ---------------------------------------------------------------------------

/** Mirrors PurchaserWishSummary — wish with person/family context for purchaser views. */
export interface PurchaserWishSummary {
  id: number;
  type: WishType;
  description: string;
  size: string | null;
  person_id: number;
  person_given_name: string;
  family_id: number;
  assigned_to_id: number | null;
  purchased_at: string | null;
  purchased_where: string | null;
  received_at: string | null;
  purchaser_note: string | null;
}

/** Partial update for a wish by a purchaser — only purchaser_note and received_at. */
export interface PurchaserWishUpdate {
  purchaser_note?: string | null;
  received_at?: string | null;
}

// ---------------------------------------------------------------------------
// Donor / Claims
// ---------------------------------------------------------------------------

/** Payload for open donor self-registration. */
export interface DonorSelfRegisterPayload {
  display_name: string;
  email: string;
  password: string;
}

/** Response when a donor self-registers. */
export interface DonorSelfRegisterResponse {
  user: User;
}

/** Claim status — derived from fulfilled_at. */
export type ClaimStatus = "active" | "fulfilled";

/** Derive claim status from fulfilled_at timestamp. */
export function getClaimStatus(fulfilled_at: string | null): ClaimStatus {
  return fulfilled_at != null ? "fulfilled" : "active";
}

/** What the donor is committing to. */
export type CommitmentType = "gifts" | "cash";

/** Compact claim for list views. */
export interface FamilyClaimSummary {
  id: number;
  family: {
    id: number;
    display_id: string;
    bio: string | null;
    person_count: number;
    min_age: number | null;
    max_age: number | null;
  };
  commitment_type: CommitmentType;
  notes: string | null;
  created_at: string;
  fulfilled_at: string | null;
  email_error?: string;
}

/** Full claim detail with wish list. */
export interface FamilyClaimDetail {
  id: number;
  family: {
    id: number;
    display_id: string;
    bio: string | null;
    person_count: number;
    min_age: number | null;
    max_age: number | null;
  };
  commitment_type: CommitmentType;
  notes: string | null;
  created_at: string;
  fulfilled_at: string | null;
  donor_user_id: number;
  donor_display_name: string;
  people: PersonWishItem[];
}

/** Body for creating a family claim. */
export interface FamilyClaimCreate {
  commitment_type: CommitmentType;
}

/** Non-admin partial update for a claim. */
export interface FamilyClaimUpdate {
  commitment_type?: CommitmentType | null;
  notes?: string | null;
}

/** Body for marking a wish purchased by a donor (no received_at). */
export interface DonorWishPurchaseMark {
  purchased_where?: string | null;
  purchaser_note?: string | null;
}
