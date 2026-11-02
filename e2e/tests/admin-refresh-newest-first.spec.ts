/**
 * Admin sees referrer-created families — regression test for the reported
 * confusion: a referrer adds a family, and the admin (a) cannot force a
 * refetch of what's on screen, and (b) with the default order (referrer,
 * then id) the new family lands deep in the list, not on the first page.
 *
 * Setup (API): an isolated referrer + login user.
 *
 * Flow (UI):
 *  1. Admin opens /admin/families — the table loads BEFORE the new family exists
 *  2. A second context logs in as the referrer and creates a family via the
 *     "My Families" form
 *  3. Admin turns on "Newest first" — the list refetches with sort=-created_at
 *  4. Admin clicks the header "Refresh data" button — assert the list request
 *     fires with sort=-created_at (causation pinned to the button, not an
 *     incidental auto-refetch)
 *  5. The new family is the FIRST data row of page 1
 *
 * Trap: do NOT assert the new row is "absent" before the click — a
 * window-focus refetch (staleTime 5min may or may not have elapsed) could
 * surface it, so absence is not a reliable pre-condition.
 *
 * Uses unique names per run so re-runs without a DB wipe don't collide.
 */
import { test, expect, request, type Response } from "@playwright/test";
import { loginAs, loginAsAdmin } from "../helpers/auth";
import { getBaseUrl } from "../helpers/env";
import {
  createReferrerWithUserAndCredentials,
  deleteFamilyViaApi,
  deleteReferrerViaApi,
  deleteUserViaApi,
  loginViaApi,
} from "../helpers/api";

/* Unique test data so re-runs without a DB wipe don't collide */
const SUFFIX = Math.random().toString(36).slice(2, 8);
const FAMILY_NAME = `E2E Family ${SUFFIX}`;
const FAMILY_WISH = `A blanket and a smile ${SUFFIX}`;
const CONTACT_NAME = `E2E Contact ${SUFFIX}`;

/* Track IDs for cleanup (only records this test created) */
const testData: {
  referrerId?: number;
  referrerUserId?: number;
  familyId?: number;
} = {};

/* GET /api/admin/families?page=… — not /deleted, /dropdown, /review-queue, … */
function isFamiliesListResponse(r: Response): boolean {
  return r.request().method() === "GET" && r.url().includes("/api/admin/families?");
}

test.describe.serial("Admin sees referrer-created families", () => {
  test.afterAll(async ({ request: req }) => {
    const authed = await loginViaApi(req);

    /* Clean up in reverse creation order (only records this test created) */
    if (testData.familyId) {
      await deleteFamilyViaApi(authed, testData.familyId);
    }
    if (testData.referrerUserId) {
      await deleteUserViaApi(authed, testData.referrerUserId);
    }
    if (testData.referrerId) {
      await deleteReferrerViaApi(authed, testData.referrerId);
    }

    await authed.dispose();
  });

  test("refresh + newest first surfaces a newly added family as the first row", async ({ browser }) => {
    /* ═══════════════════════════════════════════════════════════
     * Setup — isolated referrer + login user via API
     * ═══════════════════════════════════════════════════════════ */
    const adminApi = await request.newContext({ baseURL: getBaseUrl() });
    await loginViaApi(adminApi);

    const referrer = await createReferrerWithUserAndCredentials(adminApi, {
      name: `E2E Referrer ${SUFFIX}`,
      familyLimit: 3,
      phoneNumber: "555-010-9999",
      email: `e2e-referrer-${SUFFIX}@example.test`,
      password: "Password123!",
    });
    testData.referrerId = referrer.referrerId;
    testData.referrerUserId = referrer.userId;

    try {
      /* ═══════════════════════════════════════════════════════════
       * Step 1 — Admin opens /admin/families (before the family exists)
       * ═══════════════════════════════════════════════════════════ */
      const adminContext = await browser.newContext();
      const adminPage = await adminContext.newPage();

      await loginAsAdmin(adminPage);
      const [initialList] = await Promise.all([
        adminPage.waitForResponse(isFamiliesListResponse, { timeout: 15_000 }),
        adminPage.goto("/admin/families"),
      ]);
      expect(initialList.status()).toBe(200);

      /* ═══════════════════════════════════════════════════════════
       * Step 2 — Referrer logs in and creates a family via the UI
       * ═══════════════════════════════════════════════════════════ */
      const referrerContext = await browser.newContext();
      const referrerPage = await referrerContext.newPage();

      await loginAs(referrerPage, { email: referrer.email, password: referrer.password });
      await referrerPage.goto("/referrer/families");
      await expect(referrerPage.getByRole("heading", { name: "My Families" })).toBeVisible();

      await referrerPage.getByRole("button", { name: "+ Add family" }).click();
      await referrerPage.getByLabel("Family Name").fill(FAMILY_NAME);
      await referrerPage.getByLabel("Contact Name").fill(CONTACT_NAME);
      await referrerPage.getByLabel("Family Wish").fill(FAMILY_WISH);
      await referrerPage.getByLabel("Address").fill("123 Test Lane");
      await referrerPage.getByLabel("Phone Number").fill("5551234567");
      await referrerPage.getByRole("button", { name: "Create" }).click();

      const referrerRow = referrerPage.getByRole("row").filter({ hasText: FAMILY_NAME });
      await expect(referrerRow).toBeVisible({ timeout: 15_000 });

      await referrerContext.close();

      /* ═══════════════════════════════════════════════════════════
       * Step 3 — Admin turns on "Newest first" (list refetches with sort)
       * ═══════════════════════════════════════════════════════════ */
      await adminPage
        .getByRole("button", { name: "Newest first" })
        .click();
      await adminPage.waitForResponse((r) => isFamiliesListResponse(r) && r.url().includes("sort=-created_at"), {
        timeout: 15_000,
      });

      /* ═══════════════════════════════════════════════════════════
       * Step 4 — Admin clicks the header "Refresh data" button
       * ═══════════════════════════════════════════════════════════ */
      // Scope the wait to the sorted request — the refresh must refetch the
      // current (newest-first) list query. Waiting for the sorted URL pins the
      // request to this click regardless of any other list traffic.
      const refreshResponsePromise = adminPage.waitForResponse(
        (r) => isFamiliesListResponse(r) && r.url().includes("sort=-created_at"),
        { timeout: 15_000 },
      );
      await adminPage.getByRole("button", { name: "Refresh data" }).click();
      const refreshResponse = await refreshResponsePromise;

      /* The refresh must use the current (newest-first) sort — this pins the
         list request to the button click rather than an auto-refetch. */
      expect(refreshResponse.url()).toContain("sort=-created_at");
      expect(refreshResponse.status()).toBe(200);

      /* ═══════════════════════════════════════════════════════════
       * Step 5 — The new family is the FIRST data row of page 1
       * ═══════════════════════════════════════════════════════════ */
      const firstRow = adminPage.locator("tbody tr[data-id]").first();
      await expect(firstRow).toContainText(FAMILY_NAME, { timeout: 15_000 });

      /* Data for teardown — rows carry the raw DB ID in data-id */
      testData.familyId = Number((await firstRow.getAttribute("data-id")) ?? NaN);
      expect(testData.familyId).toBeGreaterThan(0);

      await adminContext.close();
    } finally {
      await adminApi.dispose();
    }
  });
});
