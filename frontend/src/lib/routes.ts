/**
 * ROUTES — centralised route path constants.
 *
 * All hardcoded path strings in <Route> definitions, <Navigate>,
 * <Link>, and programmatic navigation should reference these exports
 * instead of inline strings.
 */
export const ROUTES = {
  // ── Public ──────────────────────────────────────────────────
  LOGIN: "/login",
  FORGOT_PASSWORD: "/forgot-password",
  RESET_PASSWORD: "/reset-password/:token",
  REFERRER_SELF_REGISTER: "/register-referrer",
  FAMILY_SELF_REGISTER: "/register-family",
  DONOR_SELF_REGISTER: "/register-donor",

  // ── Dashboard (all authenticated roles) ────────────────────
  DASHBOARD: "/dashboard",

  // ── Admin ──────────────────────────────────────────────────
  ADMIN_USERS: "/admin/users",
  ADMIN_REFERRERS: "/admin/referrers",
  ADMIN_REFERRER_FAMILIES: "/admin/referrers/:id/families",
  ADMIN_INVITE_CODES: "/admin/invite-codes",
  ADMIN_FAMILIES: "/admin/families",
  ADMIN_FAMILY_PEOPLE: "/admin/families/:id/people",
  ADMIN_PEOPLE: "/admin/people",
  ADMIN_CSV_UPLOAD: "/admin/csv-upload",
  ADMIN_WISH_REVIEW: "/admin/wish-review",
  ADMIN_PACKING_SLIPS: "/admin/packing-slips",
  ADMIN_WISHES: "/admin/wishes",

  // ── Referrer self-service ─────────────────────────────────
  REFERRER_FAMILIES: "/referrer/families",
  REFERRER_FAMILY_DETAIL: "/referrer/families/:id",
  REFERRER_FAMILY_INVITES: "/referrer/family-invites",
  REFERRER_WISH_REVIEW: "/referrer/wish-review",

  // ── Family self-service ───────────────────────────────────
  FAMILY_DASHBOARD: "/family/dashboard",
  FAMILY_PEOPLE: "/family/people",

  // ── Purchaser self-service ────────────────────────────────
  PURCHASER_ASSIGNED_GIFTS: "/purchaser/assigned-gifts",

  // ── Delivery self-service ────────────────────────────────
  DELIVERY_DASHBOARD: "/delivery",
  DELIVERY_PACKING_SLIPS: "/delivery/packing-slips",

  // ── Donor self-service ───────────────────────────────────
  DONOR_DASHBOARD: "/donor/dashboard",
  DONOR_CLAIMS: "/donor/claims",
  DONOR_CLAIM_DETAIL: "/donor/claims/:id",

  // ── Public ────────────────────────────────────────────────
  PUBLIC_FAMILIES: "/families",
  FAMILY_WISH_LIST: "/families/:id/wish-list",

  // ── Root ──────────────────────────────────────────────────
  ROOT: "/",
} as const;

/**
 * Dynamic route builders (return strings ready for <Navigate to=...> or
 * useNavigate()).
 */
export const route = {
  resetPassword: (token: string) => `/reset-password/${token}`,
  referrerFamilyDetail: (id: number | string) => `/referrer/families/${id}`,
  adminReferrerFamilies: (id: number | string) => `/admin/referrers/${id}/families`,
  adminInviteCodes: (openGenerator?: boolean) => (openGenerator ? "/admin/invite-codes?generate=1" : "/admin/invite-codes"),
  adminFamilyPeople: (id: number | string) => `/admin/families/${id}/people`,
  familyWishList: (id: number | string) => `/families/${id}/wish-list`,
  adminPackingSlips: (familyIds?: number[]) =>
    familyIds && familyIds.length > 0 ? `/admin/packing-slips?family_ids=${familyIds.join(",")}` : "/admin/packing-slips",
  donorClaimDetail: (id: number | string) => `/donor/claims/${id}`,
};
