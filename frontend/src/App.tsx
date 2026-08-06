import { type ComponentType, Fragment, type LazyExoticComponent, lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { HeaderBar } from "./components/HeaderBar";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { PublicRoute } from "./components/PublicRoute";
import { PageSpinner, Spinner } from "./components/Spinner";
import { useAuth } from "./context/AuthContext";
import { ROUTES } from "./lib/routes";
import type { UserRole } from "./types";

// Pages (lazy-loaded on route visit)
const Login: LazyExoticComponent<ComponentType<unknown>> = lazy(() => import("./pages/Login"));
const ForgotPassword: LazyExoticComponent<ComponentType<unknown>> = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword: LazyExoticComponent<ComponentType<unknown>> = lazy(() => import("./pages/ResetPassword"));
const Dashboard: LazyExoticComponent<ComponentType<unknown>> = lazy(() => import("./pages/Dashboard"));
const AdminReferrers: LazyExoticComponent<ComponentType<unknown>> = lazy(() => import("./pages/AdminReferrers"));
const AdminReferrerFamilies: LazyExoticComponent<ComponentType<unknown>> = lazy(() => import("./pages/AdminReferrerFamilies"));
const AdminFamilies: LazyExoticComponent<ComponentType<unknown>> = lazy(() => import("./pages/AdminFamilies"));
const AdminFamilyPeople: LazyExoticComponent<ComponentType<unknown>> = lazy(() => import("./pages/AdminFamilyPeople"));
const AdminPeople: LazyExoticComponent<ComponentType<unknown>> = lazy(() => import("./pages/AdminPeople"));
const CsvUpload: LazyExoticComponent<ComponentType<unknown>> = lazy(() => import("./pages/CsvUpload"));
const ReferrerFamilies: LazyExoticComponent<ComponentType<unknown>> = lazy(() => import("./pages/ReferrerFamilies"));
const ReferrerFamilyDetail: LazyExoticComponent<ComponentType<unknown>> = lazy(() => import("./pages/ReferrerFamilyDetail"));
const FamilyDashboard: LazyExoticComponent<ComponentType<unknown>> = lazy(() => import("./pages/FamilyDashboard"));
const FamilyPeople: LazyExoticComponent<ComponentType<unknown>> = lazy(() => import("./pages/FamilyPeople"));
const AdminInviteCodes: LazyExoticComponent<ComponentType<unknown>> = lazy(() => import("./pages/AdminInviteCodes"));
const ReferrerSelfRegister: LazyExoticComponent<ComponentType<unknown>> = lazy(() => import("./pages/ReferrerSelfRegister"));
const FamilySelfRegister: LazyExoticComponent<ComponentType<unknown>> = lazy(() => import("./pages/FamilySelfRegister"));
const ReferrerFamilyInvites: LazyExoticComponent<ComponentType<unknown>> = lazy(() => import("./pages/ReferrerFamilyInvites"));
const ReferrerReviewQueue: LazyExoticComponent<ComponentType<unknown>> = lazy(() => import("./pages/ReferrerReviewQueue"));
const AdminUsers: LazyExoticComponent<ComponentType<unknown>> = lazy(() => import("./pages/AdminUsers"));
const AdminWishReview: LazyExoticComponent<ComponentType<unknown>> = lazy(() => import("./pages/AdminWishReview"));
const AdminPackingSlips: LazyExoticComponent<ComponentType<unknown>> = lazy(() => import("./pages/AdminPackingSlips"));
const AdminWishes: LazyExoticComponent<ComponentType<unknown>> = lazy(() => import("./pages/AdminWishes"));
const FamilyWishList: LazyExoticComponent<ComponentType<unknown>> = lazy(() => import("./pages/FamilyWishList"));
const PurchaserAssignedGifts: LazyExoticComponent<ComponentType<unknown>> = lazy(() => import("./pages/PurchaserAssignedGifts"));
const DeliveryDashboard: LazyExoticComponent<ComponentType<unknown>> = lazy(() => import("./pages/DeliveryDashboard"));
const DeliveryPackingSlips: LazyExoticComponent<ComponentType<unknown>> = lazy(() => import("./pages/DeliveryPackingSlips"));

/* ------------------------------------------------------------------ */
/* Role-based redirect after login                                     */
/* ------------------------------------------------------------------ */
function DashboardRedirect() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <PageSpinner />;
  }

  // Route to role-specific dashboards
  if (user?.role === "admin") {
    return <Navigate to={ROUTES.DASHBOARD} replace />;
  }
  if (user?.role === "referrer") {
    return <Navigate to={ROUTES.DASHBOARD} replace />;
  }
  if (user?.role === "family") {
    return <Navigate to={ROUTES.FAMILY_DASHBOARD} replace />;
  }
  if (user?.role === "purchaser") {
    return <Navigate to={ROUTES.PURCHASER_ASSIGNED_GIFTS} replace />;
  }
  if (user?.role === "delivery") {
    return <Navigate to={ROUTES.DELIVERY_DASHBOARD} replace />;
  }

  return <Navigate to={ROUTES.LOGIN} replace />;
}

/* ------------------------------------------------------------------ */
/* App router                                                          */
/* ------------------------------------------------------------------ */
const AppLoadingFallback = () => (
  <Fragment>
    <HeaderBar title="Kindness is Magic" />
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <Spinner size="lg" />
    </div>
  </Fragment>
);

export default function App() {
  return (
    <Suspense fallback={<AppLoadingFallback />}>
      <Routes>
        {/* ── Public routes (redirect if already logged in) ──────── */}
        <Route
          path={ROUTES.LOGIN}
          element={
            <PublicRoute>
              <Login />
            </PublicRoute>
          }
        />
        <Route
          path={ROUTES.FORGOT_PASSWORD}
          element={
            <PublicRoute>
              <ForgotPassword />
            </PublicRoute>
          }
        />
        <Route
          path={ROUTES.RESET_PASSWORD}
          element={
            <PublicRoute>
              <ResetPassword />
            </PublicRoute>
          }
        />
        <Route
          path={ROUTES.REFERRER_SELF_REGISTER}
          element={
            <PublicRoute>
              <ReferrerSelfRegister />
            </PublicRoute>
          }
        />
        <Route
          path={ROUTES.FAMILY_SELF_REGISTER}
          element={
            <PublicRoute>
              <FamilySelfRegister />
            </PublicRoute>
          }
        />

        {/* ── Authenticated routes ───────────────────────────────── */}
        <Route
          path={ROUTES.DASHBOARD}
          element={
            <ProtectedRoute roles={["admin", "referrer", "family", "purchaser", "delivery"] as UserRole[]}>
              <Dashboard />
            </ProtectedRoute>
          }
        />

        {/* ── Admin-only ─────────────────────────────────────────── */}
        <Route
          path={ROUTES.ADMIN_USERS}
          element={
            <ProtectedRoute roles={["admin"] as UserRole[]}>
              <AdminUsers />
            </ProtectedRoute>
          }
        />
        <Route
          path={ROUTES.ADMIN_WISH_REVIEW}
          element={
            <ProtectedRoute roles={["admin"] as UserRole[]}>
              <AdminWishReview />
            </ProtectedRoute>
          }
        />
        <Route
          path={ROUTES.ADMIN_PACKING_SLIPS}
          element={
            <ProtectedRoute roles={["admin"] as UserRole[]}>
              <AdminPackingSlips />
            </ProtectedRoute>
          }
        />
        <Route
          path={ROUTES.ADMIN_WISHES}
          element={
            <ProtectedRoute roles={["admin"] as UserRole[]}>
              <AdminWishes />
            </ProtectedRoute>
          }
        />
        <Route
          path={ROUTES.ADMIN_REFERRERS}
          element={
            <ProtectedRoute roles={["admin"] as UserRole[]}>
              <AdminReferrers />
            </ProtectedRoute>
          }
        />
        <Route
          path={ROUTES.ADMIN_REFERRER_FAMILIES}
          element={
            <ProtectedRoute roles={["admin"] as UserRole[]}>
              <AdminReferrerFamilies />
            </ProtectedRoute>
          }
        />
        <Route
          path={ROUTES.ADMIN_FAMILIES}
          element={
            <ProtectedRoute roles={["admin"] as UserRole[]}>
              <AdminFamilies />
            </ProtectedRoute>
          }
        />
        <Route
          path={ROUTES.ADMIN_FAMILY_PEOPLE}
          element={
            <ProtectedRoute roles={["admin"] as UserRole[]}>
              <AdminFamilyPeople />
            </ProtectedRoute>
          }
        />
        <Route
          path={ROUTES.ADMIN_PEOPLE}
          element={
            <ProtectedRoute roles={["admin"] as UserRole[]}>
              <AdminPeople />
            </ProtectedRoute>
          }
        />
        <Route
          path={ROUTES.ADMIN_CSV_UPLOAD}
          element={
            <ProtectedRoute roles={["admin"] as UserRole[]}>
              <CsvUpload />
            </ProtectedRoute>
          }
        />
        <Route
          path={ROUTES.ADMIN_INVITE_CODES}
          element={
            <ProtectedRoute roles={["admin"] as UserRole[]}>
              <AdminInviteCodes />
            </ProtectedRoute>
          }
        />

        {/* ── Referrer self-service ────────────────────────────── */}
        <Route
          path={ROUTES.REFERRER_FAMILIES}
          element={
            <ProtectedRoute roles={["referrer"] as UserRole[]}>
              <ReferrerFamilies />
            </ProtectedRoute>
          }
        />
        <Route
          path={ROUTES.REFERRER_FAMILY_DETAIL}
          element={
            <ProtectedRoute roles={["referrer"] as UserRole[]}>
              <ReferrerFamilyDetail />
            </ProtectedRoute>
          }
        />
        <Route
          path={ROUTES.REFERRER_FAMILY_INVITES}
          element={
            <ProtectedRoute roles={["referrer"] as UserRole[]}>
              <ReferrerFamilyInvites />
            </ProtectedRoute>
          }
        />
        <Route
          path={ROUTES.REFERRER_WISH_REVIEW}
          element={
            <ProtectedRoute roles={["referrer"] as UserRole[]}>
              <ReferrerReviewQueue />
            </ProtectedRoute>
          }
        />

        {/* ── Family self-service ──────────────────────────────── */}
        <Route
          path={ROUTES.FAMILY_DASHBOARD}
          element={
            <ProtectedRoute roles={["family"] as UserRole[]}>
              <FamilyDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path={ROUTES.FAMILY_PEOPLE}
          element={
            <ProtectedRoute roles={["family"] as UserRole[]}>
              <FamilyPeople />
            </ProtectedRoute>
          }
        />

        {/* ── Purchaser self-service ───────────────────────────── */}
        <Route
          path={ROUTES.PURCHASER_ASSIGNED_GIFTS}
          element={
            <ProtectedRoute roles={["purchaser"] as UserRole[]}>
              <PurchaserAssignedGifts />
            </ProtectedRoute>
          }
        />

        {/* ── Delivery self-service ────────────────────────────── */}
        <Route
          path={ROUTES.DELIVERY_DASHBOARD}
          element={
            <ProtectedRoute roles={["delivery"] as UserRole[]}>
              <DeliveryDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path={ROUTES.DELIVERY_PACKING_SLIPS}
          element={
            <ProtectedRoute roles={["delivery"] as UserRole[]}>
              <DeliveryPackingSlips />
            </ProtectedRoute>
          }
        />

        {/* ── Public (no auth required) ─────────────────────────── */}
        <Route path={ROUTES.FAMILY_WISH_LIST} element={<FamilyWishList />} />

        {/* ── Catch-all: redirect root to login or dashboard ────── */}
        <Route path={ROUTES.ROOT} element={<DashboardRedirect />} />
        <Route path="*" element={<Navigate to={ROUTES.ROOT} replace />} />
      </Routes>
    </Suspense>
  );
}
