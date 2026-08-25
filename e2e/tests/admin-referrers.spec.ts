/**
 * Admin Referrers — view referrers, create referrer, hierarchical family view.
 *
 * Self-contained: creates its own referrer via admin UI for CRUD tests.
 * Views CSV-seeded referrers by name (safe — never mutated).
 */
import { test, expect } from "@playwright/test";
import type { Locator } from "@playwright/test";
import { deleteReferrerViaApi, loginViaApi } from "../helpers/api";
import { findRowInTable } from "../helpers/assertions";

const TEST_REFERRER = `Test E2E Org ${Math.random().toString(36).slice(2, 6)}`;
let referrerId: number | undefined;

test.describe("Admin Referrers", () => {
  test.afterAll(async ({ request }) => {
    if (referrerId) {
      const authed = await loginViaApi(request);
      await deleteReferrerViaApi(authed, referrerId);
      await authed.dispose();
    }
  });

  test("admin views referrers list with CSV-seeded data", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/admin/referrers");
    await expect(page.getByRole("heading", { name: "Manage Referrers" })).toBeVisible();

    /* CSV-seeded referrers should be present */
    await expect(page.getByRole("table")).toContainText("Sarah Chen");
    await expect(page.getByRole("table")).toContainText("Marcus Johnson");
    await expect(page.getByRole("table")).toContainText("Aisha Patel");
    await expect(page.getByRole("table")).toContainText("David Okonkwo");

    await context.close();
  });

  test("admin creates a new referrer", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/admin/referrers");
    await expect(page.getByRole("heading", { name: "Manage Referrers" })).toBeVisible();

    /* Click Add Referrer */
    await page.getByRole("button", { name: "+ Add Referrer" }).click();

    /* Fill the form */
    await page.getByLabel("Name", { exact: true }).fill(TEST_REFERRER);
    await page.getByLabel("Family Limit").fill("5");
    await page.getByLabel("Phone Number").fill("5559990000");

    /* Submit — wait for the form to close so we know the mutation finished
       and the table has refreshed with the new row. */
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByLabel("Name", { exact: true })).not.toBeVisible({ timeout: 15_000 });

    /* Verify it appears in the table (may need to paginate) */
    const referrerRow = await findRowInTable(page, TEST_REFERRER);
    expect(referrerRow).not.toBeNull();

    /* Capture the referrer ID from the table for cleanup */
    const idCell = (referrerRow as Locator).getByRole("cell").first();
    const idText = await idCell.textContent();
    if (idText) {
      referrerId = parseInt(idText.trim(), 10);
    }

    await context.close();
  });

  test("admin views hierarchical families for a referrer", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    /* Navigate to referrers list, find Sarah Chen, click Manage */
    await page.goto("/admin/referrers");
    await expect(page.getByRole("heading", { name: "Manage Referrers" })).toBeVisible();

    const sarahRow = page.getByRole("row").filter({ hasText: "Sarah Chen" });
    await sarahRow.getByRole("link", { name: "Manage" }).click();

    /* Should show Sarah's families */
    await expect(page.getByText("The Williams Family")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("The Rodriguez Family")).toBeVisible();

    await context.close();
  });
});
