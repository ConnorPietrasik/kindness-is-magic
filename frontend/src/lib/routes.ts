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

  // ── Dashboard (all authenticated roles) ────────────────────
  DASHBOARD: "/dashboard",

  // ── Admin ──────────────────────────────────────────────────
  REGISTER: "/register",
  ADMIN_REFERRERS: "/admin/referrers",
  ADMIN_REFERRER_FAMILIES: "/admin/referrers/:id/families",
  ADMIN_INVITE_REFERRER: "/admin/invite-referrer",
  ADMIN_FAMILIES: "/admin/families",
  ADMIN_FAMILY_PEOPLE: "/admin/families/:id/people",
  ADMIN_PEOPLE: "/admin/people",
  ADMIN_CSV_UPLOAD: "/admin/csv-upload",

  // ── Referrer self-service ─────────────────────────────────
  REFERRER_FAMILIES: "/referrer/families",
  REFERRER_FAMILY_DETAIL: "/referrer/families/:id",
  REFERRER_PENDING_FAMILIES: "/referrer/pending-families",

  // ── Family self-service ───────────────────────────────────
  FAMILY_DASHBOARD: "/family/dashboard",
  FAMILY_PEOPLE: "/family/people",

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
  adminFamilyPeople: (id: number | string) => `/admin/families/${id}/people`,
};
