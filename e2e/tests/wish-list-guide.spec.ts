/**
 * Wish list guide (/wish-list-guide) — public flows plus the family entry points.
 *
 * Creates no data, so there is no afterAll cleanup:
 *  - A guest can load /wish-list-guide directly and sees the three sections:
 *    eligibility/$50, the tips, and both example lists (fun and practical).
 *  - A guest sees the guide link under the Family Wish field on /register-family.
 *  - The footer link from /home reaches the guide. The footer-link assertion
 *    lives here (not in home.spec.ts's LEGAL_PAGES pin) so it stays in one place.
 *  - A logged-in family (existing family.json storageState) sees the dashboard
 *    link; on the people page the tips panel is open by default in a fresh
 *    context, and after closing it, navigating away and back keeps it closed
 *    (same browser context, so the localStorage flag carries over).
 */
import { test, expect } from "@playwright/test";

/** A digest line that is only rendered while the tips panel is expanded. */
const TIP_LINE = "Every item has a $50 price limit.";

test.describe("Wish list guide (public)", () => {
  test("guest loads the guide directly and sees all three sections", async ({ page }) => {
    await page.goto("/wish-list-guide");
    await expect(page.getByRole("heading", { name: "Writing Your Wish List", level: 1 })).toBeVisible({ timeout: 10_000 });

    /* Section 1: eligibility and the $50 limit */
    await expect(page.getByRole("heading", { name: "What you can wish for" })).toBeVisible();
    await expect(page.getByText("Every member of the household gets a gift.")).toBeVisible();
    await expect(page.getByText("Plus one wish for the whole family.")).toBeVisible();
    await expect(page.getByText("Every item has a $50 price limit.")).toBeVisible();

    /* Section 2: the tips */
    await expect(page.getByRole("heading", { name: "How to fill it in" })).toBeVisible();
    await expect(page.getByText("Enter first names only.")).toBeVisible();
    await expect(page.getByText("Wishes must be real, purchasable items — we can't ask donors for gift cards.")).toBeVisible();

    /* Section 3: both example lists, complete */
    await expect(page.getByRole("heading", { name: "Great wish examples" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Fun wishes" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Practical wishes" })).toBeVisible();
    /* The three source movie-ticket lines are consolidated into one */
    await expect(page.getByText("Movie tickets — tell us AMC or Century")).toBeVisible();
    /* The portable charger genuinely appears in both lists */
    await expect(page.getByText("Portable charger w/ built-in cables")).toHaveCount(2);
  });

  test("guide link sits under the Family Wish field on /register-family", async ({ page }) => {
    await page.goto("/register-family");
    await expect(page.getByRole("heading", { name: "Family Registration" })).toBeVisible({ timeout: 10_000 });

    const link = page.getByRole("link", { name: "See the wish list guide" });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "/wish-list-guide");
  });

  test("footer link from /home reaches the guide", async ({ page }) => {
    await page.goto("/home");
    await page.locator("footer").getByRole("link", { name: "Wish list guide" }).click();
    await expect(page).toHaveURL("/wish-list-guide");
    await expect(page.getByRole("heading", { name: "Writing Your Wish List", level: 1 })).toBeVisible();
  });
});

test.describe("Wish list guide (family)", () => {
  test("family dashboard links to the guide", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "storage/family.json" });
    const page = await context.newPage();

    await page.goto("/family/dashboard");
    await expect(page.getByRole("heading", { name: "Family Dashboard" })).toBeVisible({ timeout: 10_000 });

    const link = page.getByRole("link", { name: "See the wish list guide" });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "/wish-list-guide");

    await context.close();
  });

  test("people tips panel is open by default and sticky-closed after dismissal", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "storage/family.json" });
    const page = await context.newPage();

    /* Fresh context (no localStorage flag): the panel is open by default */
    await page.goto("/family/people");
    await expect(page.getByRole("heading", { name: "Manage People" })).toBeVisible({ timeout: 10_000 });

    const toggle = page.getByRole("button", { name: /How to write a great wish/ });
    await expect(toggle).toBeVisible();
    const tip = page.getByText(TIP_LINE);
    await expect(tip).toBeVisible();

    /* Close it — the closed state is written to localStorage */
    await toggle.click();
    await expect(tip).not.toBeVisible();

    /* Navigate away and back (same context, so the flag carries over) */
    await page.goto("/family/dashboard");
    await page.goto("/family/people");
    await expect(page.getByRole("heading", { name: "Manage People" })).toBeVisible({ timeout: 10_000 });
    await expect(tip).not.toBeVisible();

    await context.close();
  });
});
