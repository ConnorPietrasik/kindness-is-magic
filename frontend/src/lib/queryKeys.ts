/**
 * Centralised React Query key definitions.
 *
 * All useQuery / useMutation / invalidateQueries calls should reference
 * these exports instead of inline string arrays.
 */

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/** Current user session */
export const auth = ["auth"] as const;

// ---------------------------------------------------------------------------
// Admin — Referrers
// ---------------------------------------------------------------------------

/** Active referrers list */
export const adminReferrers = ["adminReferrers"] as const;
/** Soft-deleted referrers list */
export const adminDeletedReferrers = ["adminDeletedReferrers"] as const;
/** Single referrer detail (pass id at call site) */
export const adminReferrerDetail = (id: string) => ["adminReferrers", id] as const;

// ---------------------------------------------------------------------------
// Admin — Families
// ---------------------------------------------------------------------------

/** Active families list */
export const adminFamilies = ["adminFamilies"] as const;
/** Soft-deleted families list */
export const adminDeletedFamilies = ["adminDeletedFamilies"] as const;
/** Single family detail (pass id at call site) */
export const adminFamilyDetail = (id: string) => ["adminFamilies", id] as const;

// ---------------------------------------------------------------------------
// Admin — Families scoped to a referrer
// ---------------------------------------------------------------------------

/** Families belonging to a specific referrer */
export const adminReferrerFamilies = (id: string) => ["adminReferrerFamilies", id] as const;
/** Soft-deleted families belonging to a specific referrer */
export const adminDeletedReferrerFamilies = (id: string) => ["adminDeletedReferrerFamilies", id] as const;

// ---------------------------------------------------------------------------
// Admin — People
// ---------------------------------------------------------------------------

/** Active people list */
export const adminPeople = ["adminPeople"] as const;
/** Soft-deleted people list */
export const adminDeletedPeople = ["adminDeletedPeople"] as const;

// ---------------------------------------------------------------------------
// Admin — People scoped to a family
// ---------------------------------------------------------------------------

/** People belonging to a specific family */
export const adminFamilyPeople = (id: string) => ["adminFamilyPeople", id] as const;
/** Soft-deleted people belonging to a specific family */
export const adminDeletedFamilyPeople = (id: string) => ["adminDeletedFamilyPeople", id] as const;

// ---------------------------------------------------------------------------
// Admin — Users
// ---------------------------------------------------------------------------

/** Active users list */
export const adminUsers = ["adminUsers"] as const;
/** Soft-deleted users list */
export const adminDeletedUsers = ["adminDeletedUsers"] as const;

// ---------------------------------------------------------------------------
// Admin — Invite Codes
// ---------------------------------------------------------------------------

/** Invite codes list */
export const adminInvites = ["adminInvites"] as const;

// ---------------------------------------------------------------------------
// Admin — Dropdown lookups
// ---------------------------------------------------------------------------

/** Referrers for dropdown selects */
export const adminReferrersDropdown = ["adminReferrersDropdown"] as const;
/** Families for dropdown selects */
export const adminFamiliesDropdown = ["adminFamiliesDropdown"] as const;
/** Users for dropdown selects */
export const adminUsersDropdown = ["adminUsersDropdown"] as const;

// ---------------------------------------------------------------------------
// Referrer — Self
// ---------------------------------------------------------------------------

/** Current referrer's own details */
export const referrerMe = ["referrerMe"] as const;

// ---------------------------------------------------------------------------
// Referrer — Families
// ---------------------------------------------------------------------------

/** Referrer's approved families list */
export const referrerFamilies = ["referrerFamilies"] as const;
/** Single family detail for a referrer (pass id at call site) */
export const referrerFamilyDetail = (id: string) => ["referrerFamily", id] as const;

// ---------------------------------------------------------------------------
// Referrer — People within a family
// ---------------------------------------------------------------------------

/** People within a referrer's family */
export const referrerFamilyPeople = (id: string) => ["referrerFamilyPeople", id] as const;

// ---------------------------------------------------------------------------
// Referrer — Pending approvals
// ---------------------------------------------------------------------------

/** Families pending referrer approval */
export const pendingFamilies = ["pendingFamilies"] as const;

// ---------------------------------------------------------------------------
// Referrer — Wish Review Queue
// ---------------------------------------------------------------------------

/** Families awaiting referrer wish review */
export const referrerReviewQueue = ["referrerReviewQueue"] as const;

// ---------------------------------------------------------------------------
// Family — Self
// ---------------------------------------------------------------------------

/** Current family's own details */
export const familyMe = ["familyMe"] as const;

// ---------------------------------------------------------------------------
// Family — People
// ---------------------------------------------------------------------------

/** People belonging to the current family */
export const familyPeople = ["familyPeople"] as const;

// ---------------------------------------------------------------------------
// Admin — Wish Review Queue
// ---------------------------------------------------------------------------

/** Families awaiting admin wish approval */
export const adminReviewQueue = ["adminReviewQueue"] as const;

// ---------------------------------------------------------------------------
// Admin — Packing Slips
// ---------------------------------------------------------------------------

/** Packing slips for printing (static key — params handled inline) */
export const adminPackingSlips = ["adminPackingSlips"] as const;

// ---------------------------------------------------------------------------
// Public — Wish List
// ---------------------------------------------------------------------------

/** Public wish list for a family (pass id at call site) */
export const familyWishList = (id: number) => ["familyWishList", id] as const;

// ---------------------------------------------------------------------------
// Admin — Wishes
// ---------------------------------------------------------------------------

/** Admin wishes list */
export const adminWishes = ["adminWishes"] as const;
/** Single admin wish detail (pass id at call site) */
export const adminWishDetail = (id: number) => ["adminWishes", id] as const;

// ---------------------------------------------------------------------------
// Purchaser — Wishes
// ---------------------------------------------------------------------------

/** Purchaser's assigned wishes list */
export const purchaserWishes = ["purchaserWishes"] as const;
/** Single purchaser wish detail (pass id at call site) */
export const purchaserWishDetail = (id: number) => ["purchaserWishes", id] as const;

// ---------------------------------------------------------------------------
// Delivery — Families
// ---------------------------------------------------------------------------

/** Delivery person's assigned families list */
export const deliveryFamilies = ["deliveryFamilies"] as const;
/** Packing slips for the delivery person's assigned families */
export const deliveryPackingSlips = ["deliveryPackingSlips"] as const;
