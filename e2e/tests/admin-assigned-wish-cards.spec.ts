/**
 * Admin Assigned Wish Cards — the admin's own printable sheet (their "My
 * Assigned Gifts"), the same cards as the purchaser's sheet.
 *
 *  - Both entry points open the page: the dashboard "Wish Cards" tile and
 *    the header "Wish Cards" action on the My Assigned Gifts page.
 *  - The sheet holds one card per assigned wish, grouped by family —
 *    family-wish card first in each block, then people — the same cards as
 *    the purchaser's sheet.
 *
 * Self-contained: setup creates a referrer with one family (family wish +
 * child with practical + fun) plus two fresh admin users (admin API),
 * assigns every wish of the family to the first admin, and cleans
 * everything up in afterAll. The seeded admin is never touched.
 */
import { expect, test } from "@playwright/test";
import { loginAs } from "../helpers/auth";
import {
  batchAssignWishesViaApi,
  createFamilyViaApi,
  createPersonViaApi,
  createReferrerWithUser,
  deleteFamilyViaApi,
  deletePersonViaApi,
  deleteReferrerViaApi,
  deleteUserViaApi,
  listWishesViaApi,
  loginViaApi,
} from "../helpers/api";

const SUFFIX = Math.random().toString(36).slice(2, 8);
const PASSWORD = "Password123!";

/* Unique identifying texts — each card is located by its wish description */
const FAMILY_WISH = `E2E awc family wish ${SUFFIX}`;
const PRACTICAL_WISH = `E2E awc coat wish ${SUFFIX}`;
const FUN_WISH = `E2E awc lego wish ${SUFFIX}`;
const CHILD_NAME = `Alice ${SUFFIX}`;
const FAMILY_NAME = `E2E AWC Family ${SUFFIX}`;

/* Created-ID trackers — populated in beforeAll, read in afterAll */
const testData: {
  referrerId?: number;
  referrerUserId?: number;
  familyId?: number;
  personId?: number;
  adminEmail: string;
  adminUserId?: number;
  emptyAdminEmail: string;
  emptyAdminUserId?: number;
} = {
  adminEmail: `e2e-awc-admin-${SUFFIX}@example.com`,
  emptyAdminEmail: `e2e-awc-admin-empty-${SUFFIX}@example.com`,
};

async function createAdminViaApi(request: import("@playwright/test").APIRequestContext, email: string): Promise<number> {
  const resp = await request.post("/api/admin/users", {
    data: { email, password: PASSWORD, role: "admin" },
  });
  if (!resp.ok()) {
    throw new Error(`createAdminViaApi(${email}) failed (${resp.status()}): ${await resp.text()}`);
  }
  const result = (await resp.json()) as { id: number };
  return result.id;
}

test.describe.serial("Admin Assigned Wish Cards", () => {
  test.beforeAll(async ({ request: req }) => {
    const api = await loginViaApi(req);

    const referrer = await createReferrerWithUser(api, {
      name: `E2E AWC Ref ${SUFFIX}`,
      familyLimit: 5,
      phoneNumber: "555-000-9997",
      email: `e2e-awc-ref-${SUFFIX}@example.com`,
      password: PASSWORD,
    });
    testData.referrerId = referrer.referrerId;
    testData.referrerUserId = referrer.userId;

    const fam = await createFamilyViaApi(api, referrer.referrerId, {
      familyName: FAMILY_NAME,
      familyWish: FAMILY_WISH,
      contactName: `AWC Contact ${SUFFIX}`,
      phoneNumber: "555-222-3332",
      address: `1 AWC Lane ${SUFFIX}`,
    });
    testData.familyId = fam.familyId;
    const child = await createPersonViaApi(api, fam.familyId, {
      givenName: CHILD_NAME,
      role: "son",
      age: 7,
      wish: PRACTICAL_WISH,
      size: "7",
      funWish: FUN_WISH,
    });
    testData.personId = child.personId;

    /* Two admins: the assigned one and an empty one (empty-state test) */
    testData.adminUserId = await createAdminViaApi(api, testData.adminEmail);
    testData.emptyAdminUserId = await createAdminViaApi(api, testData.emptyAdminEmail);

    /* Assign every wish of the family to the admin */
    const { wishes } = await listWishesViaApi(api, { familyId: fam.familyId });
    await batchAssignWishesViaApi(api, wishes.map((w) => w.id), testData.adminUserId);

    await api.dispose();
  });

  test.afterAll(async ({ request: req }) => {
    const authed = await loginViaApi(req);
    if (testData.personId) await deletePersonViaApi(authed, testData.personId);
    if (testData.familyId) await deleteFamilyViaApi(authed, testData.familyId);
    if (testData.adminUserId) await deleteUserViaApi(authed, testData.adminUserId);
    if (testData.emptyAdminUserId) await deleteUserViaApi(authed, testData.emptyAdminUserId);
    if (testData.referrerUserId) await deleteUserViaApi(authed, testData.referrerUserId);
    if (testData.referrerId) await deleteReferrerViaApi(authed, testData.referrerId);
    await authed.dispose();
  });

  test("dashboard tile and assigned-gifts header both open the wish cards page", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    /* Admins land on /dashboard after login */
    await loginAs(page, { email: testData.adminEmail, password: PASSWORD });
    await expect(page).toHaveURL("/dashboard");

    /* Dashboard tile entry point — stable key, since the tile's accessible name also
       substring-matches the "Blank Wish Cards" tile's */
    await page.locator('a[data-tile-key="assigned-wish-cards"]').click();
    await expect(page).toHaveURL("/admin/assigned-wish-cards");
    await expect(page.getByRole("heading", { name: "Wish Cards" })).toBeVisible({ timeout: 10_000 });

    /* Assigned-gifts header entry point */
    await page.goto("/admin/assigned-gifts");
    await expect(page.getByRole("heading", { name: "My Assigned Gifts" })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("link", { name: "Wish Cards", exact: true }).click();
    await expect(page).toHaveURL("/admin/assigned-wish-cards");

    await context.close();
  });

  test("renders one card per assigned wish, family card first", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await loginAs(page, { email: testData.adminEmail, password: PASSWORD });
    await page.goto("/admin/assigned-wish-cards");
    const cards = page.locator("article.wish-card");
    await expect(cards).toHaveCount(3, { timeout: 10_000 });

    /* Each assigned wish lands on exactly one card */
    for (const desc of [FAMILY_WISH, PRACTICAL_WISH, FUN_WISH]) {
      await expect(cards.filter({ hasText: desc })).toHaveCount(1);
    }

    /* Flat display IDs: {referrer id}-{family pos}-{person pos}{suffix}.
       Our referrer's family is position 1; the child is person 1. */
    const ref = testData.referrerId;
    const monoIds = await cards.locator("span.font-mono").allTextContents();
    expect(monoIds).toEqual([`#${ref}-1-F`, `#${ref}-1-1A`, `#${ref}-1-1B`]);

    /* Person cards carry role name, age, and wish type */
    const practical = cards.nth(1);
    await expect(practical).toContainText(`Son ${CHILD_NAME}`);
    await expect(practical).toContainText("Age 7 · Practical");
    await expect(practical).toContainText("Size: 7");

    /* Family card: distinct style, no name/age — one, leading the block */
    const familyCards = page.locator("article.wish-card--family");
    await expect(familyCards).toHaveCount(1);
    await expect(familyCards.first()).toContainText(FAMILY_WISH);
    await expect(familyCards.first()).not.toContainText(/Age \d+/);

    /* No family PII on the sheet — the family is identified by display ID only */
    await expect(page.locator("body")).not.toContainText(FAMILY_NAME);

    await context.close();
  });

  test("shows the empty state when nothing is assigned", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await loginAs(page, { email: testData.emptyAdminEmail, password: PASSWORD });
    await page.goto("/admin/assigned-wish-cards");

    await expect(page.getByText("No wishes to print yet.")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("article.wish-card")).toHaveCount(0);

    await context.close();
  });
});
