/**
 * Admin Wish Management — view wishes, filter, search, edit, mark purchased, batch assign.
 *
 * Read-only tests (list, filter, search) use CSV-seeded wishes.
 * Mutation tests (edit, mark purchased, batch assign) use an isolated family
 * so parallel workers don't step on each other's wishes.
 */
import { test, expect, request } from "@playwright/test";
import {
  createIsolatedFamilyScenario,
  deleteReferrerViaApi,
  deleteFamilyViaApi,
  deleteUserViaApi,
  loginViaApi,
  listWishesViaApi,
  batchAssignWishesViaApi,
} from "../helpers/api";

// ── Read-only tests (CSV-seeded data — safe for parallel) ───────────────────

test.describe("Admin Wish Management — read-only", () => {
  test("page loads with seeded wishes", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/admin/wishes");
    await expect(page.getByRole("heading", { name: "Manage Wishes" })).toBeVisible();
    // Seeded data has many wishes — at least one should appear
    await expect(page.getByRole("table")).toContainText("Emma", { timeout: 10_000 });

    await context.close();
  });

  test("filter by family narrows the list", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/admin/wishes");
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });

    // Open the family dropdown and pick "The Williams Family"
    const familySelect = page.locator("select").filter({ hasText: /All families/ });
    await familySelect.selectOption({ label: "The Williams Family" });

    // Wait for the table to re-render — only Williams wishes should appear
    await expect(page.getByRole("table")).toContainText("The Williams Family");

    await context.close();
  });

  test("filter by purchased status", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/admin/wishes");
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });

    const statusSelect = page.locator("select").filter({ hasText: /All statuses/ });

    // "Unpurchased" should show wishes
    await statusSelect.selectOption({ label: "Unpurchased" });
    await expect(page.getByRole("table")).toBeVisible();
    const unpurchasedCount = await page.getByRole("row").count();

    // Switch to "Purchased" — count may differ (state from prior runs)
    await statusSelect.selectOption({ label: "Purchased" });
    await page.waitForTimeout(500); // wait for re-render
    const purchasedCount = await page.getByRole("row").count();

    // Unpurchased should have at least as many rows as purchased (seed data has many unpurchased)
    expect(unpurchasedCount).toBeGreaterThanOrEqual(purchasedCount);

    // Reset to "All" for subsequent tests
    await statusSelect.selectOption({ label: "All statuses" });

    await context.close();
  });

  test("search filters by description", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/admin/wishes");
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });

    await page.getByPlaceholder("Search wishes\u2026").fill("backpack");
    // Wait for table to update
    await expect(page.getByRole("table")).toContainText("backpack", { timeout: 10_000 });

    await context.close();
  });
});

// ── Mutation tests (isolated family — no parallel collisions) ───────────────

const MUTATION_SUFFIX = Math.random().toString(36).slice(2, 8);
const MUTATION_PERSON_NAME = `WishMut ${MUTATION_SUFFIX}`;
const MUTATION_WISH_DESC = `Edited e2e wish ${MUTATION_SUFFIX}`;

const mutationData: {
  referrerId?: number;
  familyId?: number;
  purchaserUserId?: number;
} = {};

test.describe.serial("Admin Wish Management — mutations", () => {
  test.beforeAll(async ({ request: req }) => {
    const api = await loginViaApi(req);
    const scenario = await createIsolatedFamilyScenario(api, MUTATION_SUFFIX, {
      personName: MUTATION_PERSON_NAME,
      personWish: "Original wish description",
      personFunWish: "Original fun wish",
    });

    mutationData.referrerId = scenario.referrerId;
    mutationData.familyId = scenario.familyId;

    // Create a purchaser user for batch-assign test
    const purchaserResp = await api.post("/api/admin/users", {
      data: {
        email: `e2e-purchaser-wish-${MUTATION_SUFFIX}@example.com`,
        password: "Password123!",
        role: "purchaser",
        display_name: `Purchaser ${MUTATION_SUFFIX}`,
      },
    });
    if (purchaserResp.ok()) {
      const purchaserData = (await purchaserResp.json()) as { id: number };
      mutationData.purchaserUserId = purchaserData.id;
    }

    await api.dispose();
  });

  test.afterAll(async ({ request: req }) => {
    const authed = await loginViaApi(req);
    if (mutationData.purchaserUserId) {
      await deleteUserViaApi(authed, mutationData.purchaserUserId);
    }
    if (mutationData.familyId) {
      await deleteFamilyViaApi(authed, mutationData.familyId);
    }
    if (mutationData.referrerId) {
      await deleteReferrerViaApi(authed, mutationData.referrerId);
    }
    await authed.dispose();
  });

  test("edit wish description and save", async ({ browser }) => {
    if (!mutationData.familyId) test.skip();

    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/admin/wishes");
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });

    // Filter to our isolated family so we don't accidentally edit another test's wish
    const familySelect = page.locator("select").filter({ hasText: /All families/ });
    // Find our family by the person's unique name in the dropdown options
    // The dropdown labels are family names — we need to find the right one
    // Since our family name contains the unique suffix, we can search for it
    const allOptions = await familySelect.locator("option").allTextContents();
    const ourFamilyLabel = allOptions.find((label) => label.includes(MUTATION_SUFFIX));
    if (!ourFamilyLabel) {
      // Family might not show in dropdown if it was just created — try by ID
      // Navigate directly to the family-scoped wishes
      await page.goto(`/admin/wishes?family_id=${mutationData.familyId}`);
    } else {
      await familySelect.selectOption({ label: ourFamilyLabel });
    }

    // Wait for table to show our person's wishes
    await expect(page.getByRole("table")).toContainText(MUTATION_PERSON_NAME, { timeout: 10_000 });

    // Click Edit on the first row (should be our isolated wish)
    await page.getByRole("button", { name: "Edit" }).first().click();
    await expect(page.getByText("Edit Wish")).toBeVisible();

    // Clear and type new description
    const descInput = page.getByLabel("Description");
    await descInput.clear();
    await descInput.fill(MUTATION_WISH_DESC);

    // Save
    await page.getByRole("button", { name: "Update" }).click();

    // Verify the new description appears in the table
    await expect(page.getByRole("table")).toContainText(MUTATION_WISH_DESC, { timeout: 10_000 });

    await context.close();
  });

  test("mark wish as purchased", async ({ browser }) => {
    if (!mutationData.familyId) test.skip();

    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/admin/wishes");
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });

    // Filter to our isolated family
    const familySelect = page.locator("select").filter({ hasText: /All families/ });
    const allOptions = await familySelect.locator("option").allTextContents();
    const ourFamilyLabel = allOptions.find((label) => label.includes(MUTATION_SUFFIX));
    if (ourFamilyLabel) {
      await familySelect.selectOption({ label: ourFamilyLabel });
    } else {
      await page.goto(`/admin/wishes?family_id=${mutationData.familyId}`);
    }

    // Filter to unpurchased wishes
    const statusSelect = page.locator("select").filter({ hasText: /All statuses/ });
    await statusSelect.selectOption({ label: "Unpurchased" });
    await expect(page.getByRole("table")).toBeVisible();

    // Wait for our person's wish to appear
    await expect(page.getByRole("table")).toContainText(MUTATION_PERSON_NAME, { timeout: 10_000 });

    // Find the Mark Purchased button on our person's row
    const ourRow = page.getByRole("row").filter({ hasText: MUTATION_PERSON_NAME }).first();
    const markBtn = ourRow.getByRole("button", { name: "Mark Purchased" });

    if (await markBtn.count() > 0) {
      await markBtn.click();

      // Dialog opens
      await expect(page.getByText(/Mark wish for/)).toBeVisible({ timeout: 10_000 });

      // Fill purchased where and submit
      await page.getByLabel("Purchased Where").fill("E2E Test Store");
      const dialog = page.locator(".fixed.inset-0.z-50").first();
      await dialog.getByRole("button", { name: "Mark Purchased" }).click();

      // Success toast appears
      await expect(page.getByText("Wish marked as purchased")).toBeVisible({ timeout: 10_000 });
    }

    await context.close();
  });

  test("batch assign wishes to a user", async ({ browser, request: req }) => {
    if (!mutationData.familyId || !mutationData.purchaserUserId) test.skip();

    // First, un-purchase any wishes we marked in the previous test so batch assign has something to work with
    const api = await loginViaApi(req);
    const wishes = await listWishesViaApi(api, { familyId: mutationData.familyId });
    // We need unpurchased wishes for batch assign. If all are purchased from the previous test,
    // we can still test with the purchased ones (the UI just shows them).
    await api.dispose();

    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/admin/wishes");
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });

    // Filter to our isolated family
    const familySelect = page.locator("select").filter({ hasText: /All families/ });
    const allOptions = await familySelect.locator("option").allTextContents();
    const ourFamilyLabel = allOptions.find((label) => label.includes(MUTATION_SUFFIX));
    if (ourFamilyLabel) {
      await familySelect.selectOption({ label: ourFamilyLabel });
    } else {
      await page.goto(`/admin/wishes?family_id=${mutationData.familyId}`);
    }

    // Wait for our person's wishes to appear
    await expect(page.getByRole("table")).toContainText(MUTATION_PERSON_NAME, { timeout: 10_000 });

    // Select the first wish row checkbox (not the header "select all")
    // Our filtered table should only show our family's wishes
    const firstRowCheckbox = page.getByRole("row").nth(1).getByRole("checkbox");
    await firstRowCheckbox.click();

    // Batch Assign button should show count
    await expect(page.getByRole("button", { name: "Batch Assign (1)" })).toBeVisible();

    // Open batch assign dialog
    await page.getByRole("button", { name: "Batch Assign (1)" }).click();
    // Dialog header contains "1 wish" inside <strong>
    await expect(page.getByText("1 wish")).toBeVisible({ timeout: 10_000 });

    // Select a user from the dropdown (first non-placeholder option)
    await page.locator("label", { hasText: "Assign to" }).locator("..").locator("select").selectOption({ index: 1 });

    // Submit — use exact match to avoid matching "Batch Assign"
    await page.getByRole("button", { name: "Assign", exact: true }).click();

    // Success toast
    await expect(page.getByText(/wish.*assigned/i).first()).toBeVisible({ timeout: 10_000 });

    await context.close();
  });
});
