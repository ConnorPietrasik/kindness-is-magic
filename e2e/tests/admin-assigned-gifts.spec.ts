/**
 * Admin Assigned Gifts — dashboard tile, admin-scoped wish list, mark
 * purchased (single + batch).
 *
 * beforeAll creates an isolated family scenario with three person wishes and
 * assigns them all to the seeded admin user (via API). The single-mark test
 * uses the practical wish; the batch test uses the fun wish + the second
 * person's wish, so the two never touch the same row. The UI is the path
 * under test: dashboard tile → scoped list → mark purchased (with a custom
 * purchase date) → purchased filter.
 */
import { test, expect } from "@playwright/test";
import {
  batchAssignWishesViaApi,
  createIsolatedFamilyScenario,
  createPersonViaApi,
  deleteFamilyViaApi,
  deleteReferrerViaApi,
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

// Custom purchase dates for the datetime-local picker (local-time input
// values, as the browser's <input type="datetime-local"> expects)
const SINGLE_MARK_DATE = "2026-02-25T09:30";
const BATCH_MARK_DATE = "2026-03-10T14:45";

// Same locale formatting as the UI's formatDateTime — computed here so the
// assertion matches the rendered title regardless of the host locale.
function formatPurchasedDate(inputValue: string): string {
  return new Date(inputValue).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const state: {
  referrerId?: number;
  familyId?: number;
  adminUserId?: number;
  wishId?: number;
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

    // Assign all of the family's person wishes to the seeded admin
    const wishes = await listWishesViaApi(api, { familyId: scenario.familyId });
    const personWishes = wishes.wishes.filter((w) => w.type !== "family");
    const personWish = personWishes.find((w) => w.description === WISH_DESC);
    if (!personWish) throw new Error("person practical wish not found");
    state.wishId = personWish.id;
    if (personWishes.length < 3) throw new Error("expected three person wishes for the batch test");
    await batchAssignWishesViaApi(api, personWishes.map((w) => w.id), admin.id);

    await api.dispose();
  });

  test.afterAll(async ({ request: req }) => {
    const authed = await loginViaApi(req);
    if (state.familyId) {
      await deleteFamilyViaApi(authed, state.familyId);
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
});
