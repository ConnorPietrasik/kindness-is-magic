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

    /* Verify the new color column was imported: filter the admin wishes list
       to a seeded family and check a color value from the demo CSV. "Navy" is
       Emma Williams' practical wish color — it only appears as a color cell
       (her description uses lowercase "navy blue"). */
    await page.goto("/admin/wishes");
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });
    const familySelect = page.locator("select").filter({ hasText: /All families/ });
    await familySelect.selectOption({ label: "The Williams Family" });
    await expect(page.getByRole("table")).toContainText("Navy", { timeout: 10_000 });

    await context.close();
  });

  test("admin uploads CSV with bad data and sees server-side errors", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/admin/csv-upload");
    await expect(page.getByRole("heading", { name: "CSV Import" })).toBeVisible();

    /* Headers are correct (so client-side validation passes and the import runs),
       but every row is bad data — the errors must come from the server.
       Names are suffixed so a pre-existing record can't change which error fires.
       Nothing is created, so no cleanup is needed. */
    const suffix = Math.random().toString(36).slice(2, 8);
    const missingReferrer = `No Ref ${suffix}`;
    const missingFamily = `No Fam ${suffix}`;
    const malformedCsv = `# referrers
name,family_limit,phone_number
,abc,

# families
referrer_name,family_name,family_wish,contact_name,bio,address,phone_number
${missingReferrer},${missingFamily},Wish,Contact,,,

# people
family_name,given_name,age,wish,size,color,fun_wish,role,note
${missingFamily},Test Person,not_a_number,Bike,,Red,Lego,son,
`;

    await page.setInputFiles('input[type="file"]', {
      name: "malformed.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(malformedCsv),
    });

    /* Wait for file to be selected and client-side validation to pass */
    await expect(page.getByText("malformed.csv")).toBeVisible();
    const importBtn = page.getByRole("button", { name: "Import CSV" });
    await expect(importBtn).toBeEnabled();

    /* Import and wait for results */
    await importBtn.click();
    await expect(page.getByRole("heading", { name: "Import Results" })).toBeVisible({ timeout: 15_000 });

    /* Row details are open by default when there are errors; each bad row
       produced a specific server-side error */
    await expect(page.getByText("Missing 'name'")).toBeVisible();
    await expect(page.getByText(`Referrer '${missingReferrer}' not found`)).toBeVisible();
    await expect(page.getByText(`Family '${missingFamily}' not found`)).toBeVisible();

    await context.close();
  });
});
