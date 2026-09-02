/**
 * Role Downstream — purchaser assigned gifts, delivery packing slips, public wish list.
 *
 * Self-contained: creates full data chain (referrer → family → person → wishes),
 * assigns data to purchaser/delivery users, and approves for public visibility.
 *
 * Intentionally a plain describe, not .serial: no test depends on a mutation
 * made by an earlier test, so the file can run fully in parallel. Under
 * fullyParallel each worker re-imports this file (fresh SUFFIX/testData) and
 * runs beforeAll/afterAll for its own data chain; tests within a worker run
 * in file order. If a test ever depends on an earlier test's mutation,
 * switch to test.describe.serial.
 */
import { test, expect, request } from "@playwright/test";
import {
  createReferrerWithUser,
  createFamilyViaApi,
  createPersonViaApi,
  approveWishChain,
  batchAssignWishesViaApi,
  assignFamiliesToDeliveryViaApi,
  listWishesViaApi,
  deleteReferrerViaApi,
  deleteFamilyViaApi,
  deleteUserViaApi,
  loginViaApi,
} from "../helpers/api";
import { getAdminEmail, getAdminPassword } from "../helpers/env";

const SUFFIX = Math.random().toString(36).slice(2, 6);
const TEST_REFERRER_NAME = `E2E Downstream Ref ${SUFFIX}`;
const TEST_REFERRER_EMAIL = `e2e-ds-ref-${SUFFIX}@example.com`;
const TEST_FAMILY_NAME = `E2E Downstream Family ${SUFFIX}`;
const TEST_FAMILY2_NAME = `E2E Downstream Early Family ${SUFFIX}`;
const TEST_PERSON_NAME = `Child ${SUFFIX}`;
const TEST_PERSON2_NAME = `Early Child ${SUFFIX}`;
const TEST_PURCHASER_EMAIL = `e2e-purchaser-${SUFFIX}@example.com`;
const TEST_DELIVERY_EMAIL = `e2e-delivery-${SUFFIX}@example.com`;
const PASSWORD = "Password123!";

/* Track IDs for cleanup */
const testData: {
  referrerId?: number;
  familyId?: number;
  secondFamilyId?: number;
  purchaserUserId?: number;
  deliveryUserId?: number;
} = {};

/**
 * Set up the full data chain: referrer → family → person → wishes.
 * Also creates purchaser and delivery users and assigns data.
 */
async function setupTestData(apiContext: Awaited<ReturnType<typeof request.newContext>>) {
  // Create referrer with user
  const referrer = await createReferrerWithUser(apiContext, {
    name: TEST_REFERRER_NAME,
    familyLimit: 5,
    phoneNumber: "555-000-9999",
    email: TEST_REFERRER_EMAIL,
    password: PASSWORD,
  });
  testData.referrerId = referrer.referrerId;

  // Create family under the referrer
  const family = await createFamilyViaApi(apiContext, referrer.referrerId, {
    familyName: TEST_FAMILY_NAME,
    familyWish: "A warm blanket for everyone",
    contactName: "Test Contact",
    phoneNumber: "555-111-2222",
    address: "none",
  });
  testData.familyId = family.familyId;

  // Create a person with wishes
  await createPersonViaApi(apiContext, family.familyId, {
    givenName: TEST_PERSON_NAME,
    role: "son",
    age: 7,
    wish: "Warm winter coat",
    size: "7",
    funWish: "LEGO set",
  });

  // Create purchaser user
  const purchaserResp = await apiContext.post("/api/admin/users", {
    data: {
      email: TEST_PURCHASER_EMAIL,
      password: PASSWORD,
      role: "purchaser",
      display_name: `Purchaser ${SUFFIX}`,
    },
  });
  if (purchaserResp.ok()) {
    const purchaserData = (await purchaserResp.json()) as { id: number };
    testData.purchaserUserId = purchaserData.id;
  }

  // Create delivery user
  const deliveryResp = await apiContext.post("/api/admin/users", {
    data: {
      email: TEST_DELIVERY_EMAIL,
      password: PASSWORD,
      role: "delivery",
      display_name: `Delivery ${SUFFIX}`,
    },
  });
  if (deliveryResp.ok()) {
    const deliveryData = (await deliveryResp.json()) as { id: number };
    testData.deliveryUserId = deliveryData.id;
  }

  // Assign the person's wishes to purchaser (family wishes are separate rows now;
  // scope to our family to avoid parallel-worker race conditions)
  const wishes = await listWishesViaApi(apiContext, { purchased: "false", familyId: family.familyId });
  const wishIds = wishes.wishes.filter((w) => w.type !== "family").slice(0, 2).map((w) => w.id);

  if (!testData.purchaserUserId) {
    throw new Error("Purchaser user was not created — cannot assign wishes");
  }
  if (wishIds.length === 0) {
    throw new Error("No unpurchased wishes found to assign — cannot test purchaser flow");
  }
  await batchAssignWishesViaApi(apiContext, wishIds, testData.purchaserUserId);

  // Assign family to delivery person
  if (!testData.deliveryUserId || !testData.familyId) {
    throw new Error(
      `Missing IDs for delivery assignment — deliveryUserId: ${testData.deliveryUserId}, familyId: ${testData.familyId}`,
    );
  }
  await assignFamiliesToDeliveryViaApi(apiContext, [testData.familyId], testData.deliveryUserId);

  // Second family: wishes NOT fully reviewed (wish lock stays at "family",
  // though the family itself is approved — admin-created ones auto-approve)
  // but has a wish assigned to the purchaser — simulates early purchasing
  // before the review chain completes.
  const family2 = await createFamilyViaApi(apiContext, referrer.referrerId, {
    familyName: TEST_FAMILY2_NAME,
    familyWish: "Early family — not yet reviewed",
    contactName: "Early Contact",
    phoneNumber: "555-333-4444",
    address: "123 Early Street",
  });
  testData.secondFamilyId = family2.familyId;

  await createPersonViaApi(apiContext, family2.familyId, {
    givenName: TEST_PERSON2_NAME,
    role: "daughter",
    age: 9,
    wish: "Early practical wish",
    funWish: "Early fun wish",
  });

  const wishes2 = await listWishesViaApi(apiContext, { purchased: "false", familyId: family2.familyId });
  const earlyWishIds = wishes2.wishes.filter((w) => w.type !== "family").slice(0, 1).map((w) => w.id);
  if (earlyWishIds.length === 0) {
    throw new Error("No person wishes found for second family — cannot test early-purchase link gating");
  }
  await batchAssignWishesViaApi(apiContext, earlyWishIds, testData.purchaserUserId);

  // Approve the wish chain so family 1 is publicly visible
  await approveWishChain(apiContext, family.familyId, TEST_REFERRER_EMAIL, PASSWORD);
}

test.describe("Role Downstream", () => {
  test.beforeAll(async ({ request: req }) => {
    const api = await loginViaApi(req);
    await setupTestData(api);
    await api.dispose();
  });

  test.afterAll(async ({ request: req }) => {
    const authed = await loginViaApi(req);
    // Clean up in reverse creation order
    if (testData.secondFamilyId) {
      await deleteFamilyViaApi(authed, testData.secondFamilyId);
    }
    if (testData.familyId) {
      await deleteFamilyViaApi(authed, testData.familyId);
    }
    if (testData.referrerId) {
      await deleteReferrerViaApi(authed, testData.referrerId);
    }
    if (testData.purchaserUserId) {
      await deleteUserViaApi(authed, testData.purchaserUserId);
    }
    if (testData.deliveryUserId) {
      await deleteUserViaApi(authed, testData.deliveryUserId);
    }
    await authed.dispose();
  });

  // ── Purchaser tests ────────────────────────────────────────────────────

  test("purchaser page loads with assigned wishes", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto("/login");
    await page.getByLabel("Email").fill(TEST_PURCHASER_EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    /* Login redirects to /dashboard — navigate to assigned gifts */
    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
    await page.goto("/purchaser/assigned-gifts");
    await expect(page.getByRole("heading", { name: "Assigned Gifts" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });

    await context.close();
  });

  test("purchaser marks wish as purchased", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto("/login");
    await page.getByLabel("Email").fill(TEST_PURCHASER_EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
    await page.goto("/purchaser/assigned-gifts");
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });

    // Filter to unpurchased
    const statusSelect = page.locator("select").filter({ hasText: /All statuses/ });
    await statusSelect.selectOption({ label: "Unpurchased" });
    await expect(page.getByRole("table")).toBeVisible();

    // Click Mark Purchased on the first unpurchased wish (exact — the header
    // batch button's name starts with the same text)
    const markBtn = page.getByRole("button", { name: "Mark Purchased", exact: true });
    if (await markBtn.count() > 0) {
      await markBtn.first().click();

      // Dialog opens
      await expect(page.getByText(/Mark wish for/)).toBeVisible({ timeout: 10_000 });

      // Fill purchased where and submit
      await page.getByLabel("Purchased Where").fill("E2E Test Store");
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: "Mark Purchased" }).click();

      // Success toast appears
      await expect(page.getByText("Wish marked as purchased")).toBeVisible({ timeout: 10_000 });
    }

    await context.close();
  });

  test("purchaser batch marks selected wishes as purchased", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto("/login");
    await page.getByLabel("Email").fill(TEST_PURCHASER_EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
    await page.goto("/purchaser/assigned-gifts");
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });

    // Select the fun wish and the early family's practical wish — distinct
    // from the wish the single-mark test may consume, so the tests stay
    // independent under fullyParallel
    const funRow = page.getByRole("row").filter({ hasText: "LEGO set" });
    const earlyRow = page.getByRole("row").filter({ hasText: "Early practical wish" });
    await expect(funRow).toBeVisible({ timeout: 10_000 });
    await expect(earlyRow).toBeVisible();

    await funRow.getByRole("checkbox").check();
    await earlyRow.getByRole("checkbox").check();

    // Batch mark with a shared location
    await page.getByRole("button", { name: "Mark Purchased (2)" }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10_000 });
    await page.getByLabel("Purchased Where").fill("E2E Batch Store");
    await page.getByRole("dialog").getByRole("button", { name: "Mark Purchased" }).click();

    // Success toast
    await expect(page.getByText("2 wishes marked as purchased")).toBeVisible({ timeout: 10_000 });

    // Status filter follows: both rows now show the purchased checkmark
    const statusSelect = page.getByLabel("Purchased filter");
    await statusSelect.selectOption({ label: "Purchased" });
    await expect(funRow).toContainText("✓", { timeout: 10_000 });
    await expect(earlyRow).toContainText("✓");

    // ...and both are gone under "Unpurchased"
    await statusSelect.selectOption({ label: "Unpurchased" });
    await expect(funRow).toBeHidden({ timeout: 10_000 });
    await expect(earlyRow).toBeHidden();

    await context.close();
  });

  test("purchaser sees family link to wishlist only when admin-locked", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto("/login");
    await page.getByLabel("Email").fill(TEST_PURCHASER_EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
    await page.goto("/purchaser/assigned-gifts");
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });

    // Rows are identified by exact person-name cell (family display_id is dynamic)
    const approvedRows = page
      .getByRole("row")
      .filter({ has: page.getByRole("cell", { name: new RegExp(`^${TEST_PERSON_NAME}$`) }) });
    await expect(approvedRows.first()).toBeVisible({ timeout: 10_000 });
    // Every row's family cell shows the display_id and links to the public wishlist page
    const approvedLinks = approvedRows.getByRole("link");
    await expect(approvedLinks).toHaveCount(await approvedRows.count());
    await expect(approvedLinks.first()).toHaveText(/^\d+(?:-\d+)*$/);

    // Not admin-locked — display_id is plain text, no link (public page would 403: not fully approved)
    const earlyRows = page
      .getByRole("row")
      .filter({ has: page.getByRole("cell", { name: new RegExp(`^${TEST_PERSON2_NAME}$`) }) });
    await expect(earlyRows.first()).toBeVisible({ timeout: 10_000 });
    await expect(earlyRows.getByRole("link")).toHaveCount(0);
    // Exactly one cell per row carries the display_id
    await expect(earlyRows.first().getByRole("cell").filter({ hasText: /^\d+(?:-\d+)*$/ })).toHaveCount(1);

    await context.close();
  });

  // ── Delivery tests ─────────────────────────────────────────────────────

  test("delivery page loads with assigned families", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto("/login");
    await page.getByLabel("Email").fill(TEST_DELIVERY_EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    /* Login redirects to /dashboard — navigate to delivery dashboard */
    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
    await page.goto("/delivery");
    await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Assigned Families" })).toBeVisible();

    await context.close();
  });

  test("delivery packing slips show people and wishes", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto("/login");
    await page.getByLabel("Email").fill(TEST_DELIVERY_EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
    await page.goto("/delivery/packing-slips");
    await expect(page.locator(".packing-slip-card").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("columnheader", { name: "Name" }).first()).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Age" }).first()).toBeVisible();

    await context.close();
  });

  test("delivery packing slips do not expose family PII", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto("/login");
    await page.getByLabel("Email").fill(TEST_DELIVERY_EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
    await page.goto("/delivery/packing-slips");
    await expect(page.locator(".packing-slip-card").first()).toBeVisible({ timeout: 10_000 });

    // Packing slips should NOT contain family names (PII fields)
    const cards = page.locator(".packing-slip-card");
    const count = await cards.count();
    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);
      await expect(card).not.toContainText(TEST_FAMILY_NAME);
    }

    await context.close();
  });

  test("delivery has print button on packing slips", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto("/login");
    await page.getByLabel("Email").fill(TEST_DELIVERY_EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
    await page.goto("/delivery/packing-slips");
    await expect(page.getByRole("button", { name: "Print" })).toBeVisible();

    await context.close();
  });

  test("delivery packing slips print multiple families per page", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto("/login");
    await page.getByLabel("Email").fill(TEST_DELIVERY_EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
    await page.goto("/delivery/packing-slips");
    await expect(page.locator(".packing-slip-card").first()).toBeVisible({ timeout: 10_000 });

    // Under print media, cards must not force a page break after each
    // family, and each family's slip stays unsplit (break-inside: avoid).
    await page.emulateMedia({ media: "print" });
    const card = page.locator(".packing-slip-card").first();
    expect(await card.evaluate((el) => getComputedStyle(el).breakInside)).toBe("avoid");
    expect(await card.evaluate((el) => getComputedStyle(el).breakAfter)).not.toBe("page");

    await context.close();
  });

  // ── Public wish list tests ─────────────────────────────────────────────

  test("guest can view a family wish list", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`/families/${testData.familyId}/wish-list`);

    /* Page heading shows the display ID (numeric, e.g. "1" or "2-3") */
    await expect(
      page.getByRole("heading", { name: /^\d+(?:-\d+)*$/ }),
    ).toBeVisible({ timeout: 10_000 });

    /* Family wish card is visible */
    await expect(page.getByText("A warm blanket for everyone")).toBeVisible();

    /* People table shows the child and their wishes */
    await expect(page.getByRole("table")).toContainText(TEST_PERSON_NAME);
    await expect(page.getByRole("table")).toContainText("Warm winter coat");
    await expect(page.getByRole("table")).toContainText("LEGO set");

    await context.close();
  });

  test("guest sees 404 detail for non-existent family", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto("/families/99999/wish-list");

    await expect(page.getByRole("heading", { name: "Unable to Load Wish List" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("Family not found")).toBeVisible();

    await context.close();
  });

  test("guest sees 403 for non-admin-locked family wish list", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    if (!testData.secondFamilyId) {
      throw new Error("Missing second family ID — cannot verify non-admin-locked 403");
    }

    await page.goto(`/families/${testData.secondFamilyId}/wish-list`);

    await expect(page.getByRole("heading", { name: "Unable to Load Wish List" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("This family hasn't been fully approved yet.")).toBeVisible();

    await context.close();
  });
});
