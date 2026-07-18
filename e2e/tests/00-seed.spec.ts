/**
 * CSV Seed — runs first (filename ordering) to exercise the UI upload flow.
 *
 * The globalSetup already seeds the database via API, so this test validates
 * the CSV upload UI. Re-running produces "skipped" counts (idempotent).
 */
import { test, expect } from "@playwright/test";

test.describe("CSV seed (UI upload)", () => {
  test("admin uploads demo CSV and sees success summary", async ({ page }) => {
    /* Navigate to CSV upload page (admin is pre-authenticated via storageState) */
    await page.goto("/admin/csv-upload");
    await expect(page.getByRole("heading", { name: "CSV Import" })).toBeVisible();

    /* Use the file input to upload demo_import.csv */
    await page.setInputFiles('input[type="file"]', "../demo_import.csv");

    /* Wait for file to be selected and validation to show */
    await expect(page.getByText("demo_import.csv")).toBeVisible();

    /* Click Import CSV */
    await page.getByRole("button", { name: "Import CSV" }).click();

    /* Wait for import results */
    await expect(page.getByRole("heading", { name: "Import Results" })).toBeVisible({
      timeout: 15_000,
    });

    /* Verify the summary shows skipped counts (data already seeded by globalSetup) */
    await expect(page.getByText("Referrers", { exact: true })).toBeVisible();
    await expect(page.getByText("Families", { exact: true })).toBeVisible();
    await expect(page.getByText("People", { exact: true })).toBeVisible();
    await expect(page.getByText("Users", { exact: true })).toBeVisible();
  });
});
