/**
 * Role Downstream — purchaser assigned gifts, delivery packing slips, public wish list.
 *
 * Self-contained: creates full data chain (referrer → family → person → wishes),
 * assigns data to purchaser/delivery users, and approves for public visibility.
 *
 * Module-level state (IDs, credentials) passes between tests within this file.
 * Tests run in order — setup is done once in beforeAll, cleanup in afterAll.
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
const TEST_PERSON_NAME = `Child ${SUFFIX}`;
const TEST_PURCHASER_EMAIL = `e2e-purchaser-${SUFFIX}@example.com`;
const TEST_DELIVERY_EMAIL = `e2e-delivery-${SUFFIX}@example.com`;
const PASSWORD = "Password123!";

/* Track IDs for cleanup */
const testData: {
  referrerId?: number;
  familyId?: number;
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
  });
  testData.familyId = family.familyId;

  // Create a person with wishes
  await createPersonViaApi(apiContext, family.familyId, {
    givenName: TEST_PERSON_NAME,
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

  // Assign wishes to purchaser (scope to our family to avoid parallel-worker race conditions)
  const wishes = await listWishesViaApi(apiContext, { purchased: "false", familyId: family.familyId });
  const wishIds = wishes.wishes.slice(0, 2).map((w) => w.id);

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

  // Approve the wish chain so family is publicly visible
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

    // Click Mark Purchased on the first unpurchased wish
    const markBtn = page.getByRole("button", { name: "Mark Purchased" });
    if (await markBtn.count() > 0) {
      await markBtn.first().click();

      // Dialog opens
      await expect(page.getByText(/Mark gift for/)).toBeVisible({ timeout: 10_000 });

      // Fill purchased where and submit
      await page.getByLabel("Purchased Where").fill("E2E Test Store");
      const dialog = page.locator(".fixed.inset-0.z-50").first();
      await dialog.getByRole("button", { name: "Mark Purchased" }).click();

      // Success toast appears
      await expect(page.getByText("Wish marked as purchased")).toBeVisible({ timeout: 10_000 });
    }

    await context.close();
  });

  test("purchaser sees family link to wishlist", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto("/login");
    await page.getByLabel("Email").fill(TEST_PURCHASER_EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
    await page.goto("/purchaser/assigned-gifts");
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });

    // Family column should contain a link (to the public wishlist page)
    const familyLink = page.getByRole("cell").filter({ hasText: /Family #/ }).first();
    await expect(familyLink.locator("a")).toBeVisible();

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

  test("guest sees 404 for non-existent family", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto("/families/99999/wish-list");

    await expect(page.getByRole("heading", { name: "Family Not Found" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("This wish list doesn't exist or has been removed.")).toBeVisible();

    await context.close();
  });
});
