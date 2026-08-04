/**
 * Admin Wishes — manage, assign, and track gift purchases.
 *
 * Runs in the "admin" project (pre-authenticated).
 * Uses CSV-seeded wishes; no ad-hoc records are created.
 */
import { test, expect } from "@playwright/test";

test.describe("Admin Wishes", () => {
  test("page loads with seeded wishes", async ({ page }) => {
    await page.goto("/admin/wishes");
    await expect(page.getByRole("heading", { name: "Manage Wishes" })).toBeVisible();
    // Seeded data has many wishes — at least one should appear
    await expect(page.getByRole("table")).toContainText("Emma", { timeout: 10_000 });
  });

  test("filter by family narrows the list", async ({ page }) => {
    await page.goto("/admin/wishes");
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });

    // Open the family dropdown and pick "The Williams Family"
    const familySelect = page.locator("select").filter({ hasText: /All families/ });
    await familySelect.selectOption({ label: "The Williams Family" });

    // Wait for the table to re-render — only Williams wishes should appear
    await expect(page.getByRole("table")).toContainText("The Williams Family");
  });

  test("filter by purchased status", async ({ page }) => {
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
  });

  test("search filters by description", async ({ page }) => {
    await page.goto("/admin/wishes");
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });

    await page.getByPlaceholder("Search wishes\u2026").fill("backpack");
    // Wait for table to update
    await expect(page.getByRole("table")).toContainText("backpack", { timeout: 10_000 });
  });

  test("edit wish description and save", async ({ page }) => {
    const SUFFIX = Math.random().toString(36).slice(2, 6);
    const NEW_DESC = `Edited e2e ${SUFFIX}`;

    await page.goto("/admin/wishes");
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });

    // Click Edit on the first row
    await page.getByRole("button", { name: "Edit" }).first().click();
    await expect(page.getByText("Edit Wish")).toBeVisible();

    // Clear and type new description
    const descInput = page.getByLabel("Description");
    await descInput.clear();
    await descInput.fill(NEW_DESC);

    // Save
    await page.getByRole("button", { name: "Update" }).click();

    // Verify the new description appears in the table
    await expect(page.getByRole("table")).toContainText(NEW_DESC, { timeout: 10_000 });
  });

  test("mark wish as purchased", async ({ page }) => {
    await page.goto("/admin/wishes");
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });

    // Filter to unpurchased wishes so the first "Mark Purchased" button is enabled
    const statusSelect = page.locator("select").filter({ hasText: /All statuses/ });
    await statusSelect.selectOption({ label: "Unpurchased" });
    await expect(page.getByRole("table")).toBeVisible();

    // Click Mark Purchased on the first (unpurchased) wish
    await page.getByRole("button", { name: "Mark Purchased" }).first().click();

    // Dialog opens
    await expect(page.getByText(/Mark wish for/)).toBeVisible({ timeout: 10_000 });

    // Fill purchased where and submit
    await page.getByLabel("Purchased Where").fill("E2E Test Store");
    const dialog = page.locator(".fixed.inset-0.z-50").first();
    await dialog.getByRole("button", { name: "Mark Purchased" }).click();

    // Success toast appears
    await expect(page.getByText("Wish marked as purchased")).toBeVisible({ timeout: 10_000 });
  });

  test("batch assign wishes to a user", async ({ page }) => {
    await page.goto("/admin/wishes");
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });

    // Select the first wish row checkbox (not the header "select all")
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
    await expect(page.getByText(/wish.*assigned/i)).toBeVisible({ timeout: 10_000 });
  });
});
