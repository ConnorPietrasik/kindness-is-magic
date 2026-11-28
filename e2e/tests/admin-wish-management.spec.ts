/**
 * Admin Wish Management — view wishes, filter, search, edit, mark/unmark
 * purchased, batch assign.
 *
 * Read-only tests (list, filter, search) use CSV-seeded wishes.
 * Mutation tests (edit, mark/unmark purchased, batch assign, unassign) use
 * an isolated family so parallel workers don't step on each other's wishes.
 * Spreadsheet-view tests (per-column search, date ranges, header sort) use a
 * third isolated family whose purchase date is set via the API.
 *
 * Family scoping goes through the Family column's search input (family names
 * carry the unique run suffix); there is no family dropdown on this page.
 */
import { test, expect } from "@playwright/test";
import {
  createIsolatedFamilyScenario,
  deleteReferrerViaApi,
  deleteFamilyViaApi,
  deleteUserViaApi,
  loginViaApi,
  listWishesViaApi,
} from "../helpers/api";

// ── Read-only tests (CSV-seeded data — safe for parallel) ───────────────────

test.describe("Admin Wish Management — read-only", () => {
  test("page loads with seeded wishes", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/admin/wishes");
    await expect(page.getByRole("heading", { name: "Manage Wishes" })).toBeVisible();
    // Wishes are grouped by family (family wish first in each family block) —
    // a seeded family name should appear
    await expect(page.getByRole("table")).toContainText("The Williams Family", { timeout: 10_000 });
    // The ID column (wish display_id) is visible by default
    await expect(page.getByRole("columnheader", { name: "ID", exact: true })).toBeVisible();

    await context.close();
  });

  test("filter by family narrows the list", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/admin/wishes");
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });

    // Type the family name into the Family column's search input
    await page.getByLabel("Filter by Family").fill("The Williams Family");

    // Wait for the table to narrow — only Williams wishes should appear
    await expect(page.getByRole("table")).not.toContainText("The Rodriguez Family", { timeout: 10_000 });
    await expect(page.getByRole("table")).toContainText("The Williams Family");

    await context.close();
  });

  test("filter by purchased status", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/admin/wishes");
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });

    const statusSelect = page.locator("select").filter({ hasText: /All statuses/ });

    // "Unpurchased" should show wishes
    await statusSelect.selectOption({ label: "Unpurchased" });
    await expect(page.getByRole("table")).toBeVisible();
    const unpurchasedCount = await page.getByRole("row").count();

    // Switch to "Purchased" — count may differ (state from prior runs)
    await statusSelect.selectOption({ label: "Purchased" });
    await page.waitForTimeout(500); // wait for re-render
    const purchasedCount = await page.getByRole("row").count();

    // Unpurchased should have at least as many rows as purchased (seed data has many unpurchased)
    expect(unpurchasedCount).toBeGreaterThanOrEqual(purchasedCount);

    // Reset to "All" for subsequent tests
    await statusSelect.selectOption({ label: "All statuses" });

    await context.close();
  });

  test("search filters by description", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/admin/wishes");
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });

    await page.getByLabel("Search everything").fill("backpack");
    // Wait for table to update
    await expect(page.getByRole("table")).toContainText("backpack", { timeout: 10_000 });

    await context.close();
  });

  test("global search matches a deep field (family address)", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/admin/wishes");
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });

    // The Williams family's address is unique to that family — only the
    // everything-search (which covers family_address) can match it
    await page.getByLabel("Search everything").fill("842 Elm Street Apt 3");
    await expect(page.getByRole("table")).toContainText("The Williams Family", { timeout: 10_000 });
    await expect(page.getByRole("table")).not.toContainText("The Rodriguez Family");

    await context.close();
  });
});

// ── Mutation tests (isolated family — no parallel collisions) ───────────────

const MUTATION_SUFFIX = Math.random().toString(36).slice(2, 8);
const MUTATION_PERSON_NAME = `WishMut ${MUTATION_SUFFIX}`;
const MUTATION_WISH_DESC = `Edited e2e wish ${MUTATION_SUFFIX}`;

const mutationData: {
  referrerId?: number;
  referrerUserId?: number;
  familyId?: number;
  purchaserUserId?: number;
} = {};

// Description of the fun wish created in beforeAll — never modified by any
// test, so it is a stable anchor for locating the wish row.
const FUN_WISH_DESC = "Original fun wish";

test.describe.serial("Admin Wish Management — mutations", () => {
  test.beforeAll(async ({ request: req }) => {
    const api = await loginViaApi(req);
    const scenario = await createIsolatedFamilyScenario(api, MUTATION_SUFFIX, {
      personName: MUTATION_PERSON_NAME,
      personWish: "Original wish description",
      personFunWish: "Original fun wish",
    });

    mutationData.referrerId = scenario.referrerId;
    mutationData.referrerUserId = scenario.referrerUserId;
    mutationData.familyId = scenario.familyId;

    // Create a purchaser user for batch-assign test
    const purchaserResp = await api.post("/api/admin/users", {
      data: {
        email: `e2e-purchaser-wish-${MUTATION_SUFFIX}@example.com`,
        password: "Password123!",
        role: "purchaser",
        display_name: `Purchaser ${MUTATION_SUFFIX}`,
      },
    });
    if (purchaserResp.ok()) {
      const purchaserData = (await purchaserResp.json()) as { id: number };
      mutationData.purchaserUserId = purchaserData.id;
    }

    await api.dispose();
  });

  test.afterAll(async ({ request: req }) => {
    const authed = await loginViaApi(req);
    if (mutationData.purchaserUserId) {
      await deleteUserViaApi(authed, mutationData.purchaserUserId);
    }
    if (mutationData.familyId) {
      await deleteFamilyViaApi(authed, mutationData.familyId);
    }
    if (mutationData.referrerUserId) {
      await deleteUserViaApi(authed, mutationData.referrerUserId);
    }
    if (mutationData.referrerId) {
      await deleteReferrerViaApi(authed, mutationData.referrerId);
    }
    await authed.dispose();
  });

  test("ID column shows the created wish's display_id", async ({ browser }) => {
    if (!mutationData.familyId || !mutationData.referrerId) test.skip();

    // Expected display_id is derived from the scenario's structure, not from
    // the API: the isolated referrer has exactly one (verified) family, and
    // that family has exactly one person — positions are 1/1, so the fun
    // wish's flat display id is `{referrerId}-1-1B` (fun → "B"). The UI is
    // the only thing under test.
    const expectedDisplayId = `${mutationData.referrerId}-1-1B`;

    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/admin/wishes");
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });

    // Filter to our isolated family (family names carry the unique suffix)
    await page.getByLabel("Filter by Family").fill(MUTATION_SUFFIX);

    // The fun wish row's ID cell (2nd cell; 1st is the row checkbox) shows the expected display_id
    const funRow = page.getByRole("row").filter({ hasText: FUN_WISH_DESC });
    await expect(funRow.getByRole("cell").nth(1)).toHaveText(expectedDisplayId, { timeout: 10_000 });

    await context.close();
  });

  test("edit wish description and save", async ({ browser }) => {
    if (!mutationData.familyId) test.skip();

    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/admin/wishes");
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });

    // Filter to our isolated family so we don't accidentally edit another test's wish
    await page.getByLabel("Filter by Family").fill(MUTATION_SUFFIX);

    // Wait for table to show our person's wishes
    await expect(page.getByRole("table")).toContainText(MUTATION_PERSON_NAME, { timeout: 10_000 });

    // Click Edit on our person's row (the family wish is a separate row now)
    const ourRow = page.getByRole("row").filter({ hasText: MUTATION_PERSON_NAME }).first();
    await ourRow.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByText("Edit Wish")).toBeVisible();

    // Clear and type new description (exact — the header's "Filter by
    // Description" input also matches the substring)
    const descInput = page.getByLabel("Description", { exact: true });
    await descInput.clear();
    await descInput.fill(MUTATION_WISH_DESC);

    // Save
    await page.getByRole("button", { name: "Update" }).click();

    // Verify the new description appears in the table
    await expect(page.getByRole("table")).toContainText(MUTATION_WISH_DESC, { timeout: 10_000 });

    await context.close();
  });

  test("mark wish as purchased", async ({ browser }) => {
    if (!mutationData.familyId) test.skip();

    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/admin/wishes");
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });

    // Filter to our isolated family
    await page.getByLabel("Filter by Family").fill(MUTATION_SUFFIX);

    // Filter to unpurchased wishes
    const statusSelect = page.locator("select").filter({ hasText: /All statuses/ });
    await statusSelect.selectOption({ label: "Unpurchased" });
    await expect(page.getByRole("table")).toBeVisible();

    // Wait for our person's wish to appear
    await expect(page.getByRole("table")).toContainText(MUTATION_PERSON_NAME, { timeout: 10_000 });

    // Find the Mark purchased button on our person's row
    const ourRow = page.getByRole("row").filter({ hasText: MUTATION_PERSON_NAME }).first();
    const markBtn = ourRow.getByRole("button", { name: "Mark purchased" });

    if (await markBtn.count() > 0) {
      await markBtn.click();

      // Dialog opens
      await expect(page.getByText(/Mark wish for/)).toBeVisible({ timeout: 10_000 });

      // Fill purchased where and submit (scoped to the dialog — the header's
      // "Filter by Purchased Where" input also matches the substring)
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Purchased Where").fill("E2E Test Store");
      await dialog.getByRole("button", { name: "Mark purchased" }).click();

      // Success toast appears
      await expect(page.getByText("Wish marked as purchased")).toBeVisible({ timeout: 10_000 });
    }

    await context.close();
  });

  test("unmark wish as purchased", async ({ browser }) => {
    if (!mutationData.familyId) test.skip();

    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/admin/wishes");
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });

    // Filter to our isolated family
    await page.getByLabel("Filter by Family").fill(MUTATION_SUFFIX);

    const ourRow = page.getByRole("row").filter({ hasText: MUTATION_PERSON_NAME }).first();
    await expect(ourRow).toBeVisible({ timeout: 10_000 });

    // The mark test (earlier in this serial group) purchased our row, so
    // the undo has a purchased row
    const unmarkBtn = ourRow.getByRole("button", { name: "Unmark purchased" });
    await expect(unmarkBtn).toBeVisible({ timeout: 10_000 });

    // Click the undo and confirm in the confirmation dialog
    await unmarkBtn.click();
    await expect(page.getByRole("alertdialog")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("alertdialog").getByRole("button", { name: "Yes, unmark" }).click();

    // Success toast; the row goes back to the mark button (admins can re-mark)
    await expect(page.getByText("Wish unmarked as purchased")).toBeVisible({ timeout: 10_000 });
    await expect(ourRow.getByRole("button", { name: "Mark purchased" })).toBeVisible({ timeout: 10_000 });

    await context.close();
  });

  test("batch assign wishes to a user", async ({ browser }) => {
    if (!mutationData.familyId || !mutationData.purchaserUserId) test.skip();

    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/admin/wishes");
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });

    // Filter to our isolated family
    await page.getByLabel("Filter by Family").fill(MUTATION_SUFFIX);

    // Wait for our person's wishes to appear
    await expect(page.getByRole("table")).toContainText(MUTATION_PERSON_NAME, { timeout: 10_000 });

    // Select the first wish row checkbox (not the header "select all")
    // Our filtered table should only show our family's wishes
    const firstRowCheckbox = page.getByRole("row").nth(1).getByRole("checkbox");
    await firstRowCheckbox.click();

    // Batch assign button should show count
    await expect(page.getByRole("button", { name: "Batch assign (1)" })).toBeVisible();

    // Open batch assign dialog
    await page.getByRole("button", { name: "Batch assign (1)" }).click();
    // Dialog header contains "1 wish" inside <strong>
    await expect(page.getByText("1 wish")).toBeVisible({ timeout: 10_000 });

    // Select the test purchaser from the dropdown by its unique display
    // name — index 1 is the "Unassigned" sentinel, not a user
    await page
      .locator("label", { hasText: "Assign to" })
      .locator("..")
      .locator("select")
      .selectOption({ label: `Purchaser ${MUTATION_SUFFIX}` });

    // Submit — use exact match to avoid matching "Batch assign"
    await page.getByRole("button", { name: "Assign", exact: true }).click();

    // Success toast — exact match, so the unassign path's toast
    // ("1 wish unassigned") can never satisfy it
    await expect(page.getByText("1 wish assigned", { exact: true })).toBeVisible({ timeout: 10_000 });

    await context.close();
  });

  test("unassign a wish from the row menu", async ({ browser }) => {
    if (!mutationData.familyId) test.skip();

    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/admin/wishes");
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });

    // Filter to our isolated family and wait for the debounced filter to
    // apply — a positional row locator (nth(1)) is always visible on the
    // unfiltered table, so visibility alone would click the wrong row
    await page.getByLabel("Filter by Family").fill(MUTATION_SUFFIX);
    await expect(page.getByRole("row")).toHaveCount(4, { timeout: 10_000 });

    // The batch-assign test (earlier in this serial group) assigned the
    // first data row — the family wish, which leads each family block in
    // the grouped default order — to the test purchaser
    const ourRow = page.getByRole("row").nth(1);

    // The quick unassign lives in the row's kebab menu
    await ourRow.getByRole("button", { name: "More actions" }).click();
    await ourRow.getByRole("menuitem", { name: "Unassign" }).click();

    // Success toast; the menu item is gone once the row is unassigned
    await expect(page.getByText("1 wish unassigned")).toBeVisible({ timeout: 10_000 });
    await ourRow.getByRole("button", { name: "More actions" }).click();
    await expect(ourRow.getByRole("menuitem", { name: "Unassign" })).toHaveCount(0);

    await context.close();
  });
});

// ── Spreadsheet view (per-column search, date ranges, header sort) ──────────
//
// Own isolated family, separate from the mutation scenario above: the
// purchase date is controlled via the API so the date-range test can filter
// on a known day. created_at is not API-settable, so purchased_at is used.

const SHEET_SUFFIX = Math.random().toString(36).slice(2, 8);
const SHEET_WISH_DESC = `E2E sheet wish ${SHEET_SUFFIX}`;
const SHEET_FUN_DESC = `E2E sheet fun ${SHEET_SUFFIX}`;

const sheetData: {
  referrerId?: number;
  referrerUserId?: number;
  familyId?: number;
  /** ISO datetime the practical wish was marked purchased at (midday UTC). */
  purchasedAt?: string;
} = {};

/** "YYYY-MM-DD" offset by N days (UTC). */
function plusDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

test.describe.serial("Admin Wish Management — spreadsheet view", () => {
  test.beforeAll(async ({ request: req }) => {
    const api = await loginViaApi(req);
    const scenario = await createIsolatedFamilyScenario(api, SHEET_SUFFIX, {
      personWish: SHEET_WISH_DESC,
      personFunWish: SHEET_FUN_DESC,
    });

    sheetData.referrerId = scenario.referrerId;
    sheetData.referrerUserId = scenario.referrerUserId;
    sheetData.familyId = scenario.familyId;

    // Mark the practical wish purchased at midday UTC yesterday — a known
    // day the date-range test can set exclusive day boundaries around.
    const wishes = await listWishesViaApi(api, { familyId: scenario.familyId });
    const practical = wishes.wishes.find((w) => w.description === SHEET_WISH_DESC);
    if (practical) {
      const purchasedAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
      purchasedAt.setUTCHours(12, 0, 0, 0);
      const resp = await api.post(`/api/admin/wishes/${practical.id}/mark-purchased`, {
        data: { purchased_at: purchasedAt.toISOString() },
      });
      if (!resp.ok()) {
        const body = await resp.text();
        throw new Error(`mark-purchased setup failed (${resp.status()}): ${body}`);
      }
      sheetData.purchasedAt = purchasedAt.toISOString();
    }

    await api.dispose();
  });

  test.afterAll(async ({ request: req }) => {
    const authed = await loginViaApi(req);
    if (sheetData.familyId) {
      await deleteFamilyViaApi(authed, sheetData.familyId);
    }
    if (sheetData.referrerUserId) {
      await deleteUserViaApi(authed, sheetData.referrerUserId);
    }
    if (sheetData.referrerId) {
      await deleteReferrerViaApi(authed, sheetData.referrerId);
    }
    await authed.dispose();
  });

  test("per-column search narrows the table", async ({ browser }) => {
    if (!sheetData.familyId) test.skip();

    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/admin/wishes");
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });

    // A unique, API-created value in the Description column's search input
    await page.getByLabel("Filter by Description").fill(SHEET_WISH_DESC);

    // Exactly one data row remains (plus the header row)
    await expect(page.getByRole("row")).toHaveCount(2, { timeout: 10_000 });
    await expect(page.getByRole("table")).toContainText(SHEET_WISH_DESC);

    await context.close();
  });

  test("two column searches at once AND", async ({ browser }) => {
    if (!sheetData.familyId) test.skip();

    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/admin/wishes");
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });

    // Family matches all three of our wishes (family wish + practical + fun)
    await page.getByLabel("Filter by Family").fill(SHEET_SUFFIX);
    await expect(page.getByRole("row")).toHaveCount(4, { timeout: 10_000 });

    // The Description filter narrows to the one wish it matches — the
    // filters AND together
    await page.getByLabel("Filter by Description").fill(SHEET_WISH_DESC);
    await expect(page.getByRole("row")).toHaveCount(2, { timeout: 10_000 });

    // A third filter matching nothing removes the last row (an OR would keep it)
    await page.getByLabel("Filter by Size").fill(`no-match-${SHEET_SUFFIX}`);
    await expect(page.getByText("No wishes found.")).toBeVisible({ timeout: 10_000 });

    await context.close();
  });

  test("date range (from/to) narrows the table", async ({ browser }) => {
    const purchasedAtIso = sheetData.purchasedAt;
    if (!purchasedAtIso) {
      test.skip();
      return;
    }

    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    const purchasedDay = purchasedAtIso.slice(0, 10);

    await page.goto("/admin/wishes");
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });

    await page.getByLabel("Filter by Family").fill(SHEET_SUFFIX);
    await expect(page.getByRole("row")).toHaveCount(4, { timeout: 10_000 });

    // The purchased_at day, inclusive on both ends: the purchased wish stays,
    // the never-purchased fun wish drops out
    await page.getByLabel("Purchased from").fill(purchasedDay);
    await page.getByLabel("Purchased to").fill(purchasedDay);
    await expect(page.getByRole("row")).toHaveCount(2, { timeout: 10_000 });
    await expect(page.getByRole("table")).not.toContainText(SHEET_FUN_DESC);

    // A one-day window starting the day after the purchase: nothing in range
    const nextDay = plusDays(purchasedDay, 1);
    await page.getByLabel("Purchased from").fill(nextDay);
    await page.getByLabel("Purchased to").fill(nextDay);
    await expect(page.getByText("No wishes found.")).toBeVisible({ timeout: 10_000 });

    await context.close();
  });

  test("header click sorts rows, cycling asc → desc → clear", async ({ browser }) => {
    if (!sheetData.familyId) test.skip();

    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/admin/wishes");
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });

    await page.getByLabel("Filter by Family").fill(SHEET_SUFFIX);
    await expect(page.getByRole("row")).toHaveCount(4, { timeout: 10_000 });

    const sortBtn = page.getByRole("button", { name: "Sort by Description" });
    const yOf = (text: string) =>
      page
        .getByRole("row")
        .filter({ hasText: text })
        .first()
        .boundingBox()
        .then((box) => box!.y);

    // Ascending — "E2E sheet fun …" sorts before "E2E sheet wish …"
    await sortBtn.click();
    await expect(sortBtn).toContainText("↑");
    await expect.poll(async () => (await yOf(SHEET_FUN_DESC)) < (await yOf(SHEET_WISH_DESC))).toBe(true);

    // Descending reverses the two rows
    await sortBtn.click();
    await expect(sortBtn).toContainText("↓");
    await expect.poll(async () => (await yOf(SHEET_WISH_DESC)) < (await yOf(SHEET_FUN_DESC))).toBe(true);

    // Third click clears the sort — arrow goes away, grouped default returns
    await sortBtn.click();
    await expect(sortBtn).not.toContainText(/↑|↓/);

    await context.close();
  });
});
