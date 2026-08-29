/**
 * Admin Family Lifecycle — create, edit, soft-delete, deleted tab, restore, cascade-delete people, fully approve.
 *
 * Self-contained: creates families via the admin UI so they are guaranteed to appear in the table.
 * Uses unique suffixes so parallel workers never collide on shared CSV data.
 *
 * When checking the Deleted tab, navigates through paginated pages to find the
 * target record — accumulated soft-deleted records from prior runs can push new
 * records off the first page.
 */
import { test, expect } from "@playwright/test";
import type { Locator } from "@playwright/test";
import { findRowInTable } from "../helpers/assertions";

/** Open the kebab-menu dropdown and click a menu item by label. */
async function clickAction(row: Locator, actionLabel: string) {
  await row.getByRole("button", { name: "More actions" }).click();
  await row.getByRole("menuitem", { name: actionLabel }).click();
}

// ── Delete / Restore test ──────────────────────────────────────────────────

const DELETE_RESTORE_FAMILY = `E2E DR ${Math.random().toString(36).slice(2, 8)}`;

test.describe("Admin Family Lifecycle — delete/restore", () => {
  test("admin deletes a family, sees it in Deleted tab, restores it back to Active", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    /* Create the family via UI */
    await page.goto("/admin/families");
    await expect(page.getByRole("heading", { name: "Manage Families" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Active", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "+ Add Family" }).click();
    await expect(page.getByLabel("Referrer")).toBeVisible({ timeout: 10_000 });
    await page.getByLabel("Referrer").selectOption({ index: 1 });
    await page.getByLabel("Family Name", { exact: true }).fill(DELETE_RESTORE_FAMILY);
    await page.getByLabel("Contact Name", { exact: true }).fill("DR Contact");
    await page.getByLabel("Family Wish", { exact: true }).fill("DR wish");
    await page.getByLabel("Address", { exact: true }).fill("none");
    await page.getByLabel("Phone Number", { exact: true }).fill("5551234567");
    await page.getByRole("button", { name: "Create" }).click();

    /* Find the new family in the table (may need to paginate) */
    const familyRow = (await findRowInTable(page, DELETE_RESTORE_FAMILY, { maxPages: 20 }))!;
    expect(familyRow).not.toBeNull();

    /* Delete the family via UI */
    await clickAction(familyRow, "Delete");
    await page.getByRole("button", { name: "Yes, delete" }).click();

    /* Verify it's gone from the Active view */
    await expect(page.getByText(DELETE_RESTORE_FAMILY)).not.toBeVisible();

    /* Switch to the Deleted tab */
    await page.getByRole("tab", { name: "Deleted", exact: true }).click();
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });

    /* Find the family in the Deleted tab (may need to paginate) */
    const deletedRow = await findRowInTable(page, DELETE_RESTORE_FAMILY);
    expect(deletedRow).not.toBeNull();

    /* Verify DELETED display_id is shown */
    await expect(deletedRow!).toContainText("DELETED");

    /* Restore the family */
    await (deletedRow! as Locator).getByRole("button", { name: "Restore" }).click();
    await page.getByRole("button", { name: "Yes, restore" }).click();

    /* Switch back to Active tab */
    await page.getByRole("tab", { name: "Active", exact: true }).click();

    /* Verify the family is back in the Active view (may need to paginate) */
    const restoredRow = await findRowInTable(page, DELETE_RESTORE_FAMILY);
    expect(restoredRow).not.toBeNull();

    /* Verify it's no longer in the Deleted tab */
    await page.getByRole("tab", { name: "Deleted", exact: true }).click();
    await expect(page.getByText(DELETE_RESTORE_FAMILY)).not.toBeVisible();

    await context.close();
  });
});

// ── Cascade-delete test ────────────────────────────────────────────────────

test.describe("Admin Family Lifecycle — cascade delete", () => {
  test("deleting a family cascade-deletes its people into the Deleted tab", async ({ browser }) => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const familyName = `E2E Cascade Family ${suffix}`;
    const personName = `Cascade Person ${suffix}`;

    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    /* Create the family on the Active tab */
    await page.goto("/admin/families");
    await page.getByRole("tab", { name: "Active", exact: true }).click();

    await page.getByRole("button", { name: "+ Add Family" }).click();
    await expect(page.getByLabel("Referrer")).toBeVisible({ timeout: 10_000 });
    await page.getByLabel("Referrer").selectOption({ index: 1 });
    await page.getByLabel("Family Name", { exact: true }).fill(familyName);
    await page.getByLabel("Contact Name", { exact: true }).fill("Cascade Contact");
    await page.getByLabel("Family Wish", { exact: true }).fill("Cascade wish");
    await page.getByLabel("Address", { exact: true }).fill("none");
    await page.getByLabel("Phone Number", { exact: true }).fill("5551234567");
    await page.getByRole("button", { name: "Create" }).click();

    /* Find the new family (may need to paginate) */
    const familyRow = (await findRowInTable(page, familyName))!;
    expect(familyRow).not.toBeNull();

    /* Navigate to the family's people page and add a person */
    await familyRow.getByRole("link", { name: "Manage" }).click();
    await expect(page.getByRole("heading", { name: "Family & People" })).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole("button", { name: "+ Add Person" }).click();
    await page.getByLabel("Given Name").fill(personName);
    await page.getByLabel("Age").fill("5");
    await page.getByLabel("Role").selectOption("son");
    await expect(page.getByLabel("Practical Wish")).toBeVisible({ timeout: 5_000 });
    await page.getByLabel("Practical Wish").fill("A coat");
    await page.getByLabel("Size").fill("M");
    await page.getByLabel("Fun Wish").fill("A toy");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByRole("table")).toContainText(personName, { timeout: 10_000 });

    /* Go back to families and delete the family */
    await page.goto("/admin/families");
    await page.getByRole("tab", { name: "Active", exact: true }).click();

    const familyRowActive = (await findRowInTable(page, familyName))!;
    expect(familyRowActive).not.toBeNull();
    await clickAction(familyRowActive as Locator, "Delete");
    await page.getByRole("button", { name: "Yes, delete" }).click();

    /* Navigate to the people page and check the Deleted tab */
    await page.goto("/admin/people");
    await page.getByRole("tab", { name: "Deleted", exact: true }).click();
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });

    /* Find the cascade-deleted person (may need to paginate) */
    const personRowDeleted = await findRowInTable(page, personName);
    expect(personRowDeleted).not.toBeNull();

    await expect(personRowDeleted! as Locator).toContainText("DELETED");

    /* Restore via the person (family is deleted, so this chains to family restore) */
    await (personRowDeleted! as Locator).getByRole("button", { name: "Restore" }).click();
    await page.getByRole("button", { name: "Yes, restore" }).click();
    await page.getByRole("button", { name: "Yes, restore family" }).click({ timeout: 10_000 });

    await context.close();
  });
});

// ── Display IDs test (uses CSV-seeded data — read-only, safe for parallel) ──

test.describe("Admin Family Lifecycle — display IDs", () => {
  test("display IDs are shown in family and people tables", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/admin/referrers");
    await expect(page.getByRole("heading", { name: "Manage Referrers" })).toBeVisible();

    const sarahRow = page.getByRole("row").filter({ hasText: "Sarah Chen" });
    await sarahRow.getByRole("link", { name: "Manage" }).click();
    await expect(page.getByText("The Williams Family")).toBeVisible({ timeout: 10_000 });

    const firstFamilyRow = page.getByRole("row").filter({ hasText: "The Williams Family" });
    const idCell = firstFamilyRow.getByRole("cell").first();
    const idText = (await idCell.textContent())?.trim();
    expect(idText).toMatch(/^\d+$/);
    expect(parseInt(idText!, 10)).toBeLessThan(100);

    await context.close();
  });
});

// ── Fully-approve test (creates its own family via UI) ─────────────────────

const FULLY_APPROVE_FAMILY = `E2E FA ${Math.random().toString(36).slice(2, 8)}`;

test.describe("Admin Family Lifecycle — fully approve", () => {
  test("admin fully approves a family at lock=family via UI", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    /* Create the family via UI */
    await page.goto("/admin/families");
    await expect(page.getByRole("heading", { name: "Manage Families" })).toBeVisible();

    await page.getByRole("button", { name: "+ Add Family" }).click();
    await expect(page.getByLabel("Referrer")).toBeVisible({ timeout: 10_000 });
    await page.getByLabel("Referrer").selectOption({ index: 1 });
    await page.getByLabel("Family Name", { exact: true }).fill(FULLY_APPROVE_FAMILY);
    await page.getByLabel("Contact Name", { exact: true }).fill("FA Contact");
    await page.getByLabel("Family Wish", { exact: true }).fill("FA wish");
    await page.getByLabel("Address", { exact: true }).fill("none");
    await page.getByLabel("Phone Number", { exact: true }).fill("5551234567");
    await page.getByRole("button", { name: "Create" }).click();

    /* Find our test family row (may need to paginate) */
    const row = (await findRowInTable(page, FULLY_APPROVE_FAMILY))!;
    expect(row).not.toBeNull();

    /* Verify "Fully Approve" is in the kebab menu */
    await row.getByRole("button", { name: "More actions" }).click();
    await expect(row.getByRole("menuitem", { name: "Fully Approve" })).toBeVisible();
    await page.keyboard.press("Escape");

    /* Click "Fully Approve" */
    await clickAction(row, "Fully Approve");

    /* Confirm in the dialog */
    await expect(page.getByText("Fully approve family")).toBeVisible();
    await expect(page.getByText("skipping referrer review")).toBeVisible();
    await page.getByRole("button", { name: "Yes, fully approve" }).click();

    /* Verify success toast */
    await expect(page.getByText("Family fully approved and visible to donors")).toBeVisible({
      timeout: 10_000,
    });

    /* Verify row turns green (bg-emerald-50 class) */
    const approvedRow = (await findRowInTable(page, FULLY_APPROVE_FAMILY))!;
    await expect(approvedRow as Locator).toHaveAttribute("class", /bg-emerald-50/);

    /* Verify "Fully Approve" is no longer in the menu (already at admin lock) */
    await approvedRow.getByRole("button", { name: "More actions" }).click();
    await expect(approvedRow.getByRole("menuitem", { name: "Fully Approve" })).not.toBeVisible();
    /* "Reset Lock" should appear instead (lock !== family) */
    await expect(approvedRow.getByRole("menuitem", { name: "Reset Lock" })).toBeVisible();
    await page.keyboard.press("Escape");

    await context.close();
  });
});
