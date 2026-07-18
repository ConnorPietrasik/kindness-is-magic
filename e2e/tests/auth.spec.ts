/**
 * Authentication flows — login, logout, protected routes, role guards.
 *
 * These tests run in the "guest" project (no pre-authenticated state).
 */
import { test, expect } from "@playwright/test";
import { CREDENTIALS, loginAsAdmin, loginAsReferrer, loginAsFamily, logout } from "../helpers/auth";

test.describe("Authentication", () => {
  test("login with valid admin credentials redirects to dashboard", async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText("connor@kindnessismagic.love")).toBeVisible();
  });

  test("login with valid referrer credentials redirects to dashboard", async ({ page }) => {
    await loginAsReferrer(page);
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("login with valid family credentials redirects to dashboard", async ({ page }) => {
    await loginAsFamily(page);
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("login with invalid credentials shows error", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("wrong@example.com");
    await page.getByLabel("Password").fill("wrongpassword");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText("Incorrect email or password")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("logout clears session and redirects to login", async ({ page }) => {
    /* Login first */
    await loginAsAdmin(page);
    await expect(page).toHaveURL(/\/dashboard/);

    /* Click Sign out */
    await logout(page);

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("unauthenticated access to protected route redirects to login", async ({ page }) => {
    await page.goto("/admin/referrers");
    await expect(page).toHaveURL(/\/login/);
  });

  test("wrong-role access to admin route redirects to dashboard", async ({ page }) => {
    /* Login as referrer */
    await loginAsReferrer(page);

    /* Try to access admin route — client-side redirect to /dashboard */
    await page.goto("/admin/referrers");
    await page.waitForTimeout(2000); // wait for React Router redirect
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("wrong-role access to referrer route redirects to dashboard", async ({ page }) => {
    /* Login as family */
    await loginAsFamily(page);

    /* Try to access referrer route — client-side redirect to /dashboard */
    await page.goto("/referrer/dashboard");
    await page.waitForTimeout(2000); // wait for React Router redirect
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("root redirect sends admin to dashboard", async ({ page }) => {
    await loginAsAdmin(page);
    /* Now navigate to root */
    await page.goto("/");
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("root redirect sends referrer to referrer dashboard", async ({ page }) => {
    await loginAsReferrer(page);
    await page.goto("/");
    await expect(page).toHaveURL(/\/referrer\/dashboard/);
    /* DashboardRedirect sends referrers to /referrer/dashboard */
    await expect(page.getByRole("heading", { name: "Referrer Dashboard" })).toBeVisible({ timeout: 10_000 });
  });

  test("root redirect sends family to family dashboard", async ({ page }) => {
    await loginAsFamily(page);
    await page.goto("/");
    await expect(page).toHaveURL(/\/family\/dashboard/);
    /* DashboardRedirect sends families to /family/dashboard */
    await expect(page.getByRole("heading", { name: "Family Dashboard" })).toBeVisible({ timeout: 10_000 });
  });
});
