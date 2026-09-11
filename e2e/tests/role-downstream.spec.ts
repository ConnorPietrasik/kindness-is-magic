/**
 * Role Downstream — purchaser assigned gifts, delivery packing slips,
 * delivery slips, public wish list.
 *
 * Self-contained: each of the three serial groups below builds its own data
 * chain (referrer → family → person → wishes) with only the extras its tests
 * need (purchaser/delivery users, unapproved second family, chain approval).
 * The groups therefore schedule as separate batches and run in parallel
 * across workers. A single serial block for the whole file instead pinned
 * one worker for the sum of all tests and made this file the suite's
 * wall-time floor.
 *
 * Why describe.serial per group: the tests share the group's module-level
 * state (names + created IDs) and one data chain per setup, so they must run
 * in a single worker where beforeAll/afterAll run exactly once. A plain
 * describe is unsafe: module state is cached per worker process (not
 * re-imported per test), and a worker that receives the group's tests in
 * multiple batches re-runs beforeAll with the SAME import-time values — the
 * second setup reuses the referrer's email and fails with 409 (emails stay
 * reserved even after soft-delete). Each group gets its own random suffix so
 * groups can never collide with each other either.
 * No test depends on an earlier test's mutation, so in-group order is safe.
 */
import { test, expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
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

const PASSWORD = "Password123!";
/* Shared, non-identifying — safe for all three chains to reuse */
const TEST_FAMILY_ADDRESS = "456 Downstream Avenue";
const TEST_FAMILY_PHONE = "555-111-2222";

/* Import-time random suffixes — one per group (see file header) */
const randomSuffix = () => Math.random().toString(36).slice(2, 8);

interface ChainNames {
  referrerName: string;
  referrerEmail: string;
  familyName: string;
  earlyFamilyName: string;
  personName: string;
  earlyPersonName: string;
  purchaserEmail: string;
  purchaserDisplay: string;
  deliveryEmail: string;
  deliveryDisplay: string;
}

function chainNames(suffix: string): ChainNames {
  return {
    referrerName: `E2E Downstream Ref ${suffix}`,
    referrerEmail: `e2e-ds-ref-${suffix}@example.com`,
    familyName: `E2E Downstream Family ${suffix}`,
    earlyFamilyName: `E2E Downstream Early Family ${suffix}`,
    personName: `Child ${suffix}`,
    earlyPersonName: `Early Child ${suffix}`,
    purchaserEmail: `e2e-purchaser-${suffix}@example.com`,
    purchaserDisplay: `Purchaser ${suffix}`,
    deliveryEmail: `e2e-delivery-${suffix}@example.com`,
    deliveryDisplay: `Delivery ${suffix}`,
  };
}

const PURCHASER = chainNames(randomSuffix());
const DELIVERY = chainNames(randomSuffix());
const GUEST = chainNames(randomSuffix());

/* Created-ID trackers, one per group — populated by buildChain, read by teardown */
interface ChainData {
  referrerId?: number;
  referrerUserId?: number;
  familyId?: number;
  secondFamilyId?: number;
  purchaserUserId?: number;
  deliveryUserId?: number;
}

const PURCHASER_DATA: ChainData = {};
const DELIVERY_DATA: ChainData = {};
const GUEST_DATA: ChainData = {};

/**
 * Set up a data chain: referrer → family → person → wishes, plus optional
 * extras. Populates `data` incrementally so teardown can clean up whatever
 * was created even if setup fails partway.
 */
async function buildChain(
  api: APIRequestContext,
  data: ChainData,
  n: ChainNames,
  opts: {
    createPurchaser?: boolean;
    createDelivery?: boolean;
    createEarlyFamily?: boolean;
    approveChain?: boolean;
  },
): Promise<void> {
  // Create referrer with user
  const referrer = await createReferrerWithUser(api, {
    name: n.referrerName,
    familyLimit: 5,
    phoneNumber: "555-000-9999",
    email: n.referrerEmail,
    password: PASSWORD,
  });
  data.referrerId = referrer.referrerId;
  data.referrerUserId = referrer.userId;

  // Create family under the referrer
  const family = await createFamilyViaApi(api, referrer.referrerId, {
    familyName: n.familyName,
    familyWish: "A warm blanket for everyone",
    contactName: "Test Contact",
    phoneNumber: TEST_FAMILY_PHONE,
    address: TEST_FAMILY_ADDRESS,
  });
  data.familyId = family.familyId;

  // Create a person with wishes
  await createPersonViaApi(api, family.familyId, {
    givenName: n.personName,
    role: "son",
    age: 7,
    wish: "Warm winter coat",
    size: "7",
    funWish: "LEGO set",
  });

  if (opts.createPurchaser) {
    // Create purchaser user
    const purchaserResp = await api.post("/api/admin/users", {
      data: {
        email: n.purchaserEmail,
        password: PASSWORD,
        role: "purchaser",
        display_name: n.purchaserDisplay,
      },
    });
    if (!purchaserResp.ok()) {
      throw new Error(`Purchaser user creation failed (${purchaserResp.status()})`);
    }
    const purchaserData = (await purchaserResp.json()) as { id: number };
    const purchaserId = purchaserData.id;
    data.purchaserUserId = purchaserId;

    // Assign the person's wishes to purchaser (family wishes are separate
    // rows now; scope to our family to avoid parallel-worker race conditions)
    const wishes = await listWishesViaApi(api, { purchased: "false", familyId: family.familyId });
    const wishIds = wishes.wishes.filter((w) => w.type !== "family").slice(0, 2).map((w) => w.id);
    if (wishIds.length === 0) {
      throw new Error("No unpurchased wishes found to assign — cannot test purchaser flow");
    }
    await batchAssignWishesViaApi(api, wishIds, purchaserId);
  }

  if (opts.createDelivery) {
    // Create delivery user
    const deliveryResp = await api.post("/api/admin/users", {
      data: {
        email: n.deliveryEmail,
        password: PASSWORD,
        role: "delivery",
        display_name: n.deliveryDisplay,
      },
    });
    if (!deliveryResp.ok()) {
      throw new Error(`Delivery user creation failed (${deliveryResp.status()})`);
    }
    const deliveryData = (await deliveryResp.json()) as { id: number };
    data.deliveryUserId = deliveryData.id;

    // Assign family to delivery person
    await assignFamiliesToDeliveryViaApi(api, [family.familyId], data.deliveryUserId);
  }

  if (opts.createEarlyFamily) {
    // Second family: wishes NOT fully reviewed (wish lock stays "family",
    // though the family itself is approved — admin-created ones auto-approve).
    // With a purchaser, one of its wishes is assigned — simulates early
    // purchasing before the review chain completes.
    const family2 = await createFamilyViaApi(api, referrer.referrerId, {
      familyName: n.earlyFamilyName,
      familyWish: "Early family — not yet reviewed",
      contactName: "Early Contact",
      phoneNumber: "555-333-4444",
      address: "123 Early Street",
    });
    data.secondFamilyId = family2.familyId;

    await createPersonViaApi(api, family2.familyId, {
      givenName: n.earlyPersonName,
      role: "daughter",
      age: 9,
      wish: "Early practical wish",
      funWish: "Early fun wish",
    });

    if (opts.createPurchaser && data.purchaserUserId) {
      // (purchaserUserId is always set when createPurchaser — creation throws otherwise)
      const wishes2 = await listWishesViaApi(api, { purchased: "false", familyId: family2.familyId });
      const earlyWishIds = wishes2.wishes.filter((w) => w.type !== "family").slice(0, 1).map((w) => w.id);
      if (earlyWishIds.length === 0) {
        throw new Error("No person wishes found for second family — cannot test early-purchase link gating");
      }
      await batchAssignWishesViaApi(api, earlyWishIds, data.purchaserUserId);
    }
  }

  if (opts.approveChain) {
    // Approve the wish chain so family 1 is publicly visible
    await approveWishChain(api, family.familyId, n.referrerEmail, PASSWORD);
  }
}

/** Clean up a chain in reverse creation order (best-effort; helpers warn on non-2xx). */
async function teardownChain(api: APIRequestContext, data: ChainData): Promise<void> {
  if (data.secondFamilyId) {
    await deleteFamilyViaApi(api, data.secondFamilyId);
  }
  if (data.familyId) {
    await deleteFamilyViaApi(api, data.familyId);
  }
  if (data.referrerUserId) {
    await deleteUserViaApi(api, data.referrerUserId);
  }
  if (data.referrerId) {
    await deleteReferrerViaApi(api, data.referrerId);
  }
  if (data.purchaserUserId) {
    await deleteUserViaApi(api, data.purchaserUserId);
  }
  if (data.deliveryUserId) {
    await deleteUserViaApi(api, data.deliveryUserId);
  }
}

test.describe.serial("Role Downstream — purchaser assigned gifts", () => {
  test.beforeAll(async ({ request: req }) => {
    const api = await loginViaApi(req);
    await buildChain(api, PURCHASER_DATA, PURCHASER, {
      createPurchaser: true,
      createEarlyFamily: true,
      approveChain: true,
    });
    await api.dispose();
  });

  test.afterAll(async ({ request: req }) => {
    const authed = await loginViaApi(req);
    await teardownChain(authed, PURCHASER_DATA);
    await authed.dispose();
  });

  test("purchaser page loads with assigned wishes", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto("/login");
    await page.getByLabel("Email").fill(PURCHASER.purchaserEmail);
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
    await page.getByLabel("Email").fill(PURCHASER.purchaserEmail);
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
    await page.getByLabel("Email").fill(PURCHASER.purchaserEmail);
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
    await page.getByLabel("Email").fill(PURCHASER.purchaserEmail);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
    await page.goto("/purchaser/assigned-gifts");
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });

    // The Family column is hidden by default (a subset of the wish display_id)
    // — reveal it via the gear to check the cell's link gating.
    await page.getByRole("button", { name: "Toggle columns" }).click();
    await page.getByLabel("Family").check();
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByRole("columnheader", { name: "Family" })).toBeVisible({ timeout: 10_000 });

    // Rows are identified by exact person-name cell (family display_id is dynamic)
    const approvedRows = page
      .getByRole("row")
      .filter({ has: page.getByRole("cell", { name: new RegExp(`^${PURCHASER.personName}$`) }) });
    await expect(approvedRows.first()).toBeVisible({ timeout: 10_000 });
    // Every row's family cell shows the display_id and links to the public wishlist page
    const approvedLinks = approvedRows.getByRole("link");
    await expect(approvedLinks).toHaveCount(await approvedRows.count());
    await expect(approvedLinks.first()).toHaveText(/^\d+(?:-\d+)*$/);

    // Not admin-locked — display_id is plain text, no link (public page would 403: not fully approved)
    const earlyRows = page
      .getByRole("row")
      .filter({ has: page.getByRole("cell", { name: new RegExp(`^${PURCHASER.earlyPersonName}$`) }) });
    await expect(earlyRows.first()).toBeVisible({ timeout: 10_000 });
    await expect(earlyRows.getByRole("link")).toHaveCount(0);
    // Exactly one cell per row carries the display_id
    await expect(earlyRows.first().getByRole("cell").filter({ hasText: /^\d+(?:-\d+)*$/ })).toHaveCount(1);

    await context.close();
  });

  test("purchaser per-column filter narrows the table", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto("/login");
    await page.getByLabel("Email").fill(PURCHASER.purchaserEmail);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
    await page.goto("/purchaser/assigned-gifts");
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });

    const legoRow = page.getByRole("row").filter({ hasText: "LEGO set" });
    const coatRow = page.getByRole("row").filter({ hasText: "Warm winter coat" });
    await expect(legoRow).toBeVisible({ timeout: 10_000 });

    // The Description column's filter input narrows to the matching row
    // (1s debounce — the hidden assertion waits through it)
    await page.getByLabel("Filter by Description").fill("LEGO set");
    await expect(legoRow).toBeVisible();
    await expect(coatRow).toBeHidden({ timeout: 10_000 });

    // No Family filter on the purchaser page (responses carry no family PII)
    expect(await page.getByLabel("Filter by Family").count()).toBe(0);

    await context.close();
  });

  test("purchaser header click cycles sort asc → desc → clear", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto("/login");
    await page.getByLabel("Email").fill(PURCHASER.purchaserEmail);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
    await page.goto("/purchaser/assigned-gifts");
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });

    const sortBtn = page.getByRole("button", { name: "Sort by Description" });
    const yOf = (text: string) =>
      page
        .getByRole("row")
        .filter({ hasText: text })
        .first()
        .boundingBox()
        .then((box) => box!.y);

    // "Early practical wish" sorts before "Warm winter coat"
    await sortBtn.click();
    await expect(sortBtn).toContainText("↑");
    await expect.poll(async () => (await yOf("Early practical wish")) < (await yOf("Warm winter coat"))).toBe(true);

    // Descending reverses the two rows
    await sortBtn.click();
    await expect(sortBtn).toContainText("↓");
    await expect.poll(async () => (await yOf("Warm winter coat")) < (await yOf("Early practical wish"))).toBe(true);

    // Third click clears the sort — arrow goes away, grouped default returns
    await sortBtn.click();
    await expect(sortBtn).not.toContainText(/↑|↓/);

    await context.close();
  });

  test("purchaser drag reorders columns, order persists across reload, reset restores default", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto("/login");
    await page.getByLabel("Email").fill(PURCHASER.purchaserEmail);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
    await page.goto("/purchaser/assigned-gifts");
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });

    // No storageState here — a fresh context starts with empty localStorage,
    // so the default layout holds without gear normalization (the Family
    // column is hidden by default on the purchaser page).
    const headers = page.locator("thead th[draggable]");
    await expect(headers).toHaveText(
      ["ID", "Person", "Type", "Description", "Size", "Color", "Purchased"],
      { timeout: 10_000 }
    );

    // Drag "Color" onto the left edge of "Size" → before it. The drag must
    // start in the cell's padding — starting inside the sort button or
    // filter input is ignored.
    await headers.filter({ hasText: /^Color$/ }).dragTo(headers.filter({ hasText: /^Size$/ }), {
      sourcePosition: { x: 2, y: 2 },
      targetPosition: { x: 4, y: 8 },
    });

    await expect(headers).toHaveText(["ID", "Person", "Type", "Description", "Color", "Size", "Purchased"]);

    // The custom order survives a reload (persisted in localStorage).
    await page.reload({ waitUntil: "networkidle" });
    await expect(headers).toHaveText(["ID", "Person", "Type", "Description", "Color", "Size", "Purchased"]);

    // "Reset order" appears only when the order is customized, and restores.
    const resetOrder = page.getByRole("button", { name: "Reset order" });
    await expect(resetOrder).toBeVisible();
    await resetOrder.click();
    await expect(headers).toHaveText(["ID", "Person", "Type", "Description", "Size", "Color", "Purchased"]);
    await expect(resetOrder).not.toBeVisible();

    await context.close();
  });
});

test.describe.serial("Role Downstream — delivery", () => {
  test.beforeAll(async ({ request: req }) => {
    const api = await loginViaApi(req);
    await buildChain(api, DELIVERY_DATA, DELIVERY, {
      createDelivery: true,
    });
    await api.dispose();
  });

  test.afterAll(async ({ request: req }) => {
    const authed = await loginViaApi(req);
    await teardownChain(authed, DELIVERY_DATA);
    await authed.dispose();
  });

  test("delivery page loads with assigned families", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto("/login");
    await page.getByLabel("Email").fill(DELIVERY.deliveryEmail);
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
    await page.getByLabel("Email").fill(DELIVERY.deliveryEmail);
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
    await page.getByLabel("Email").fill(DELIVERY.deliveryEmail);
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
      await expect(card).not.toContainText(DELIVERY.familyName);
    }

    await context.close();
  });

  test("delivery has print button on packing slips", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto("/login");
    await page.getByLabel("Email").fill(DELIVERY.deliveryEmail);
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
    await page.getByLabel("Email").fill(DELIVERY.deliveryEmail);
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

  // Delivery slip tests (PII intentionally shown to the driver)

  test("delivery slip page shows family name, address, and phone for the assigned family", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto("/login");
    await page.getByLabel("Email").fill(DELIVERY.deliveryEmail);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
    await page.goto("/delivery/delivery-slips");

    // Only our assigned family is shown, with the PII the driver needs
    const card = page.locator(".delivery-slip-card").filter({ hasText: DELIVERY.familyName });
    await expect(card).toHaveCount(1, { timeout: 10_000 });
    await expect(card).toContainText(TEST_FAMILY_ADDRESS);
    await expect(card).toContainText(TEST_FAMILY_PHONE);

    await context.close();
  });

  test("admin opens the delivery slip from a family row action", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/admin/families");
    await expect(page.getByRole("heading", { name: "Manage Families" })).toBeVisible({ timeout: 10_000 });

    // The family list accumulates data from every test in the suite — narrow
    // it to ours with the page's search box (1s debounce) instead of
    // paginating through the whole table.
    await page.getByLabel("Search all fields").fill(DELIVERY.familyName);
    const row = page.getByRole("row").filter({ hasText: DELIVERY.familyName });
    await expect(row.first()).toBeVisible({ timeout: 15_000 });
    await row.first().getByRole("button", { name: "More actions" }).click();
    await row.first().getByRole("menuitem", { name: "View Delivery Slip" }).click();

    await page.waitForURL(/\/admin\/delivery-slips\?family_ids=\d+/, { timeout: 10_000 });
    const card = page.locator(".delivery-slip-card").filter({ hasText: DELIVERY.familyName });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card).toContainText(TEST_FAMILY_ADDRESS);
    await expect(card).toContainText(TEST_FAMILY_PHONE);

    await context.close();
  });

  test("admin scope selector filters which delivery slips are shown", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/admin/delivery-slips");

    const scopeSelect = page.getByLabel("Scope");
    const ourCard = page.locator(".delivery-slip-card").filter({ hasText: DELIVERY.familyName });

    // Everyone (default) — the assigned family is shown
    await expect(scopeSelect).toHaveValue("all");
    await expect(ourCard.first()).toBeVisible({ timeout: 10_000 });

    // Assigned (to anyone) — still shown
    await scopeSelect.selectOption("assigned");
    await expect(ourCard.first()).toBeVisible({ timeout: 10_000 });

    // Assigned (to specific person) — the list is withheld until a person
    // is picked, then picking our delivery user shows it again
    await scopeSelect.selectOption("specific");
    await expect(ourCard).toHaveCount(0, { timeout: 10_000 });
    const personSelect = page.getByLabel("Delivery person");
    await personSelect.selectOption({ label: DELIVERY.deliveryDisplay });
    await expect(ourCard.first()).toBeVisible({ timeout: 10_000 });

    // Unassigned — our family has a delivery person, so it disappears
    await scopeSelect.selectOption("unassigned");
    await expect(ourCard).toHaveCount(0, { timeout: 10_000 });

    await context.close();
  });
});

test.describe.serial("Role Downstream — public wish list", () => {
  test.beforeAll(async ({ request: req }) => {
    const api = await loginViaApi(req);
    await buildChain(api, GUEST_DATA, GUEST, {
      createEarlyFamily: true,
      approveChain: true,
    });
    await api.dispose();
  });

  test.afterAll(async ({ request: req }) => {
    const authed = await loginViaApi(req);
    await teardownChain(authed, GUEST_DATA);
    await authed.dispose();
  });

  test("guest can view a family wish list", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`/families/${GUEST_DATA.familyId}/wish-list`);

    /* Page heading shows the display ID (numeric, e.g. "1" or "2-3") */
    await expect(
      page.getByRole("heading", { name: /^\d+(?:-\d+)*$/ }),
    ).toBeVisible({ timeout: 10_000 });

    /* Family wish card is visible */
    await expect(page.getByText("A warm blanket for everyone")).toBeVisible();

    /* People table shows the child and their wishes */
    await expect(page.getByRole("table")).toContainText(GUEST.personName);
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

    if (!GUEST_DATA.secondFamilyId) {
      throw new Error("Missing second family ID — cannot verify non-admin-locked 403");
    }

    await page.goto(`/families/${GUEST_DATA.secondFamilyId}/wish-list`);

    await expect(page.getByRole("heading", { name: "Unable to Load Wish List" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("This family hasn't been fully approved yet.")).toBeVisible();

    await context.close();
  });
});
