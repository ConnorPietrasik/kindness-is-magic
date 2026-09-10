/**
 * Admin Assigned Gifts — dashboard tile, admin-scoped wish list, mark
 * purchased (single + batch), spreadsheet columns (per-column filters, date
 * range, header sort, drag-reorder with persistence).
 *
 * beforeAll creates an isolated family scenario with three persons' wishes
 * and assigns them all to the seeded admin user (via API). The single-mark
 * test uses the practical wish; the batch test uses the fun wish + the
 * second person's wish, so the two never touch the same row. A third
 * "dated" person's practical wish is marked purchased via the API at a fixed
 * explicit UTC day — the date-range test's known day, independent of the
 * mark tests' local-time picker values. The UI is the path under test:
 * dashboard tile → scoped list → mark purchased (with a custom purchase
 * date) → purchased filter.
 */
import { test, expect } from "@playwright/test";
import {
  batchAssignWishesViaApi,
  createIsolatedFamilyScenario,
  createPersonViaApi,
  deleteFamilyViaApi,
  deleteReferrerViaApi,
  deleteUserViaApi,
  listUsersViaApi,
  listWishesViaApi,
  loginViaApi,
} from "../helpers/api";
import { getAdminEmail } from "../helpers/env";

const SUFFIX = Math.random().toString(36).slice(2, 8);
const WISH_DESC = `Admin gifts e2e wish ${SUFFIX}`;
const FUN_WISH_DESC = `Admin gifts e2e fun wish ${SUFFIX}`;
const BATCH_WISH_DESC = `Admin batch e2e wish ${SUFFIX}`;
const BATCH_FUN_WISH_DESC = `Admin batch e2e fun wish ${SUFFIX}`;
const DATE_WISH_DESC = `Admin date e2e wish ${SUFFIX}`;
const DATE_FUN_WISH_DESC = `Admin date e2e fun wish ${SUFFIX}`;

// Explicit UTC purchase date for the dated person's wish (setup only).
// Fixed — it can't collide with the mark tests' 2026-02/2026-03 local-time
// dates regardless of the host timezone, and never needs local-date math.
const DATE_PURCHASED_AT = "2026-01-15T12:00:00Z";

// Custom purchase dates for the datetime-local picker (local-time input
// values, as the browser's <input type="datetime-local"> expects)
const SINGLE_MARK_DATE = "2026-02-25T09:30";
const BATCH_MARK_DATE = "2026-03-10T14:45";

// Same locale formatting as the UI's formatDateTime — computed here so the
// assertion matches the rendered title regardless of the host locale.
function formatPurchasedDate(inputValue: string): string {
  return new Date(inputValue).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** "YYYY-MM-DD" offset by N days (UTC). */
function plusDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const STORAGE_ADMIN = "storage/admin.json";

/** Draggable column headers of the assigned-gifts table (checkbox/Actions excluded). */
const giftHeaders = (page: import("@playwright/test").Page) => page.locator("thead th[draggable]");

const DEFAULT_GIFT_HEADERS = ["ID", "Person", "Family", "Type", "Description", "Size", "Color", "Purchased"];

/**
 * Column order/visibility preferences persist in the page's localStorage,
 * which a storageState file may carry over (e.g. if storage/admin.json is
 * ever re-captured from a browser with a customized layout). Header-touching
 * tests restore defaults via the gear reset before asserting, instead of
 * trusting a clean slate (same normalization as column-order.spec.ts).
 */
const resetColumnsViaGear = async (page: import("@playwright/test").Page) => {
  await page.getByRole("button", { name: "Toggle columns" }).click();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
};

/**
 * Header cell by its visible text — the th's accessible name is composed
 * from the inner sort button / filter input aria-labels, so
 * getByRole("columnheader", { name: … }) is not a reliable locator here.
 */
const headerCell = (page: import("@playwright/test").Page, label: string) =>
  giftHeaders(page).filter({ hasText: new RegExp(`^${label}$`) });

const state: {
  referrerId?: number;
  familyId?: number;
  adminUserId?: number;
  wishId?: number;
  dateWishId?: number;
  referrerUserId?: number;
} = {};

test.describe.serial("Admin Assigned Gifts", () => {
  test.beforeAll(async ({ request: req }) => {
    const api = await loginViaApi(req);

    // The seeded admin is the account behind storage/admin.json
    const users = await listUsersViaApi(api, "admin");
    const admin = users.users.find((u) => u.email === getAdminEmail());
    if (!admin) throw new Error("seeded admin user not found");
    state.adminUserId = admin.id;

    const scenario = await createIsolatedFamilyScenario(api, SUFFIX, {
      personWish: WISH_DESC,
      personFunWish: FUN_WISH_DESC,
    });
    state.referrerId = scenario.referrerId;
    state.referrerUserId = scenario.referrerUserId;
    state.familyId = scenario.familyId;

    // Second person — the batch test's third row. Children must have one
    // practical AND one fun wish, so both are created (only the practical is
    // targeted by the test).
    await createPersonViaApi(api, scenario.familyId, {
      givenName: `Sibling ${SUFFIX}`,
      role: "daughter",
      age: 9,
      wish: BATCH_WISH_DESC,
      funWish: BATCH_FUN_WISH_DESC,
    });

    // Third person — the date-range test's purchased row. Its purchase date
    // is set via the API below (explicit UTC day), so the test doesn't depend
    // on the mark tests' local-time picker values.
    await createPersonViaApi(api, scenario.familyId, {
      givenName: `Dated ${SUFFIX}`,
      role: "daughter",
      age: 10,
      wish: DATE_WISH_DESC,
      funWish: DATE_FUN_WISH_DESC,
    });

    // Assign all of the family's person wishes to the seeded admin
    const wishes = await listWishesViaApi(api, { familyId: scenario.familyId });
    const personWishes = wishes.wishes.filter((w) => w.type !== "family");
    const personWish = personWishes.find((w) => w.description === WISH_DESC);
    if (!personWish) throw new Error("person practical wish not found");
    state.wishId = personWish.id;
    if (personWishes.length < 6) throw new Error("expected six person wishes for the spreadsheet tests");
    await batchAssignWishesViaApi(api, personWishes.map((w) => w.id), admin.id);

    // Mark the dated person's practical wish purchased at the fixed UTC day
    // the date-range test filters on.
    const dateWish = personWishes.find((w) => w.description === DATE_WISH_DESC);
    if (!dateWish) throw new Error("dated person's practical wish not found");
    state.dateWishId = dateWish.id;
    const dateMarkResp = await api.post(`/api/admin/wishes/${dateWish.id}/mark-purchased`, {
      data: { purchased_at: DATE_PURCHASED_AT },
    });
    if (!dateMarkResp.ok()) {
      const body = await dateMarkResp.text();
      throw new Error(`date wish mark-purchased setup failed (${dateMarkResp.status()}): ${body}`);
    }

    await api.dispose();
  });

  test.afterAll(async ({ request: req }) => {
    const authed = await loginViaApi(req);
    if (state.familyId) {
      await deleteFamilyViaApi(authed, state.familyId);
    }
    if (state.referrerUserId) {
      await deleteUserViaApi(authed, state.referrerUserId);
    }
    if (state.referrerId) {
      await deleteReferrerViaApi(authed, state.referrerId);
    }
    await authed.dispose();
  });

  test("dashboard shows the My Assigned Gifts tile", async ({ browser }) => {
    if (!state.adminUserId) test.skip();

    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/dashboard");
    const tile = page.getByRole("link", { name: /My Assigned Gifts/ });
    await expect(tile).toBeVisible({ timeout: 10_000 });
    await expect(tile).toHaveAttribute("href", "/admin/assigned-gifts");

    await context.close();
  });

  test("tile opens the scoped list, wish marks as purchased, filter follows", async ({ browser }) => {
    if (!state.adminUserId || !state.wishId) test.skip();

    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    // Navigate through the dashboard tile — the UI is the path
    await page.goto("/dashboard");
    await page.getByRole("link", { name: /My Assigned Gifts/ }).click();
    await expect(page).toHaveURL(/\/admin\/assigned-gifts/);
    await expect(page.getByRole("heading", { name: "My Assigned Gifts" })).toBeVisible();

    // The wish assigned to this admin is listed
    const ourRow = page.getByRole("row").filter({ hasText: WISH_DESC });
    await expect(ourRow).toBeVisible({ timeout: 10_000 });

    // Mark it purchased through the dialog — with a custom purchase date
    // (the picker defaults to now; fill overrides it)
    await ourRow.getByRole("button", { name: "Mark Purchased" }).click();
    await expect(page.getByText(/Mark wish for/)).toBeVisible({ timeout: 10_000 });
    const dialog = page.getByRole("dialog");
    // exact — "Purchased" is a substring of "Purchased filter" / "Purchased Where"
    await dialog.getByLabel("Purchased", { exact: true }).fill(SINGLE_MARK_DATE);
    await dialog.getByLabel("Purchased Where").fill("E2E Admin Store");
    await dialog.getByRole("button", { name: "Mark Purchased" }).click();

    // Success toast, then the row shows the purchased checkmark with the
    // chosen date
    await expect(page.getByText("Wish marked as purchased")).toBeVisible({ timeout: 10_000 });
    await expect(ourRow.getByTitle(formatPurchasedDate(SINGLE_MARK_DATE))).toContainText("✓", { timeout: 10_000 });

    // Filter: still visible under "Purchased", gone under "Unpurchased"
    const statusSelect = page.getByLabel("Purchased filter");
    await statusSelect.selectOption({ label: "Purchased" });
    await expect(ourRow).toBeVisible();
    await statusSelect.selectOption({ label: "Unpurchased" });
    await expect(ourRow).toBeHidden({ timeout: 10_000 });

    await context.close();
  });

  test("batch mark purchases multiple wishes with a shared location", async ({ browser }) => {
    if (!state.adminUserId) test.skip();

    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/admin/assigned-gifts");
    await expect(page.getByRole("heading", { name: "My Assigned Gifts" })).toBeVisible({ timeout: 10_000 });

    // The fun wish and the second person's wish — the practical wish is owned
    // by the single-mark test, so the two never touch the same row
    const funRow = page.getByRole("row").filter({ hasText: FUN_WISH_DESC });
    const batchRow = page.getByRole("row").filter({ hasText: BATCH_WISH_DESC });
    await expect(funRow).toBeVisible({ timeout: 10_000 });
    await expect(batchRow).toBeVisible();

    await funRow.getByRole("checkbox").check();
    await batchRow.getByRole("checkbox").check();

    // Batch mark with a shared location and a shared custom date
    await page.getByRole("button", { name: "Mark Purchased (2)" }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10_000 });
    const batchDialog = page.getByRole("dialog");
    // exact — "Purchased" is a substring of "Purchased filter" / "Purchased Where"
    await batchDialog.getByLabel("Purchased", { exact: true }).fill(BATCH_MARK_DATE);
    await batchDialog.getByLabel("Purchased Where").fill("E2E Batch Store");
    await batchDialog.getByRole("button", { name: "Mark Purchased" }).click();

    // Success toast
    await expect(page.getByText("2 wishes marked as purchased")).toBeVisible({ timeout: 10_000 });

    // Status filter follows: both rows now show the purchased checkmark with
    // the shared date
    const statusSelect = page.getByLabel("Purchased filter");
    await statusSelect.selectOption({ label: "Purchased" });
    await expect(funRow.getByTitle(formatPurchasedDate(BATCH_MARK_DATE))).toContainText("✓", { timeout: 10_000 });
    await expect(batchRow.getByTitle(formatPurchasedDate(BATCH_MARK_DATE))).toContainText("✓");

    // ...and both are gone under "Unpurchased"
    await statusSelect.selectOption({ label: "Unpurchased" });
    await expect(funRow).toBeHidden({ timeout: 10_000 });
    await expect(batchRow).toBeHidden();

    await context.close();
  });

  /* ── Spreadsheet columns: per-column filters, date range, sort, reorder ── */

  test("per-column text filter narrows the table", async ({ browser }) => {
    if (!state.adminUserId) test.skip();

    const context = await browser.newContext({ storageState: STORAGE_ADMIN });
    const page = await context.newPage();

    await page.goto("/admin/assigned-gifts");
    await page.waitForLoadState("networkidle");
    await resetColumnsViaGear(page);

    const ourRow = page.getByRole("row").filter({ hasText: WISH_DESC });
    const funRow = page.getByRole("row").filter({ hasText: FUN_WISH_DESC });
    await expect(ourRow).toBeVisible({ timeout: 10_000 });

    // The Description column's filter input narrows to the matching row
    // (1s debounce — the hidden assertion waits through it)
    await page.getByLabel("Filter by Description").fill(WISH_DESC);
    await expect(ourRow).toBeVisible();
    await expect(funRow).toBeHidden({ timeout: 10_000 });

    // The Family column's filter (admin page only) ANDs on top — the family
    // name carries the unique run suffix
    await page.getByLabel("Filter by Family").fill(SUFFIX);
    await expect(ourRow).toBeVisible({ timeout: 10_000 });

    await context.close();
  });

  test("purchased_at date range narrows the table", async ({ browser }) => {
    if (!state.dateWishId) test.skip();

    const context = await browser.newContext({ storageState: STORAGE_ADMIN });
    const page = await context.newPage();

    await page.goto("/admin/assigned-gifts");
    await page.waitForLoadState("networkidle");
    await resetColumnsViaGear(page);

    const dateRow = page.getByRole("row").filter({ hasText: DATE_WISH_DESC });
    const ourRow = page.getByRole("row").filter({ hasText: WISH_DESC });
    const batchRow = page.getByRole("row").filter({ hasText: BATCH_WISH_DESC });
    await expect(dateRow).toBeVisible({ timeout: 10_000 });

    // One-day window on the API-set purchase day: only the dated row stays —
    // the mark tests bought the others on 2026-02/2026-03 local-time days
    const purchasedDay = DATE_PURCHASED_AT.slice(0, 10);
    await page.getByLabel("Purchased from").fill(purchasedDay);
    await page.getByLabel("Purchased to").fill(purchasedDay);
    await expect(dateRow).toBeVisible();
    await expect(ourRow).toBeHidden({ timeout: 10_000 });
    await expect(batchRow).toBeHidden();

    // A one-day window starting the day after the purchase: the dated row
    // drops out (the "to" boundary is the start of the following UTC day)
    const nextDay = plusDays(purchasedDay, 1);
    await page.getByLabel("Purchased from").fill(nextDay);
    await page.getByLabel("Purchased to").fill(nextDay);
    await expect(dateRow).toBeHidden({ timeout: 10_000 });

    await context.close();
  });

  test("header click cycles sort asc → desc → clear", async ({ browser }) => {
    if (!state.adminUserId) test.skip();

    const context = await browser.newContext({ storageState: STORAGE_ADMIN });
    const page = await context.newPage();

    await page.goto("/admin/assigned-gifts");
    await page.waitForLoadState("networkidle");
    await resetColumnsViaGear(page);

    const sortBtn = page.getByRole("button", { name: "Sort by Description" });
    const yOf = (text: string) =>
      page
        .getByRole("row")
        .filter({ hasText: text })
        .first()
        .boundingBox()
        .then((box) => box!.y);

    // "Admin batch e2e wish …" sorts before "Admin gifts e2e wish …"
    await sortBtn.click();
    await expect(sortBtn).toContainText("↑");
    await expect.poll(async () => (await yOf(BATCH_WISH_DESC)) < (await yOf(WISH_DESC))).toBe(true);

    // Descending reverses the two rows
    await sortBtn.click();
    await expect(sortBtn).toContainText("↓");
    await expect.poll(async () => (await yOf(WISH_DESC)) < (await yOf(BATCH_WISH_DESC))).toBe(true);

    // Third click clears the sort — arrow goes away, grouped default returns
    await sortBtn.click();
    await expect(sortBtn).not.toContainText(/↑|↓/);

    await context.close();
  });

  test("drag reorders columns, order persists across reload, reset restores default", async ({ browser }) => {
    if (!state.adminUserId) test.skip();

    const context = await browser.newContext({ storageState: STORAGE_ADMIN });
    const page = await context.newPage();
    await page.goto("/admin/assigned-gifts");
    await page.waitForLoadState("networkidle");

    // Normalize column preferences (see resetColumnsViaGear).
    await resetColumnsViaGear(page);
    await expect(giftHeaders(page)).toHaveText(DEFAULT_GIFT_HEADERS, { timeout: 10_000 });

    // Drag "Color" onto the left edge of "Size" → before it. The drag must
    // start in the cell's padding — starting inside the sort button or
    // filter input is ignored (text selection / editing keeps working).
    await headerCell(page, "Color").dragTo(headerCell(page, "Size"), {
      sourcePosition: { x: 2, y: 2 },
      targetPosition: { x: 4, y: 8 },
    });

    await expect(giftHeaders(page)).toHaveText([
      "ID",
      "Person",
      "Family",
      "Type",
      "Description",
      "Color",
      "Size",
      "Purchased",
    ]);

    // The custom order survives a reload (persisted in localStorage).
    await page.reload({ waitUntil: "networkidle" });
    await expect(giftHeaders(page)).toHaveText([
      "ID",
      "Person",
      "Family",
      "Type",
      "Description",
      "Color",
      "Size",
      "Purchased",
    ]);

    // "Reset order" appears only when the order is customized, and restores.
    const resetOrder = page.getByRole("button", { name: "Reset order" });
    await expect(resetOrder).toBeVisible();
    await resetOrder.click();
    await expect(giftHeaders(page)).toHaveText(DEFAULT_GIFT_HEADERS);
    await expect(resetOrder).not.toBeVisible();

    await context.close();
  });
});
