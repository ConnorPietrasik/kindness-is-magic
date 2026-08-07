/**
 * Purchaser Flow — assigned gifts, mark purchased, inline edit.
 *
 * Runs in the "purchaser" project (pre-authenticated via storageState).
 * Uses wishes assigned to the purchaser by global-setup.
 */
import { test, expect } from "@playwright/test";

test.describe("Purchaser — Assigned Gifts", () => {
  test("page loads with assigned wishes", async ({ page }) => {
    await page.goto("/purchaser/assigned-gifts");
    await expect(page.getByRole("heading", { name: "Assigned Gifts" })).toBeVisible();
    // global-setup assigns at least one wish — table should appear with data
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });
  });

  test("filter by purchased status", async ({ page }) => {
    await page.goto("/purchaser/assigned-gifts");
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });

    const statusSelect = page.locator("select").filter({ hasText: /All statuses/ });

    // "Unpurchased" should show wishes (seeded wishes start unpurchased)
    await statusSelect.selectOption({ label: "Unpurchased" });
    await expect(page.getByRole("table")).toBeVisible();

    // Reset to "All"
    await statusSelect.selectOption({ label: "All statuses" });
  });

  test("mark wish as purchased", async ({ page }) => {
    await page.goto("/purchaser/assigned-gifts");
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });

    // Filter to unpurchased so the first "Mark Purchased" button is enabled
    const statusSelect = page.locator("select").filter({ hasText: /All statuses/ });
    await statusSelect.selectOption({ label: "Unpurchased" });
    await expect(page.getByRole("table")).toBeVisible();

    // Click Mark Purchased on the first unpurchased wish
    await page.getByRole("button", { name: "Mark Purchased" }).first().click();

    // Dialog opens
    await expect(page.getByText(/Mark gift for/)).toBeVisible({ timeout: 10_000 });

    // Fill purchased where and submit
    await page.getByLabel("Purchased Where").fill("E2E Test Store");
    const dialog = page.locator(".fixed.inset-0.z-50").first();
    await dialog.getByRole("button", { name: "Mark Purchased" }).click();

    // Success toast appears
    await expect(page.getByText("Wish marked as purchased")).toBeVisible({ timeout: 10_000 });

    // Switch to "Purchased" filter — the wish should now appear there
    await statusSelect.selectOption({ label: "Purchased" });
    // The table should show a checkmark (✓) for purchased wishes
    await expect(page.getByRole("table")).toContainText("✓", { timeout: 10_000 });
  });

  test("edit purchaser note and received date", async ({ page }) => {
    const SUFFIX = Math.random().toString(36).slice(2, 6);
    const NOTE = `E2e note ${SUFFIX}`;

    await page.goto("/purchaser/assigned-gifts");
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });

    // Click Edit on the first row
    await page.getByRole("button", { name: "Edit" }).first().click();
    await expect(page.getByText(/Edit — Gift for/)).toBeVisible({ timeout: 10_000 });

    // The edit form uses OptionalLabel (a <span>, not <label>), so the textarea
    // has no accessible name. Locate it inside the edit card by finding the
    // textarea that follows the "Purchaser Note" text.
    const editCard = page.locator(".rounded-xl").filter({ hasText: /Edit — Gift for/ });
    await editCard.locator("textarea").first().fill(NOTE);

    // Save
    await page.getByRole("button", { name: "Update" }).click();

    // Verify the form closed and table is back
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });
  });

  test("purchaser sees family link to wishlist", async ({ page }) => {
    await page.goto("/purchaser/assigned-gifts");
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });

    // Family column should contain a link (to the public wishlist page)
    const familyLink = page.getByRole("cell").filter({ hasText: /Family #/ }).first();
    await expect(familyLink.locator("a")).toBeVisible();
  });

});
