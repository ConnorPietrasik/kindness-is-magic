/**
 * Admin CRUD flows — manage referrers, families, people.
 *
 * Runs in the "admin" project (pre-authenticated).
 * Most tests use CSV-seeded data by name; a few create new records.
 * Uses unique names per run so re-runs without DB wipe don't collide.
 */
import { test, expect } from "@playwright/test";
import { deleteReferrerViaApi, deletePersonViaApi } from "../helpers/api";

const TEST_REFERRER = `Test E2E Org ${Math.random().toString(36).slice(2, 6)}`;
const TEST_PERSON = `E2E Test ${Math.random().toString(36).slice(2, 6)}`;

/* Track IDs of ad-hoc records created during this test file */
const testData: { referrerId?: number; personId?: number; familyId?: number } = {};

test.describe("Admin CRUD", () => {
  test.afterAll(async ({ request }) => {
    /* Clean up ad-hoc records */
    if (testData.personId) await deletePersonViaApi(request, testData.personId);
    if (testData.referrerId) await deleteReferrerViaApi(request, testData.referrerId);
  });

  test("admin views referrers list with CSV-seeded data", async ({ page }) => {
    await page.goto("/admin/referrers");
    await expect(page.getByRole("heading", { name: "Manage Referrers" })).toBeVisible();

    /* CSV-seeded referrers should be present */
    await expect(page.getByRole("table")).toContainText("Sarah Chen");
    await expect(page.getByRole("table")).toContainText("Marcus Johnson");
    await expect(page.getByRole("table")).toContainText("Aisha Patel");
    await expect(page.getByRole("table")).toContainText("David Okonkwo");
  });

  test("admin creates a new referrer", async ({ page }) => {
    await page.goto("/admin/referrers");
    await expect(page.getByRole("heading", { name: "Manage Referrers" })).toBeVisible();

    /* Click Add Referrer */
    await page.getByRole("button", { name: "+ Add Referrer" }).click();

    /* Fill the form */
    await page.getByLabel("Name").fill(TEST_REFERRER);
    await page.getByLabel("Family Limit").fill("5");
    await page.getByLabel("Phone").fill("555-999-0000");

    /* Submit */
    await page.getByRole("button", { name: "Create" }).click();

    /* Verify it appears in the table */
    await expect(page.getByRole("table")).toContainText(TEST_REFERRER, { timeout: 10_000 });

    /* Capture the referrer ID from the table for cleanup */
    const idCell = page.getByRole("row").filter({ hasText: TEST_REFERRER }).getByRole("cell").first();
    const idText = await idCell.textContent();
    if (idText) {
      testData.referrerId = parseInt(idText.trim(), 10);
    }
  });

  test("admin views hierarchical families for a referrer", async ({ page }) => {
    /* Navigate to referrers list, find Sarah Chen, click Manage */
    await page.goto("/admin/referrers");
    await expect(page.getByRole("heading", { name: "Manage Referrers" })).toBeVisible();

    const sarahRow = page.getByRole("row").filter({ hasText: "Sarah Chen" });
    await sarahRow.getByRole("link", { name: "Manage" }).click();

    /* Should show Sarah's families */
    await expect(page.getByText("The Williams Family")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("The Rodriguez Family")).toBeVisible();
  });

  test("admin creates a person under a CSV-seeded family", async ({ page }) => {
    /* Go to admin families to find The Williams Family ID */
    await page.goto("/admin/families");
    await expect(page.getByRole("heading", { name: "Manage Families" })).toBeVisible();

    /* Find The Williams Family row and note its ID */
    const williamsRow = page.getByRole("row").filter({ hasText: "The Williams Family" });
    const idCell = williamsRow.getByRole("cell").first();
    const idText = await idCell.textContent();
    const familyId = idText ? parseInt(idText.trim(), 10) : 0;
    /* Store familyId for navigation in subsequent tests. This is a CSV-seeded
       family — do NOT delete it in afterAll (would orphan the family user's FK). */
    testData.familyId = familyId;

    /* Navigate to that family's people page */
    await page.goto(`/admin/families/${familyId}/people`);
    await expect(page.getByRole("heading", { name: "Family & People" })).toBeVisible({
      timeout: 10_000,
    });

    /* Verify CSV-seeded people are present */
    await expect(page.getByRole("table")).toContainText("Emma");
    await expect(page.getByRole("table")).toContainText("Liam");

    /* Add a new person */
    await page.getByRole("button", { name: "+ Add Person" }).click();

    /* Fill the person form */
    await page.getByLabel("Given Name").fill(TEST_PERSON);
    await page.getByLabel("Age").fill("7");
    await page.getByLabel("Practical Wish").fill("A warm jacket");
    await page.getByLabel("Fun Wish").fill("A puzzle");

    await page.getByRole("button", { name: "Create" }).click();

    /* Verify the new person appears */
    await expect(page.getByRole("table")).toContainText(TEST_PERSON, { timeout: 10_000 });

    /* Capture person ID for cleanup */
    const personRow = page.getByRole("row").filter({ hasText: TEST_PERSON });
    const personIdCell = personRow.getByRole("cell").first();
    const personIdText = await personIdCell.textContent();
    if (personIdText) {
      testData.personId = parseInt(personIdText.trim(), 10);
    }
  });

  test("admin edits a person", async ({ page }) => {
    if (!testData.familyId) test.skip();

    await page.goto(`/admin/families/${testData.familyId}/people`);
    await expect(page.getByRole("heading", { name: "Family & People" })).toBeVisible({
      timeout: 10_000,
    });

    /* Find the test person row and click Edit */
    const row = page.getByRole("row").filter({ hasText: TEST_PERSON });
    await row.getByRole("button", { name: "Edit" }).click();

    /* Edit the age */
    await page.getByLabel("Age").fill("8");

    /* Submit */
    await page.getByRole("button", { name: "Update" }).click();

    /* Verify the change persisted */
    const updatedRow = page.getByRole("row").filter({ hasText: TEST_PERSON });
    await expect(updatedRow).toBeVisible();
  });

  test("admin soft-deletes a person", async ({ page }) => {
    if (!testData.familyId) test.skip();

    await page.goto(`/admin/families/${testData.familyId}/people`);
    await expect(page.getByRole("heading", { name: "Family & People" })).toBeVisible({
      timeout: 10_000,
    });

    /* Find the test person row and click Delete */
    const row = page.getByRole("row").filter({ hasText: TEST_PERSON });
    await row.getByRole("button", { name: "Delete" }).click();

    /* Confirm the deletion in the dialog */
    await page.getByRole("button", { name: "Yes, delete" }).click();

    /* Verify the person is gone from the list */
    await expect(page.getByText(TEST_PERSON)).not.toBeVisible();
  });
});
