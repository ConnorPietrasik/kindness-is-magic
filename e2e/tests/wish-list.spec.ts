/**
 * Family Wish List — public page tests.
 *
 * Runs in the "guest" project (no pre-authenticated state).
 * Validates the public wish-list page renders correctly and handles 404.
 */
import fs from "node:fs";
import { test, expect } from "@playwright/test";

/**
 * Read the seeded family ID saved by global-setup.
 */
function getSeedFamilyId(): number {
  const raw = fs.readFileSync("storage/seed-family-id.json", "utf-8");
  return JSON.parse(raw).id as number;
}

test.describe("Family Wish List (public)", () => {
  test("guest can view a family wish list", async ({ page }) => {
    const familyId = getSeedFamilyId();
    await page.goto(`/families/${familyId}/wish-list`);

    /* Page heading shows the display ID (e.g. "1" or "2-3") — family name is excluded for privacy */
    await expect(page.getByRole("heading", { name: /^\d+(?:-\d+)*$/ })).toBeVisible({
      timeout: 10_000,
    });

    /* Family wish card is visible */
    await expect(page.getByText("A complete holiday dinner for everyone")).toBeVisible();

    /* People table shows seeded members */
    await expect(page.getByRole("table")).toContainText("Emma");
    await expect(page.getByRole("table")).toContainText("Liam");
    await expect(page.getByRole("table")).toContainText("Oliver");

    /* Practical and fun wishes are visible */
    await expect(page.getByRole("table")).toContainText("New coat and mittens");
    await expect(page.getByRole("table")).toContainText("Barbie Dreamhouse doll");
  });

  test("guest sees 404 for non-existent family", async ({ page }) => {
    await page.goto("/families/99999/wish-list");

    await expect(page.getByRole("heading", { name: "Family Not Found" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("This wish list doesn't exist or has been removed.")).toBeVisible();
  });
});
