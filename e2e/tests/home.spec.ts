/**
 * Home brochure (/home) — public flows only.
 *
 * Creates no data, so there is no afterAll cleanup:
 *  - Unauthenticated "/" lands on the brochure at /home.
 *  - "Meet the Families" reaches the public browse page.
 *  - The header title on /families links back to /home.
 *  - Footer legal links reach their pages; Donate and social links point at
 *    the exact external URLs (asserted by attribute — never clicked out).
 *  - An authenticated visitor still sees the brochure (no redirect away) with
 *    a Dashboard link in the header.
 *
 * The wish-list header is deliberately not covered here (it would require
 * seeding an approved family): it is the same PublicHeader already covered by
 * the vitest gate and by /families above.
 */
import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "../helpers/auth";

/**
 * Pinned external URLs — the user-facing contract for the footer (a wrong
 * constant in the app must fail this test, not be absorbed by it).
 * Pinned here, not imported from the app: keep in sync with
 * frontend/src/lib/links.ts, the source of truth for the app itself.
 */
const DONATE_URL = "https://www.zeffy.com/en-US/donation-form/kindness-is-magic-holiday-program";
const INSTAGRAM_URL = "https://www.instagram.com/queenelfjenn/";
const FACEBOOK_URL = "https://www.facebook.com/people/Kindness-is-Magic/61580617419642/";

const LEGAL_PAGES = [
  { link: "Privacy Policy", path: "/privacy", heading: "Privacy Policy" },
  { link: "CA Privacy Notice", path: "/privacy-california", heading: "California Privacy Notice" },
  { link: "Financials", path: "/financials", heading: "Financials" },
] as const;

test.describe("Home brochure (public)", () => {
  test("unauthenticated / lands on /home with the hero heading", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 10_000 });
  });

  test("Meet the Families navigates to the public browse page", async ({ page }) => {
    await page.goto("/home");
    /* The label appears in the hero and the closing band — click the first */
    await page.getByRole("link", { name: "Meet the Families" }).first().click();
    await expect(page).toHaveURL(/\/families/);
    await expect(page.getByRole("heading", { name: "Families Needing Gifts" })).toBeVisible({ timeout: 10_000 });
  });

  test("header title on /families links back to /home", async ({ page }) => {
    await page.goto("/families");
    const title = page.getByRole("link", { name: "Kindness is Magic" });
    await expect(title).toBeVisible({ timeout: 10_000 });
    await expect(title).toHaveAttribute("href", "/home");
    await title.click();
    await expect(page).toHaveURL(/\/home$/);
  });

  test("footer legal links lead to their pages", async ({ page }) => {
    await page.goto("/home");
    for (const { link, path, heading } of LEGAL_PAGES) {
      await page.locator("footer").getByRole("link", { name: link }).click();
      await expect(page).toHaveURL(path);
      await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    }
  });

  test("footer Donate and social links use the exact external URLs", async ({ page }) => {
    await page.goto("/home");
    const footer = page.locator("footer");

    const donate = footer.getByRole("link", { name: "Donate" });
    await expect(donate).toHaveAttribute("href", DONATE_URL);
    await expect(donate).toHaveAttribute("target", "_blank");

    await expect(footer.getByRole("link", { name: "Instagram" })).toHaveAttribute("href", INSTAGRAM_URL);
    await expect(footer.getByRole("link", { name: "Facebook" })).toHaveAttribute("href", FACEBOOK_URL);
  });

  test("authenticated visitor still sees the brochure, with a Dashboard link", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/home");
    await expect(page).toHaveURL(/\/home/);
    /* No redirect away — the brochure renders for everyone */
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  });
});
