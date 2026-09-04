/**
 * Authentication flows — login, logout, root redirects, already-logged-in page.
 *
 * These tests run in the "guest" project (no pre-authenticated state).
 * Role-based access control tests live in role-guards.spec.ts.
 */
import { test, expect, request as playwrightRequest } from "@playwright/test";
import { loginAsAdmin, loginAsReferrer, loginAsFamily, logout } from "../helpers/auth";
import { getAdminEmail, getAdminPassword, getSecretKey } from "../helpers/env";
import { makeExpiredAccessToken } from "../helpers/jwt";

test.describe("Authentication", () => {
  test("login with valid admin credentials redirects to dashboard", async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText("connor@kindnessismagic.love")).toBeVisible();
  });

  test("login with valid referrer credentials redirects to dashboard", async ({ page }) => {
    await loginAsReferrer(page);
    await expect(page).toHaveURL(/\/dashboard/);
    /* Referrers now land on the main /dashboard */
  });

  test("login with valid family credentials redirects to family dashboard", async ({ page }) => {
    await loginAsFamily(page);
    await expect(page).toHaveURL(/\/family\/dashboard/);
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

  test("page reload with expired access token stays logged in via refresh token", async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page).toHaveURL(/\/dashboard/);

    // Id + role of the logged-in user, from the live session.
    const me = (await (await page.request.get("/api/auth/me")).json()) as { id: number; role: string };

    // Replace the access-token cookie with a correctly signed but EXPIRED
    // JWT — the state the browser is in after the 30-minute access-token
    // window lapses while the refresh token is still valid.
    const expiredToken = await makeExpiredAccessToken(getSecretKey(), me.id, me.role);
    await page.context().addCookies([
      {
        name: "access_token",
        value: expiredToken,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);

    // On reload the /me check 401s; the app must silently refresh (valid
    // refresh-token cookie) and keep the user on the dashboard instead of
    // redirecting to /login. Wait for the settled dashboard content first —
    // the URL can still read /dashboard during boot before a redirect.
    await page.reload();
    await expect(page.getByText("Admin")).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("root redirect sends admin to dashboard", async ({ page }) => {
    await loginAsAdmin(page);
    /* Now navigate to root */
    await page.goto("/");
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("root redirect sends referrer to main dashboard", async ({ page }) => {
    await loginAsReferrer(page);
    await page.goto("/");
    await expect(page).toHaveURL(/\/dashboard/);
    /* DashboardRedirect now sends referrers to /dashboard */
    await expect(page.getByRole("heading", { name: "Welcome back!" })).toBeVisible({ timeout: 10_000 });
  });

  test("root redirect sends family to family dashboard", async ({ page }) => {
    await loginAsFamily(page);
    await page.goto("/");
    await expect(page).toHaveURL(/\/family\/dashboard/);
    /* DashboardRedirect sends families to /family/dashboard */
    await expect(page.getByRole("heading", { name: "Family Dashboard" })).toBeVisible({ timeout: 10_000 });
  });

  test("authenticated user visiting /login sees Already Logged In page", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/login");
    await expect(page.getByText("You're already logged in")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Go to Dashboard" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Log Out" })).toBeVisible();
  });

  test("authenticated user visiting /register-family sees Already Logged In page", async ({ page }) => {
    await loginAsReferrer(page);
    await page.goto("/register-family");
    await expect(page.getByText("You're already logged in")).toBeVisible({ timeout: 10_000 });
  });

  test("Already Logged In page — Go to Dashboard navigates to role dashboard", async ({ page }) => {
    await loginAsReferrer(page);
    await page.goto("/register-family");
    await expect(page.getByText("You're already logged in")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Go to Dashboard" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("heading", { name: "Welcome back!" })).toBeVisible({ timeout: 10_000 });
  });

  test("Already Logged In page — Log Out redirects to login", async ({ page }) => {
    await loginAsFamily(page);
    await page.goto("/login");
    await expect(page.getByText("You're already logged in")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Log Out" }).click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("two concurrent refreshes with the same token both succeed (tab race)", async () => {
    /* Browser cookie jars are shared across tabs: two tabs whose access
     * tokens just expired both fire /refresh with the same pre-rotation
     * refresh token. Without the grace window, the loser of the race gets
     * 401 "revoked" and is logged out. Both must succeed. */
    const loginCtx = await playwrightRequest.newContext({ baseURL: "http://localhost" });
    const login = await loginCtx.post("/api/auth/login", {
      data: { email: getAdminEmail(), password: getAdminPassword() },
    });
    expect(login.ok()).toBeTruthy();
    const sharedToken = (login.headers()["set-cookie"] ?? "").match(/refresh_token=([^;,\s]+)/)?.[1];
    expect(sharedToken).toBeTruthy();
    await loginCtx.dispose();

    /* Two independent contexts, both pinned to the same pre-rotation token.
     * Pin via an explicit Cookie header — this Playwright version's
     * APIRequestContext has no cookie-jar API. */
    const cookieHeader = { Cookie: `refresh_token=${sharedToken}` };
    const [ctxA, ctxB] = await Promise.all([
      playwrightRequest.newContext({ baseURL: "http://localhost" }),
      playwrightRequest.newContext({ baseURL: "http://localhost" }),
    ]);

    const results = await Promise.all(
      [ctxA, ctxB].map(async (ctx) => {
        const resp = await ctx.post("/api/auth/refresh", { headers: cookieHeader });
        await ctx.dispose();
        return resp.ok();
      }),
    );

    expect(results).toEqual([true, true]);
  });
});
