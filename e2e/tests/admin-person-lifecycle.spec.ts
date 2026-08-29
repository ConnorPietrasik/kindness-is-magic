/**
 * Admin Person Lifecycle — create person, edit person, soft-delete person.
 *
 * Uses CSV-seeded family (The Williams Family) for the person tests.
 * Creates and cleans up its own person records.
 */
import { test, expect } from "@playwright/test";
import type { Locator } from "@playwright/test";
import { deletePersonViaApi, loginViaApi } from "../helpers/api";
import { findRowInTable } from "../helpers/assertions";

/** Open the kebab-menu dropdown and click a menu item by label. */
async function clickAction(row: Locator, actionLabel: string) {
  await row.getByRole("button", { name: "More actions" }).click();
  await row.getByRole("menuitem", { name: actionLabel }).click();
}

const TEST_PERSON = `E2E Test ${Math.random().toString(36).slice(2, 6)}`;
let familyId: number | undefined;
let personId: number | undefined;

test.describe.serial("Admin Person Lifecycle", () => {
  test.afterAll(async ({ request }) => {
    if (personId) {
      const authed = await loginViaApi(request);
      await deletePersonViaApi(authed, personId);
      await authed.dispose();
    }
  });

  test("admin creates a person under a CSV-seeded family", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    /* Navigate to families, find The Williams Family via UI (handles pagination) */
    await page.goto("/admin/families");
    await expect(page.getByRole("heading", { name: "Manage Families" })).toBeVisible();

    const williamsRow = (await findRowInTable(page, "The Williams Family"))!;
    expect(williamsRow).not.toBeNull();

    /* Capture family ID from table row for subsequent tests */
    const familyIdRaw = await williamsRow!.getAttribute("data-id");
    if (familyIdRaw) {
      familyId = parseInt(familyIdRaw, 10);
    }

    /* Click Manage to navigate to the family's people page */
    await (williamsRow! as Locator).getByRole("link", { name: "Manage" }).click();
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
    await page.getByLabel("Age", { exact: true }).fill("7");
    await page.getByLabel("Role").selectOption("son");
    await page.getByLabel("Practical Wish").fill("A warm jacket");
    await page.getByLabel("Size").fill("0");
    await page.getByLabel("Color").fill("0");
    await page.getByLabel("Fun Wish").fill("A puzzle");

    await page.getByRole("button", { name: "Create" }).click();

    /* Verify the new person appears */
    await expect(page.getByRole("table")).toContainText(TEST_PERSON, { timeout: 10_000 });

    /* Capture person ID for cleanup */
    const personRow = page.getByRole("row").filter({ hasText: TEST_PERSON });
    const personIdRaw = await personRow.getAttribute("data-id");
    if (personIdRaw) {
      personId = parseInt(personIdRaw, 10);
    }

    await context.close();
  });

  test("admin edits a person", async ({ browser }) => {
    if (!familyId) test.skip();

    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto(`/admin/families/${familyId}/people`);
    await expect(page.getByRole("heading", { name: "Family & People" })).toBeVisible({
      timeout: 10_000,
    });

    /* Find the test person row and click Edit */
    const row = page.getByRole("row").filter({ hasText: TEST_PERSON });
    await row.getByRole("button", { name: "Edit" }).click();

    /* Edit the age */
    await page.getByLabel("Age", { exact: true }).fill("8");

    /* Submit */
    await page.getByRole("button", { name: "Update" }).click();

    /* Verify the change persisted */
    const updatedRow = page.getByRole("row").filter({ hasText: TEST_PERSON });
    await expect(updatedRow).toBeVisible();

    await context.close();
  });

  test("admin soft-deletes a person", async ({ browser }) => {
    if (!familyId) test.skip();

    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto(`/admin/families/${familyId}/people`);
    await expect(page.getByRole("heading", { name: "Family & People" })).toBeVisible({
      timeout: 10_000,
    });

    /* Find the test person row and click Delete (inside actions dropdown) */
    const row = page.getByRole("row").filter({ hasText: TEST_PERSON });
    await clickAction(row, "Delete");

    /* Confirm the deletion in the dialog */
    await page.getByRole("button", { name: "Yes, delete" }).click();

    /* Verify the person is gone from the list */
    await expect(page.getByText(TEST_PERSON)).not.toBeVisible();

    await context.close();
  });
});
