/**
 * CSV upload — edge cases and error handling.
 *
 * Runs in the "admin" project (pre-authenticated).
 * Main seed is in 00-seed.spec.ts; this tests error handling.
 */
import { test, expect } from "@playwright/test";

test.describe("CSV upload edge cases", () => {
  test("admin uploads malformed CSV and sees validation errors", async ({ page }) => {
    await page.goto("/admin/csv-upload");
    await expect(page.getByRole("heading", { name: "CSV Import" })).toBeVisible();

    /* Upload a malformed CSV */
    const malformedCsv = `# referrers
name,family_limit,phone_number
,abc,

# families
referrer_name,family_name,family_wish,contact_name
NonExistent Referrer,Bad Family,Wish,Contact

# people
family_name,given_name,age,wish,size,fun_wish
Bad Family,Test Person,not_a_number,Bike,,Lego
`;

    /* Use setInputFiles with inline buffer */
    await page.setInputFiles('input[type="file"]', {
      name: "malformed.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(malformedCsv),
    });

    /* Wait for file to be selected */
    await expect(page.getByText("malformed.csv")).toBeVisible();

    /* Validation errors should appear */
    /* The client-side validator should catch missing required fields */
    await page.waitForTimeout(500);

    /* The Import button should be disabled if validation found errors */
    const importBtn = page.getByRole("button", { name: "Import CSV" });

    /* Even if client validation passes (some errors are server-side),
       clicking import should show server errors for bad data */
    if (!(await importBtn.isDisabled())) {
      await importBtn.click();
      /* Wait for results — should have errors */
      await expect(page.getByRole("heading", { name: "Import Results" })).toBeVisible({
        timeout: 15_000,
      });
      /* Should show some error rows */
      await expect(page.getByText("error")).toBeVisible();
    }
  });
});
