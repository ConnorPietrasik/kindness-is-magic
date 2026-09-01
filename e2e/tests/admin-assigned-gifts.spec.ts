/**
 * Admin Assigned Gifts — dashboard tile, admin-scoped wish list, mark purchased.
 *
 * beforeAll creates an isolated family scenario and assigns one of its wishes
 * to the seeded admin user (via API). The UI is the path under test:
 * dashboard tile → scoped list → mark purchased → purchased filter.
 */
import { test, expect } from "@playwright/test";
import {
  batchAssignWishesViaApi,
  createIsolatedFamilyScenario,
  deleteFamilyViaApi,
  deleteReferrerViaApi,
  listUsersViaApi,
  listWishesViaApi,
  loginViaApi,
} from "../helpers/api";
import { getAdminEmail } from "../helpers/env";

const SUFFIX = Math.random().toString(36).slice(2, 6);
const WISH_DESC = `Admin gifts e2e wish ${SUFFIX}`;

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
    });
    state.referrerId = scenario.referrerId;
    state.familyId = scenario.familyId;

    // Assign the person's practical wish (the scenario's only "practical" wish) to the seeded admin
    const wishes = await listWishesViaApi(api, { familyId: scenario.familyId });
    const personWish = wishes.wishes.find((w) => w.type === "practical");
    if (!personWish) throw new Error("person practical wish not found");
    state.wishId = personWish.id;
    await batchAssignWishesViaApi(api, [personWish.id], admin.id);

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

    // Mark it purchased through the dialog
    await ourRow.getByRole("button", { name: "Mark Purchased" }).click();
    await expect(page.getByText(/Mark wish for/)).toBeVisible({ timeout: 10_000 });
    await page.getByLabel("Purchased Where").fill("E2E Admin Store");
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Mark Purchased" }).click();

    // Success toast, then the row shows the purchased checkmark
    await expect(page.getByText("Wish marked as purchased")).toBeVisible({ timeout: 10_000 });
    await expect(ourRow).toContainText("✓", { timeout: 10_000 });

    // Filter: still visible under "Purchased", gone under "Unpurchased"
    const statusSelect = page.getByLabel("Purchased filter");
    await statusSelect.selectOption({ label: "Purchased" });
    await expect(ourRow).toBeVisible();
    await statusSelect.selectOption({ label: "Unpurchased" });
    await expect(ourRow).toBeHidden({ timeout: 10_000 });

    await context.close();
  });
});
