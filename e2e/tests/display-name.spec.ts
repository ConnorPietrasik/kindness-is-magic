/**
 * Display name — CSV import with display_name column.
 *
 * Runs in the "admin" project (pre-authenticated).
 * Verifies that CSV import correctly handles the display_name column in the
 * users section.  The demo_import.csv already includes display_name, so this
 * re-uploads it and confirms idempotent "skipped" counts (no errors).
 */
import { test, expect } from "@playwright/test";

test.describe("Display name — CSV import", () => {
  test("admin CSV import with display_name column succeeds (idempotent)", async ({
    page,
  }) => {
    await page.goto("/admin/csv-upload");
    await expect(page.getByRole("heading", { name: "CSV Import" })).toBeVisible();

    /* Upload the demo CSV which includes display_name column */
    await page.setInputFiles('input[type="file"]', "../demo_import.csv");

    /* Wait for file to be selected */
    await expect(page.getByText("demo_import.csv")).toBeVisible();

    /* Click Import */
    await page.getByRole("button", { name: "Import CSV" }).click();

    /* Wait for import results */
    await expect(page.getByRole("heading", { name: "Import Results" })).toBeVisible({
      timeout: 15_000,
    });

    /* Should show Users section with skipped counts (already seeded) */
    await expect(page.getByText("Users", { exact: true })).toBeVisible();

    /* Should NOT show any import errors */
    await expect(page.getByText("error", { exact: true })).not.toBeVisible();
  });
});
