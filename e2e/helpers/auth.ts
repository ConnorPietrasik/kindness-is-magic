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
 * All roles land on /dashboard first (Login component uses ROUTES.DASHBOARD).
 * The Dashboard page then shows role-specific nav cards.
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

  /* All roles redirect to /dashboard first. Wait for the welcome card. */
  await page.waitForURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: "Welcome back!" })).toBeVisible();
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
  /* { exact: true } avoids strict-mode collision with "Family ID: N" / "My Family" */
  await expect(page.getByText("Family", { exact: true })).toBeVisible();
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
