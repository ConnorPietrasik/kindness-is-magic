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

const TEST_REFERRER = `Test E2E Org ${Math.random().toString(36).slice(2, 8)}`;
let referrerId: number | undefined;

const PICKUP_REFERRER = `Test E2E Pickup ${Math.random().toString(36).slice(2, 8)}`;
let pickupReferrerId: number | undefined;

// Local-time input value for the <input type="datetime-local"> picker
const PICKUP_WINDOW_INPUT = "2026-12-20T10:00";

// Same locale formatting as the UI's formatDateTime — computed here so the
// assertion matches the rendered value regardless of the host locale.
function formatPickupWindow(inputValue: string): string {
  return new Date(inputValue).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

test.describe("Admin Referrers", () => {
  test.afterAll(async ({ request }) => {
    const authed = await loginViaApi(request);
    if (referrerId) await deleteReferrerViaApi(authed, referrerId);
    if (pickupReferrerId) await deleteReferrerViaApi(authed, pickupReferrerId);
    await authed.dispose();
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
    await page.getByRole("button", { name: "+ Add referrer" }).click();

    /* Fill the form */
    await page.getByLabel("Name", { exact: true }).fill(TEST_REFERRER);
    await page.getByLabel("Family Limit").fill("5");
    await page.getByLabel("Phone Number").fill("5559990000");

    /* Submit — wait for the form to close so we know the mutation finished
       and the table has refreshed with the new row. */
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByLabel("Name", { exact: true })).not.toBeVisible({ timeout: 15_000 });

    /* Verify it appears in the table. Narrow to it by name first: the list
       sorts by ID and concurrent specs create referrers with interleaved
       IDs, so the row's page can shift while we look — and the shared
       pagination walk is one-directional (a slow refetch past the first
       10s wait leaves page 1 and never returns). A search hit is a single
       row on page 1 with no pagination. */
    await page.getByLabel("Search by name").fill(TEST_REFERRER);

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

  test("admin creates a referrer with a pickup window and sees it in the referrer view", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/admin/referrers");
    await expect(page.getByRole("heading", { name: "Manage Referrers" })).toBeVisible();

    /* Fill the create form, including the pickup window (datetime-local) */
    await page.getByRole("button", { name: "+ Add referrer" }).click();
    await page.getByLabel("Name", { exact: true }).fill(PICKUP_REFERRER);
    await page.getByLabel("Family Limit").fill("3");
    await page.getByLabel("Phone Number").fill("5559990001");
    await page.locator('input[type="datetime-local"]').fill(PICKUP_WINDOW_INPUT);

    /* Submit — wait for the form to close so the table has refreshed */
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByLabel("Name", { exact: true })).not.toBeVisible({ timeout: 15_000 });

    /* Narrow to the new row via search, then open its referrer view */
    await page.getByLabel("Search by name").fill(PICKUP_REFERRER);
    const row = await findRowInTable(page, PICKUP_REFERRER);
    expect(row).not.toBeNull();

    const idText = await (row as Locator).getByRole("cell").first().textContent();
    if (idText) pickupReferrerId = parseInt(idText.trim(), 10);

    await (row as Locator).getByRole("link", { name: "Manage" }).click();

    /* The referrer card shows the window (InfoRow: label + value spans) */
    const pickupRow = page.locator("div.flex.items-baseline").filter({ has: page.getByText("Pickup Window", { exact: true }) });
    await expect(pickupRow).toContainText(formatPickupWindow(PICKUP_WINDOW_INPUT), { timeout: 10_000 });

    await context.close();
  });
});
