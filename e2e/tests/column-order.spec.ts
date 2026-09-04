/**
 * Column drag-to-reorder e2e coverage for the admin list/detail tables and
 * the donor claim tables.
 *
 * Verifies the full user loop: drag a header onto another column, confirm the
 * visible order changes, confirm it survives a reload (localStorage), and
 * confirm "Reset order" (plus the ColumnToggle gear reset) restores the
 * registry default. The referrer-families and family-people tests also
 * confirm the shared-order behavior: reordering on the main list page is
 * reflected on the referrer/family-scoped sub-table (same column registry).
 *
 * Every admin test first restores default column preferences via the gear
 * reset (see resetColumnsViaGear) so its default-header assertions hold no
 * matter what localStorage the storageState file carries.
 *
 * Data:
 * - Admin families / emails tests: no family data needed — the header row
 *   renders regardless of rows. The emails test creates a referrer + user and
 *   approves it (approval sends a logged email) so the table has a row.
 * - Referrer-families / family-people / donor tests: isolated family
 *   scenarios (same pattern as donor-self-service.spec.ts), cleaned up in
 *   afterAll.
 */
import { expect, test } from "@playwright/test";
import {
  approveWishChain,
  createDonorWithUser,
  createIsolatedFamilyScenario,
  createReferrerWithUserAndCredentials,
  deleteFamilyViaApi,
  deleteReferrerViaApi,
  deleteUserViaApi,
  loginViaApi,
} from "../helpers/api";

const STORAGE_ADMIN = "storage/admin.json";

/** Default AdminFamilies header order (all columns visible by default). */
const DEFAULT_FAMILY_HEADERS = ["ID", "Family Name", "Family Wish", "Contact", "Referrer", "Actions"];

const familyHeaders = (page: import("@playwright/test").Page) => page.locator("thead").getByRole("columnheader");

/**
 * Column order/visibility preferences persist in the page's localStorage,
 * which a storageState file may carry over (e.g. if storage/admin.json is
 * ever re-captured from a browser with a customized layout). Admin tests
 * restore defaults via the gear reset before asserting the default header
 * order, instead of trusting a clean slate. (Contexts created without
 * storageState — e.g. the donor test — start with empty localStorage and
 * need no normalization.)
 */
const resetColumnsViaGear = async (page: import("@playwright/test").Page) => {
  await page.getByRole("button", { name: "Toggle columns" }).click();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
};

test.describe("Admin families — column order", () => {
  test("drag reorders columns, order persists across reload, reset restores default", async ({ browser }) => {
    const context = await browser.newContext({ storageState: STORAGE_ADMIN });
    const page = await context.newPage();
    await page.goto("/admin/families");
    await page.waitForLoadState("networkidle");

    // Normalize column preferences (see resetColumnsViaGear).
    await resetColumnsViaGear(page);

    await expect(familyHeaders(page)).toHaveText(DEFAULT_FAMILY_HEADERS);

    // Drag "Referrer" onto the left edge of "Family Wish" → before it.
    const referrer = page.getByRole("columnheader", { name: "Referrer" });
    const familyWish = page.getByRole("columnheader", { name: "Family Wish" });
    await referrer.dragTo(familyWish, { targetPosition: { x: 4, y: 8 } });

    await expect(familyHeaders(page)).toHaveText(["ID", "Family Name", "Referrer", "Family Wish", "Contact", "Actions"]);

    // The custom order survives a reload (persisted in localStorage).
    await page.reload({ waitUntil: "networkidle" });
    await expect(familyHeaders(page)).toHaveText(["ID", "Family Name", "Referrer", "Family Wish", "Contact", "Actions"]);

    // "Reset order" appears only when the order is customized, and restores.
    const resetOrder = page.getByRole("button", { name: "Reset order" });
    await expect(resetOrder).toBeVisible();
    await resetOrder.click();
    await expect(familyHeaders(page)).toHaveText(DEFAULT_FAMILY_HEADERS);
    await expect(resetOrder).not.toBeVisible();

    await context.close();
  });
});

test.describe("Donor claim detail — wish table column order", () => {
  const SUFFIX = Math.random().toString(36).slice(2, 8);

  const scenarioData: {
    donor?: { userId: number; email: string; password: string };
    scenario?: {
      referrerId: number;
      referrerUserId: number;
      referrerEmail: string;
      referrerPassword: string;
      familyId: number;
      familyName: string;
      personId: number;
      personName: string;
    };
  } = {};

  test.beforeAll(async ({ request }) => {
    const api = await loginViaApi(request);

    const donor = await createDonorWithUser(api, {
      email: `e2e-donor-${SUFFIX}@example.com`,
      password: "Password123!",
      displayName: `Donor ${SUFFIX}`,
    });
    const scenario = await createIsolatedFamilyScenario(api, SUFFIX);
    // Fully approve the family so it shows up for claiming
    await approveWishChain(api, scenario.familyId, scenario.referrerEmail, scenario.referrerPassword);

    scenarioData.donor = donor;
    scenarioData.scenario = scenario;

    await api.dispose();
  });

  test.afterAll(async ({ request }) => {
    const authed = await loginViaApi(request);
    const { scenario, donor } = scenarioData;
    if (scenario?.familyId) await deleteFamilyViaApi(authed, scenario.familyId);
    if (scenario?.referrerUserId) await deleteUserViaApi(authed, scenario.referrerUserId);
    if (scenario?.referrerId) await deleteReferrerViaApi(authed, scenario.referrerId);
    if (donor?.userId) await deleteUserViaApi(authed, donor.userId);
    await authed.dispose();
  });

  const wishHeaders = (page: import("@playwright/test").Page) => page.locator("table").getByRole("columnheader");

  test("drag reorders the paired wish columns, order persists, reset restores default", async ({ browser }) => {
    const { donor, scenario } = scenarioData;
    if (!donor || !scenario) {
      test.skip(true, "scenario setup failed in beforeAll");
      return;
    }

    // --- Claim the isolated family through the donor UI ---
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/login");
    await page.getByLabel("Email").fill(donor.email);
    await page.getByLabel("Password").fill(donor.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/dashboard/);

    await page.goto(`/families/${scenario.familyId}/wish-list`);
    await expect(page.getByText("Family Members")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Sponsor this family" }).click();
    await expect(page.getByRole("heading", { name: "Sponsor This Family" })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Sponsor Family" }).click();
    await page.waitForURL(/\/donor\/claims\/\d+/);
    await expect(page.getByText("Family Members & Wishes")).toBeVisible({ timeout: 10_000 });

    // --- Wish table column order ---
    await expect(wishHeaders(page)).toHaveText(["Name", "Age", "Practical Wish", "Fun Wish", "Actions"]);

    // Drag "Fun Wish" onto the left edge of "Age" — the whole pair
    // (Practical + Fun) moves together and stays adjacent.
    const funWish = page.getByRole("columnheader", { name: "Fun Wish" });
    const age = page.getByRole("columnheader", { name: "Age" });
    await funWish.dragTo(age, { targetPosition: { x: 4, y: 8 } });

    await expect(wishHeaders(page)).toHaveText(["Name", "Practical Wish", "Fun Wish", "Age", "Actions"]);

    // Persists across reload.
    await page.reload({ waitUntil: "networkidle" });
    await expect(wishHeaders(page)).toHaveText(["Name", "Practical Wish", "Fun Wish", "Age", "Actions"]);

    // Reset restores the default layout.
    await page.getByRole("button", { name: "Reset order" }).click();
    await expect(wishHeaders(page)).toHaveText(["Name", "Age", "Practical Wish", "Fun Wish", "Actions"]);

    await context.close();
  });
});

test.describe("Admin referrer families — column order (shared with main families page)", () => {
  const SUFFIX = Math.random().toString(36).slice(2, 8);
  const scenarioData: {
    scenario?: { referrerId: number; referrerUserId: number; familyId: number };
  } = {};

  test.beforeAll(async ({ request }) => {
    const api = await loginViaApi(request);
    const scenario = await createIsolatedFamilyScenario(api, SUFFIX);
    scenarioData.scenario = scenario;
    await api.dispose();
  });

  test.afterAll(async ({ request }) => {
    const authed = await loginViaApi(request);
    const { scenario } = scenarioData;
    if (scenario?.familyId) await deleteFamilyViaApi(authed, scenario.familyId);
    if (scenario?.referrerUserId) await deleteUserViaApi(authed, scenario.referrerUserId);
    if (scenario?.referrerId) await deleteReferrerViaApi(authed, scenario.referrerId);
    await authed.dispose();
  });

  test("order set on the main families page is reflected here, persists, reset restores default", async ({ browser }) => {
    const scenario = scenarioData.scenario;
    if (!scenario) {
      test.skip(true, "scenario setup failed in beforeAll");
      return;
    }

    const context = await browser.newContext({ storageState: STORAGE_ADMIN });
    const page = await context.newPage();

    // Reorder on the main families page.
    await page.goto("/admin/families");
    await page.waitForLoadState("networkidle");
    await resetColumnsViaGear(page);
    await expect(familyHeaders(page)).toHaveText(DEFAULT_FAMILY_HEADERS);

    const referrer = page.getByRole("columnheader", { name: "Referrer" });
    const familyWish = page.getByRole("columnheader", { name: "Family Wish" });
    await referrer.dragTo(familyWish, { targetPosition: { x: 4, y: 8 } });
    await expect(familyHeaders(page)).toHaveText([
      "ID",
      "Family Name",
      "Referrer",
      "Family Wish",
      "Contact",
      "Actions",
    ]);

    // The referrer-scoped table shows the same custom order — same column
    // registry, so one order applies to both tables.
    await page.goto(`/admin/referrers/${scenario.referrerId}/families`);
    await page.waitForLoadState("networkidle");
    const scopedHeaders = page.locator("thead").getByRole("columnheader");
    await expect(scopedHeaders).toHaveText(["ID", "Family Name", "Referrer", "Family Wish", "Contact", "Actions"]);

    // The shared order survives a reload.
    await page.reload({ waitUntil: "networkidle" });
    await expect(scopedHeaders).toHaveText(["ID", "Family Name", "Referrer", "Family Wish", "Contact", "Actions"]);

    // "Reset order" (shown because the order is customized) restores the default.
    const resetOrder = page.getByRole("button", { name: "Reset order" });
    await expect(resetOrder).toBeVisible();
    await resetOrder.click();
    await expect(scopedHeaders).toHaveText(DEFAULT_FAMILY_HEADERS);
    await expect(resetOrder).not.toBeVisible();

    await context.close();
  });
});

test.describe("Admin family people — column order (shared with main people page)", () => {
  const SUFFIX = Math.random().toString(36).slice(2, 8);
  const scenarioData: {
    scenario?: { referrerId: number; referrerUserId: number; familyId: number };
  } = {};

  test.beforeAll(async ({ request }) => {
    const api = await loginViaApi(request);
    const scenario = await createIsolatedFamilyScenario(api, SUFFIX);
    scenarioData.scenario = scenario;
    await api.dispose();
  });

  test.afterAll(async ({ request }) => {
    const authed = await loginViaApi(request);
    const { scenario } = scenarioData;
    if (scenario?.familyId) await deleteFamilyViaApi(authed, scenario.familyId);
    if (scenario?.referrerUserId) await deleteUserViaApi(authed, scenario.referrerUserId);
    if (scenario?.referrerId) await deleteReferrerViaApi(authed, scenario.referrerId);
    await authed.dispose();
  });

  // The Age header on the main people page carries the sort arrow glyph.
  // (toHaveText matches text content — no space before the glyph; getByRole
  // matches the accessible name, which does have one.)
  const DEFAULT_PEOPLE_HEADERS = ["ID", "Name", "Age⇅", "Wishes (Practical + Fun)", "Family", "Actions"];
  const DEFAULT_FAMILY_PEOPLE_HEADERS = ["ID", "Name", "Age", "Practical Wish", "Fun Wish", "Actions"];

  test("order set on the main people page is reflected here, wish pair moves as a unit, reset restores default", async ({
    browser,
  }) => {
    const scenario = scenarioData.scenario;
    if (!scenario) {
      test.skip(true, "scenario setup failed in beforeAll");
      return;
    }

    const context = await browser.newContext({ storageState: STORAGE_ADMIN });
    const page = await context.newPage();

    // Reorder on the main people page (drag Age before Name).
    await page.goto("/admin/people");
    await page.waitForLoadState("networkidle");
    await resetColumnsViaGear(page);
    const peopleHeaders = page.locator("thead").getByRole("columnheader");
    await expect(peopleHeaders).toHaveText(DEFAULT_PEOPLE_HEADERS);

    const age = page.getByRole("columnheader", { name: "Age ⇅", exact: true });
    const name = page.getByRole("columnheader", { name: "Name", exact: true });
    await age.dragTo(name, { targetPosition: { x: 4, y: 8 } });
    await expect(peopleHeaders).toHaveText(["ID", "Age⇅", "Name", "Wishes (Practical + Fun)", "Family", "Actions"]);

    // The family-scoped people table shows the same custom order (the Family
    // column is omitted there; the wish pair renders as two headers).
    await page.goto(`/admin/families/${scenario.familyId}/people`);
    await page.waitForLoadState("networkidle");
    const familyPeopleHeaders = page.locator("thead").getByRole("columnheader");
    await expect(familyPeopleHeaders).toHaveText(["ID", "Age", "Name", "Practical Wish", "Fun Wish", "Actions"]);

    // Drag the second wish header — the whole pair moves before Name, still
    // adjacent.
    const funWish = page.getByRole("columnheader", { name: "Fun Wish" });
    await funWish.dragTo(name, { targetPosition: { x: 4, y: 8 } });
    await expect(familyPeopleHeaders).toHaveText([
      "ID",
      "Age",
      "Practical Wish",
      "Fun Wish",
      "Name",
      "Actions",
    ]);

    // Persists across reload.
    await page.reload({ waitUntil: "networkidle" });
    await expect(familyPeopleHeaders).toHaveText([
      "ID",
      "Age",
      "Practical Wish",
      "Fun Wish",
      "Name",
      "Actions",
    ]);

    // Reset restores the default layout.
    await page.getByRole("button", { name: "Reset order" }).click();
    await expect(familyPeopleHeaders).toHaveText(DEFAULT_FAMILY_PEOPLE_HEADERS);

    await context.close();
  });
});

test.describe("Admin emails — column order", () => {
  const SUFFIX = Math.random().toString(36).slice(2, 8);
  const refData: { referrerId?: number; referrerUserId?: number } = {};

  // Approving the referrer sends (suppressed) approval email, which lands in
  // the sent-email log so the table has a row to render.
  test.beforeAll(async ({ request }) => {
    const api = await loginViaApi(request);
    const referrer = await createReferrerWithUserAndCredentials(api, {
      name: `E2E Email Ref ${SUFFIX}`,
      familyLimit: 1,
      phoneNumber: "555-000-8888",
      email: `e2e-email-ref-${SUFFIX}@example.com`,
      password: "Password123!",
    });
    const approveResp = await api.post(`/api/admin/referrers/${referrer.referrerId}/approve`);
    if (!approveResp.ok()) {
      const body = await approveResp.text();
      throw new Error(`referrer approve failed (${approveResp.status()}): ${body}`);
    }
    refData.referrerId = referrer.referrerId;
    refData.referrerUserId = referrer.userId;
    await api.dispose();
  });

  test.afterAll(async ({ request }) => {
    const authed = await loginViaApi(request);
    if (refData.referrerUserId) await deleteUserViaApi(authed, refData.referrerUserId);
    if (refData.referrerId) await deleteReferrerViaApi(authed, refData.referrerId);
    await authed.dispose();
  });

  test("drag reorders columns, order persists across reload, reset restores default", async ({ browser }) => {
    const context = await browser.newContext({ storageState: STORAGE_ADMIN });
    const page = await context.newPage();
    await page.goto("/admin/emails");
    await page.waitForLoadState("networkidle");
    await resetColumnsViaGear(page);

    const headers = page.locator("thead").getByRole("columnheader");
    await expect(headers).toHaveText(["Recipient", "Kind", "Status", "Sender", "Sent"]);

    const sent = page.getByRole("columnheader", { name: "Sent", exact: true });
    const kind = page.getByRole("columnheader", { name: "Kind", exact: true });
    await sent.dragTo(kind, { targetPosition: { x: 4, y: 8 } });

    await expect(headers).toHaveText(["Recipient", "Sent", "Kind", "Status", "Sender"]);

    // The custom order survives a reload (persisted in localStorage).
    await page.reload({ waitUntil: "networkidle" });
    await expect(headers).toHaveText(["Recipient", "Sent", "Kind", "Status", "Sender"]);

    // "Reset order" appears only when the order is customized, and restores.
    const resetOrder = page.getByRole("button", { name: "Reset order" });
    await expect(resetOrder).toBeVisible();
    await resetOrder.click();
    await expect(headers).toHaveText(["Recipient", "Kind", "Status", "Sender", "Sent"]);
    await expect(resetOrder).not.toBeVisible();

    await context.close();
  });
});
