import type { Page } from "@playwright/test";
import { getAdminEmail, getAdminPassword } from "./env";

/**
 * Shared test credentials from .env + demo_import.csv.
 */
export const CREDENTIALS = {
  admin: {
    email: getAdminEmail(),
    password: getAdminPassword(),
  },
  referrer: {
    email: "sarah.chen@example.com",
    password: "Password123!",
  },
  family: {
    email: "emily.williams@example.com",
    password: "Password123!",
  },
} as const;

/**
 * Navigate to /login, fill credentials, click Sign in, and assert redirect.
 *
 * Admins and referrers land on /dashboard.
 * Families are redirected straight to /family/dashboard.
 *
 * @param page  Playwright page
 * @param creds Credentials object with email + password
 */
export async function loginAs(
  page: Page,
  creds: { email: string; password: string },
): Promise<void> {
  await page.goto("/login");

  await page.getByLabel("Email").fill(creds.email);
  await page.getByLabel("Password").fill(creds.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  /* Wait for any dashboard URL (main or role-specific). Role-specific wrappers add their own assertions. */
  await page.waitForURL(/\/dashboard/);
}

/**
 * Convenience wrappers for the three roles.
 */
import { expect } from "@playwright/test";

export async function loginAsAdmin(page: Page): Promise<void> {
  await loginAs(page, CREDENTIALS.admin);
  await expect(page.getByText("Admin")).toBeVisible();
}

export async function loginAsReferrer(page: Page): Promise<void> {
  await loginAs(page, CREDENTIALS.referrer);
  /* { exact: true } avoids strict-mode collision with "Referrer ID: N" */
  await expect(page.getByText("Referrer", { exact: true })).toBeVisible();
}

export async function loginAsFamily(page: Page): Promise<void> {
  await loginAs(page, CREDENTIALS.family);
  /* Families land on /family/dashboard which has "Family Dashboard" heading */
  await expect(page.getByRole("heading", { name: "Family Dashboard" })).toBeVisible();
}

/**
 * Click the "Sign out" button in the header bar and assert redirect to /login.
 */
export async function logout(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/\/login/);
  /* Use getByRole to avoid strict-mode collision between heading and button */
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
}
