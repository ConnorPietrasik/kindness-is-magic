/**
 * Admin Packing Slips — /admin/packing-slips (the admin twin of the delivery
 * packing slips covered in role-downstream.spec.ts).
 *
 *  - The family-row "View Packing Slip" action opens the page filtered to
 *    that one family (family_ids param).
 *  - The unfiltered page lists all fully-approved families; slips show
 *    display IDs and wishes, never family PII.
 *  - Filtering to a family that isn't verified yet shows the empty state.
 *
 * Setup (API): one isolated scenario fully approved via the approval chain,
 * plus one pending-verification family (invite self-registration) for the
 * empty-state test. Teardown deletes only this spec's records.
 */
import { test, expect } from "@playwright/test";
import {
  createIsolatedFamilyScenario,
  fullyApproveFamilyViaApi,
  registerFamilyViaInvite,
  deletePersonViaApi,
  deleteFamilyViaApi,
  deleteReferrerViaApi,
  deleteUserViaApi,
  loginViaApi,
} from "../helpers/api";

const SUFFIX = Math.random().toString(36).slice(2, 8);
const PASSWORD = "Password123!";
/* Unique per run — the only identifying text on a slip card (no PII shown) */
const FAMILY_WISH = `E2E packing wish ${SUFFIX}`;
const PERSON_WISH = `E2E packing coat ${SUFFIX}`;
const PERSON_FUN_WISH = `E2E packing fun ${SUFFIX}`;
const ADDRESS = `99 Packing Slip Road ${SUFFIX}`;

/* Created-ID trackers — populated in beforeAll, read in afterAll */
const testData: {
  referrerId?: number;
  referrerUserId?: number;
  familyId?: number;
  familyName?: string;
  personId?: number;
  pendingFamilyId?: number;
  pendingUserId?: number;
} = {};

test.describe.serial("Admin Packing Slips", () => {
  test.beforeAll(async ({ request: req }) => {
    const api = await loginViaApi(req);

    /* Fully-approved scenario — appears in the slip list */
    const scenario = await createIsolatedFamilyScenario(api, SUFFIX, {
      familyWish: FAMILY_WISH,
      personWish: PERSON_WISH,
      personFunWish: PERSON_FUN_WISH,
      familyAddress: ADDRESS,
    });
    testData.referrerId = scenario.referrerId;
    testData.referrerUserId = scenario.referrerUserId;
    testData.familyId = scenario.familyId;
    testData.familyName = scenario.familyName;
    testData.personId = scenario.personId;
    await fullyApproveFamilyViaApi(api, scenario.familyId);

    /* Pending-verification family (invite self-registration) — excluded from slips */
    const refResp = await api.get(`/api/admin/referrers/${scenario.referrerId}`);
    if (!refResp.ok()) {
      throw new Error(`beforeAll: referrer detail fetch failed: ${refResp.status()}`);
    }
    const { family_invite_code } = (await refResp.json()) as { family_invite_code: string };

    const pending = await registerFamilyViaInvite(api, {
      code: family_invite_code,
      familyName: `E2E Packing Pending ${SUFFIX}`,
      familyWish: `E2E pending wish ${SUFFIX}`,
      contactName: `Pending Contact ${SUFFIX}`,
      email: `e2e-ppend-${SUFFIX}@example.com`,
      password: PASSWORD,
      address: ADDRESS,
      phoneNumber: "555-333-4444",
    });
    testData.pendingFamilyId = pending.familyId;
    testData.pendingUserId = pending.userId;

    await api.dispose();
  });

  test.afterAll(async ({ request: req }) => {
    const authed = await loginViaApi(req);
    if (testData.pendingUserId) await deleteUserViaApi(authed, testData.pendingUserId);
    if (testData.pendingFamilyId) await deleteFamilyViaApi(authed, testData.pendingFamilyId);
    if (testData.personId) await deletePersonViaApi(authed, testData.personId);
    if (testData.familyId) await deleteFamilyViaApi(authed, testData.familyId);
    if (testData.referrerUserId) await deleteUserViaApi(authed, testData.referrerUserId);
    if (testData.referrerId) await deleteReferrerViaApi(authed, testData.referrerId);
    await authed.dispose();
  });

  test("family row action opens the packing slip filtered to that family", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/admin/families");
    await expect(page.getByRole("heading", { name: "Manage Families" })).toBeVisible({ timeout: 10_000 });

    /* The family list accumulates data from every test in the suite — narrow
       it to ours with the page's search box (1s debounce). */
    await page.getByLabel("Search all fields").fill(testData.familyName!);
    const row = page.getByRole("row").filter({ hasText: testData.familyName! });
    await expect(row.first()).toBeVisible({ timeout: 15_000 });
    await row.first().getByRole("button", { name: "More actions" }).click();
    await row.first().getByRole("menuitem", { name: "View Packing Slip" }).click();

    await page.waitForURL(/\/admin\/packing-slips\?family_ids=\d+/, { timeout: 10_000 });

    /* Exactly one slip — ours, identified by the unique family wish */
    const card = page.locator(".packing-slip-card").filter({ hasText: FAMILY_WISH });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".packing-slip-card")).toHaveCount(1);

    /* People and wishes are on the slip */
    await expect(card).toContainText(PERSON_WISH);
    await expect(card).toContainText(PERSON_FUN_WISH);

    /* Slips never carry family PII — display ID + wishes only */
    await expect(card).not.toContainText(testData.familyName!);
    await expect(card).not.toContainText(ADDRESS);

    await expect(page.getByRole("button", { name: /Print/ })).toBeVisible();

    await context.close();
  });

  test("unfiltered page lists fully-approved families with a print action", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/admin/packing-slips");

    /* Our family's slip is in the list (other suites' approved families may
       be present in parallel — don't assert the total count). */
    const card = page.locator(".packing-slip-card").filter({ hasText: FAMILY_WISH });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".packing-slip-card").filter({ hasText: FAMILY_WISH })).toHaveCount(1);

    await expect(page.getByRole("button", { name: /Print/ })).toBeVisible();

    await context.close();
  });

  test("filtering to a pending-verification family shows the empty state", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto(`/admin/packing-slips?family_ids=${testData.pendingFamilyId}`);

    await expect(page.getByText("No packing slips found.")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("None of the selected families are ready for packing.")).toBeVisible();

    await context.close();
  });
});
