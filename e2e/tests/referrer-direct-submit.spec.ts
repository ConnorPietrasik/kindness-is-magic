/**
 * Referrer Direct Submit — a referrer can lock a family and submit it for
 * admin review without the family ever requesting review.
 *
 * Setup (API): an isolated referrer + family + person. No family user is
 * created, so the family structurally cannot have requested review.
 *
 * Flow (UI):
 *  1. Referrer opens My Families — the row offers "Submit" directly
 *  2. Confirm dialog warns that only an admin can unlock
 *  3. Confirm — the row moves to referrer lock (no submit button left)
 *  4. Family appears in the ADMIN wish review queue; admin approves
 *  5. Guest views the public wish list
 *
 * Uses unique names per run so re-runs without a DB wipe don't collide.
 */
import { test, expect, request } from "@playwright/test";
import { loginAs, loginAsAdmin } from "../helpers/auth";
import {
  createIsolatedFamilyScenario,
  deleteFamilyViaApi,
  deletePersonViaApi,
  deleteReferrerViaApi,
  deleteUserViaApi,
  loginViaApi,
} from "../helpers/api";

/* Unique test data so re-runs without a DB wipe don't collide */
const SUFFIX = Math.random().toString(36).slice(2, 8);
const FAMILY_WISH = `A warm blanket for everyone ${SUFFIX}`;

/* Track IDs for cleanup */
const testData: {
  referrerId?: number;
  referrerUserId?: number;
  familyId?: number;
  personId?: number;
} = {};

test.describe("Referrer Direct Submit", () => {
  test.afterAll(async ({ request: req }) => {
    const authed = await loginViaApi(req);

    /* Clean up in reverse creation order (only records this test created) */
    if (testData.personId) {
      await deletePersonViaApi(authed, testData.personId);
    }
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

  test("referrer locks a family and submits for admin review without a family request", async ({ browser }) => {
    /* ═══════════════════════════════════════════════════════════
     * Setup — isolated referrer + family + person via API
     * ═══════════════════════════════════════════════════════════ */
    const adminApi = await request.newContext({ baseURL: "http://localhost" });
    await loginViaApi(adminApi);

    const scenario = await createIsolatedFamilyScenario(adminApi, SUFFIX, { familyWish: FAMILY_WISH });
    testData.referrerId = scenario.referrerId;
    testData.referrerUserId = scenario.referrerUserId;
    testData.familyId = scenario.familyId;
    testData.personId = scenario.personId;

    try {
      /* ═══════════════════════════════════════════════════════════
       * Step 1 — Referrer opens My Families; row offers "Submit"
       * ═══════════════════════════════════════════════════════════ */
      const referrerContext = await browser.newContext();
      const referrerPage = await referrerContext.newPage();

      await loginAs(referrerPage, { email: scenario.referrerEmail, password: scenario.referrerPassword });
      await referrerPage.goto("/referrer/families");
      await expect(referrerPage.getByRole("heading", { name: "My Families" })).toBeVisible();

      const familyRow = referrerPage.getByRole("row").filter({ hasText: scenario.familyName });
      await expect(familyRow).toBeVisible({ timeout: 10_000 });

      /* No family review request exists — the row must still offer the action */
      const submitButton = familyRow.getByRole("button", { name: "Submit" });
      await expect(submitButton).toBeVisible();
      await submitButton.click();

      /* ═══════════════════════════════════════════════════════════
       * Step 2 — Confirm dialog names the family and warns about lock
       * ═══════════════════════════════════════════════════════════ */
      await expect(referrerPage.getByText("Submit wishes for admin review?")).toBeVisible();
      await expect(referrerPage.getByText(`This will lock the wishes for ${scenario.familyName}`)).toBeVisible();
      await expect(referrerPage.getByText(/only an admin can unlock/)).toBeVisible();

      await referrerPage.getByRole("button", { name: "Yes, submit" }).click();

      /* ═══════════════════════════════════════════════════════════
       * Step 3 — Row moves to referrer lock (submit action gone)
       * ═══════════════════════════════════════════════════════════ */
      await expect(submitButton).toBeHidden({ timeout: 10_000 });
      /* Amber row tint marks the referrer lock level */
      await expect(familyRow).toHaveClass(/bg-amber-50/, { timeout: 10_000 });

      await referrerContext.close();

      /* ═══════════════════════════════════════════════════════════
       * Step 4 — Family is in the ADMIN review queue; admin approves
       * ═══════════════════════════════════════════════════════════ */
      const adminContext = await browser.newContext();
      const adminPage = await adminContext.newPage();

      await loginAsAdmin(adminPage);
      await adminPage.goto("/admin/wish-review");

      /* Wait for the family to appear in the admin review queue */
      const adminRow = adminPage.getByRole("row").filter({ hasText: scenario.familyName });
      await expect(adminRow).toBeVisible({ timeout: 10_000 });

      await adminRow.getByRole("button", { name: "Approve" }).click();

      /* Our family should leave the queue (the queue is global — parallel test
         files may legitimately leave their own rows behind) */
      await expect(adminRow).toHaveCount(0, { timeout: 10_000 });

      await adminContext.close();

      /* ═══════════════════════════════════════════════════════════
       * Step 5 — Guest views the public wish list
       * ═══════════════════════════════════════════════════════════ */
      const publicContext = await browser.newContext();
      const publicPage = await publicContext.newPage();

      await publicPage.goto(`/families/${scenario.familyId}/wish-list`);
      await expect(publicPage.getByText(FAMILY_WISH)).toBeVisible({ timeout: 10_000 });
      await expect(publicPage.getByRole("table")).toContainText(scenario.personName);

      await publicContext.close();
    } finally {
      await adminApi.dispose();
    }
  });
});
