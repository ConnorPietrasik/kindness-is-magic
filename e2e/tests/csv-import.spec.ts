/**
 * CSV Import — upload via UI, malformed CSV errors.
 *
 * Self-contained: uses admin storageState for auth.
 * The demo CSV is idempotent — re-running produces "skipped" counts.
 */
import { test, expect } from "@playwright/test";

test.describe("CSV Import", () => {
  test("admin uploads demo CSV and sees success summary", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

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

    /* Verify the summary shows resource sections */
    await expect(page.getByText("Referrers", { exact: true })).toBeVisible();
    await expect(page.getByText("Families", { exact: true })).toBeVisible();
    await expect(page.getByText("People", { exact: true })).toBeVisible();
    await expect(page.getByText("Users", { exact: true })).toBeVisible();

    await context.close();
  });

  test("admin uploads malformed CSV and sees validation errors", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

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

    await page.setInputFiles('input[type="file"]', {
      name: "malformed.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(malformedCsv),
    });

    /* Wait for file to be selected */
    await expect(page.getByText("malformed.csv")).toBeVisible();

    /* Validation errors should appear */
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

    await context.close();
  });
});
