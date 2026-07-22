import { describe, expect, it } from "vitest";
import { ROUTES, route } from "./routes";

describe("ROUTES constants", () => {
  it("has correct public routes", () => {
    expect(ROUTES.LOGIN).toBe("/login");
    expect(ROUTES.FORGOT_PASSWORD).toBe("/forgot-password");
    expect(ROUTES.RESET_PASSWORD).toBe("/reset-password/:token");
  });

  it("has correct dashboard route", () => {
    expect(ROUTES.DASHBOARD).toBe("/dashboard");
  });

  it("has correct admin routes", () => {
    expect(ROUTES.REGISTER).toBe("/register");
    expect(ROUTES.ADMIN_REFERRERS).toBe("/admin/referrers");
    expect(ROUTES.ADMIN_REFERRER_FAMILIES).toBe("/admin/referrers/:id/families");
    expect(ROUTES.ADMIN_FAMILIES).toBe("/admin/families");
    expect(ROUTES.ADMIN_FAMILY_PEOPLE).toBe("/admin/families/:id/people");
    expect(ROUTES.ADMIN_PEOPLE).toBe("/admin/people");
    expect(ROUTES.ADMIN_CSV_UPLOAD).toBe("/admin/csv-upload");
  });

  it("has correct referrer routes", () => {
    expect(ROUTES.REFERRER_FAMILIES).toBe("/referrer/families");
    expect(ROUTES.REFERRER_FAMILY_DETAIL).toBe("/referrer/families/:id");
    expect(ROUTES.REFERRER_PENDING_FAMILIES).toBe("/referrer/pending-families");
  });

  it("has correct family routes", () => {
    expect(ROUTES.FAMILY_DASHBOARD).toBe("/family/dashboard");
    expect(ROUTES.FAMILY_PEOPLE).toBe("/family/people");
  });

  it("has correct root route", () => {
    expect(ROUTES.ROOT).toBe("/");
  });
});

describe("route dynamic builders", () => {
  it("builds reset-password path with token", () => {
    expect(route.resetPassword("abc123")).toBe("/reset-password/abc123");
  });

  it("builds referrer family detail path with id", () => {
    expect(route.referrerFamilyDetail(42)).toBe("/referrer/families/42");
    expect(route.referrerFamilyDetail("family-7")).toBe("/referrer/families/family-7");
  });

  it("builds admin referrer families path with id", () => {
    expect(route.adminReferrerFamilies(5)).toBe("/admin/referrers/5/families");
    expect(route.adminReferrerFamilies("ref-3")).toBe("/admin/referrers/ref-3/families");
  });

  it("builds admin family people path with id", () => {
    expect(route.adminFamilyPeople(12)).toBe("/admin/families/12/people");
    expect(route.adminFamilyPeople("fam-7")).toBe("/admin/families/fam-7/people");
  });
});
