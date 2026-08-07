/**
 * Admin Deleted Tabs — soft-delete, deleted tab visibility, restore.
 *
 * Runs in the "admin" project (pre-authenticated).
 * Tests the Active/Deleted tab pattern for families and people,
 * including cascade delete (family delete → people appear in deleted people tab).
 *
 * Uses the CSV-seeded "The Lee Family" for the delete/restore test to avoid
 * the async referrer dropdown.  Leaves it restored at the end so seeded
 * data is intact for any other tests.
 */
import { test, expect } from "@playwright/test";
import type { Locator } from "@playwright/test";

/** Open the kebab-menu dropdown and click a menu item by label. */
async function clickAction(row: Locator, actionLabel: string) {
  await row.getByRole("button", { name: "More actions" }).click();
  await row.getByRole("menuitem", { name: actionLabel }).click();
}

const SEEDED_FAMILY = "The Lee Family";

test.describe("Admin Deleted Tabs", () => {
  test("admin deletes a family, sees it in Deleted tab, restores it back to Active", async ({ page }) => {
    await page.goto("/admin/families");
    await expect(page.getByRole("heading", { name: "Manage Families" })).toBeVisible();

    /* Verify Active tab is visible and selected */
    await expect(page.getByRole("tab", { name: "Active", exact: true })).toBeVisible();

    /* Find the seeded family row and delete it (inside actions dropdown) */
    const familyRow = page.getByRole("row").filter({ hasText: SEEDED_FAMILY });
    await expect(familyRow).toBeVisible();
    await clickAction(familyRow, "Delete");
    await page.getByRole("button", { name: "Yes, delete" }).click();

    /* Verify it's gone from the Active view */
    await expect(page.getByText(SEEDED_FAMILY)).not.toBeVisible();

    /* Switch to the Deleted tab */
    await page.getByRole("tab", { name: "Deleted", exact: true }).click();

    /* Verify the family appears in the Deleted tab with DELETED display_id */
    await expect(page.getByRole("table")).toContainText(SEEDED_FAMILY, { timeout: 10_000 });
    await expect(page.getByRole("table")).toContainText("DELETED");

    /* Restore the family */
    const deletedRow = page.getByRole("row").filter({ hasText: SEEDED_FAMILY });
    await deletedRow.getByRole("button", { name: "Restore" }).click();
    await page.getByRole("button", { name: "Yes, restore" }).click();

    /* Switch back to Active tab */
    await page.getByRole("tab", { name: "Active", exact: true }).click();

    /* Verify the family is back in the Active view */
    await expect(page.getByRole("table")).toContainText(SEEDED_FAMILY, { timeout: 10_000 });

    /* Verify it's no longer in the Deleted tab */
    await page.getByRole("tab", { name: "Deleted", exact: true }).click();
    await expect(page.getByText(SEEDED_FAMILY)).not.toBeVisible();
  });

  test("deleting a family cascade-deletes its people into the Deleted tab", async ({ page }) => {
    const familyWithPerson = `E2E Cascade Family ${Math.random().toString(36).slice(2, 6)}`;
    const personName = `Cascade Person ${Math.random().toString(36).slice(2, 6)}`;

    /* Create the family on the Active tab */
    await page.goto("/admin/families");
    await page.getByRole("tab", { name: "Active", exact: true }).click();

    await page.getByRole("button", { name: "+ Add Family" }).click();
    /* Wait for the referrer <select> to appear (async query) then pick first referrer */
    await expect(page.getByLabel("Referrer")).toBeVisible({ timeout: 10_000 });
    await page.getByLabel("Referrer").selectOption({ index: 1 });
    await page.getByLabel("Family Name").fill(familyWithPerson);
    await page.getByLabel("Contact Name").fill("Cascade Contact");
    await page.getByLabel("Family Wish").fill("Cascade wish");
    await page.getByLabel("Phone Number").fill("5551234567");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByRole("table")).toContainText(familyWithPerson, { timeout: 10_000 });

    /* Navigate to the family's people page and add a person */
    const familyRow = page.getByRole("row").filter({ hasText: familyWithPerson });
    await familyRow.getByRole("link", { name: "Manage" }).click();
    await expect(page.getByRole("heading", { name: "Family & People" })).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole("button", { name: "+ Add Person" }).click();
    await page.getByLabel("Given Name").fill(personName);
    await page.getByLabel("Age").fill("5");
    /* Wish fields appear after age is entered */
    await expect(page.getByLabel("Practical Wish")).toBeVisible({ timeout: 5_000 });
    await page.getByLabel("Practical Wish").fill("A coat");
    await page.getByLabel("Size").fill("M");
    await page.getByLabel("Fun Wish").fill("A toy");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByRole("table")).toContainText(personName, { timeout: 10_000 });

    /* Go back to families and delete the family */
    await page.goto("/admin/families");
    await page.getByRole("tab", { name: "Active", exact: true }).click();

    const familyRowActive = page.getByRole("row").filter({ hasText: familyWithPerson });
    await clickAction(familyRowActive, "Delete");
    await page.getByRole("button", { name: "Yes, delete" }).click();

    /* Navigate to the people page and check the Deleted tab */
    await page.goto("/admin/people");
    await page.getByRole("tab", { name: "Deleted", exact: true }).click();

    /* The cascade-deleted person should appear in the Deleted tab */
    await expect(page.getByRole("table")).toContainText(personName, { timeout: 10_000 });
    await expect(page.getByRole("table")).toContainText("DELETED");

    /* Clean up: restore via the person (family is deleted, so this chains to family restore) */
    const personRowDeleted = page.getByRole("row").filter({ hasText: personName });
    await personRowDeleted.getByRole("button", { name: "Restore" }).click();
    /* First confirm the person restore — API returns family_deleted error */
    await page.getByRole("button", { name: "Yes, restore" }).click();
    /* Then confirm the chained family restore */
    await page.getByRole("button", { name: "Yes, restore family" }).click({ timeout: 10_000 });
  });

  test("display IDs are shown in family and people tables", async ({ page }) => {
    /* Navigate to the referrer-scoped families view to see sequential display IDs */
    await page.goto("/admin/referrers");
    await expect(page.getByRole("heading", { name: "Manage Referrers" })).toBeVisible();

    /* Click Manage on Sarah Chen to see her scoped families */
    const sarahRow = page.getByRole("row").filter({ hasText: "Sarah Chen" });
    await sarahRow.getByRole("link", { name: "Manage" }).click();
    await expect(page.getByText("The Williams Family")).toBeVisible({ timeout: 10_000 });

    /* The ID column should show sequential numbers (1, 2, ...) not raw DB IDs */
    const firstFamilyRow = page.getByRole("row").filter({ hasText: "The Williams Family" });
    const idCell = firstFamilyRow.getByRole("cell").first();
    const idText = (await idCell.textContent())?.trim();
    /* Display ID should be a simple number like "1" or "2", not a large DB ID */
    expect(idText).toMatch(/^\d+$/);
    expect(parseInt(idText!, 10)).toBeLessThan(100);
  });
});
