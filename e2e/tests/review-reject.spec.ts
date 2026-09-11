/**
 * Review Reject Loops — the reject/send-back half of the wish review
 * workflow (core-flow.spec.ts covers the happy path).
 *
 * One data chain (referrer → verified family → person) walks through every
 * lock state, so the tests run serially and hand state off in order:
 *
 *  1. Family requests review, cancels the request, re-requests
 *     (hands off: family is awaiting referrer review).
 *  2. Referrer rejects with a reason → family sees the reason, re-requests →
 *     referrer approves (hands off: family is awaiting admin review).
 *  3. Admin rejects with a reason → referrer sees the reason on the family
 *     detail page and re-submits → admin approves (hands off: fully
 *     approved).
 *  4. Family people page is read-only once fully approved.
 *
 * Setup is API-only; every assertion in the tests goes through the UI.
 */
import { test, expect } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import {
  createReferrerWithUserAndCredentials,
  createFamilyViaApi,
  createPersonViaApi,
  createFamilyUserViaApi,
  deletePersonViaApi,
  deleteFamilyViaApi,
  deleteReferrerViaApi,
  deleteUserViaApi,
  loginViaApi,
} from "../helpers/api";

const SUFFIX = Math.random().toString(36).slice(2, 8);
const PASSWORD = "Password123!";
const REFERRER_EMAIL = `e2e-rrej-ref-${SUFFIX}@example.com`;
const FAMILY_EMAIL = `e2e-rrej-fam-${SUFFIX}@example.com`;
const FAMILY_NAME = `E2E Reject Family ${SUFFIX}`;
const PERSON_NAME = `Child ${SUFFIX}`;
const REASON_REFERRER = `Please add more detail to the practical wish (${SUFFIX}).`;
const REASON_ADMIN = `Wishes need more specificity before approval (${SUFFIX}).`;

/* Created-ID trackers — populated in beforeAll, read in afterAll */
const testData: {
  referrerId?: number;
  referrerUserId?: number;
  familyId?: number;
  familyUserId?: number;
  personId?: number;
} = {};

/** Log a user in through the UI and return the page (caller waits for the role-specific URL). */
async function uiLogin(browser: Browser, email: string, password: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  return page;
}

test.describe.serial("Review reject loops", () => {
  test.beforeAll(async ({ request: req }) => {
    const api = await loginViaApi(req);

    const referrer = await createReferrerWithUserAndCredentials(api, {
      name: `E2E Reject Ref ${SUFFIX}`,
      familyLimit: 5,
      phoneNumber: "555-000-9999",
      email: REFERRER_EMAIL,
      password: PASSWORD,
    });
    testData.referrerId = referrer.referrerId;
    testData.referrerUserId = referrer.userId;

    const family = await createFamilyViaApi(api, referrer.referrerId, {
      familyName: FAMILY_NAME,
      familyWish: `E2E reject wish ${SUFFIX}`,
      contactName: `Contact ${SUFFIX}`,
      phoneNumber: "555-111-2222",
      address: `12 Reject Lane ${SUFFIX}`,
    });
    testData.familyId = family.familyId;

    const person = await createPersonViaApi(api, family.familyId, {
      givenName: PERSON_NAME,
      role: "son",
      age: 7,
      wish: `E2E coat wish ${SUFFIX}`,
      size: "7",
      funWish: `E2E fun wish ${SUFFIX}`,
    });
    testData.personId = person.personId;

    const familyUser = await createFamilyUserViaApi(api, {
      email: FAMILY_EMAIL,
      password: PASSWORD,
      familyId: family.familyId,
      displayName: `E2E Reject Family User ${SUFFIX}`,
    });
    testData.familyUserId = familyUser.userId;

    await api.dispose();
  });

  test.afterAll(async ({ request: req }) => {
    const authed = await loginViaApi(req);
    if (testData.familyUserId) await deleteUserViaApi(authed, testData.familyUserId);
    if (testData.personId) await deletePersonViaApi(authed, testData.personId);
    if (testData.familyId) await deleteFamilyViaApi(authed, testData.familyId);
    if (testData.referrerUserId) await deleteUserViaApi(authed, testData.referrerUserId);
    if (testData.referrerId) await deleteReferrerViaApi(authed, testData.referrerId);
    await authed.dispose();
  });

  test("family requests review, cancels the request, and re-requests", async ({ browser }) => {
    const page = await uiLogin(browser, FAMILY_EMAIL, PASSWORD);
    await page.waitForURL(/\/family\/dashboard/, { timeout: 15_000 });

    /* Editable state — request-review CTA */
    await expect(page.getByText("Add everyone in your family, then click DONE.")).toBeVisible({
      timeout: 10_000,
    });

    /* Request review */
    await page.getByRole("button", { name: "DONE" }).click();
    await expect(page.getByRole("button", { name: "Yes, I am done" })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Yes, I am done" }).click();
    await expect(page.getByText("Awaiting referrer review")).toBeVisible({ timeout: 10_000 });

    /* Cancel the request — no confirm dialog, straight to the editable banner */
    await page.getByRole("button", { name: "Cancel Request" }).click();
    await expect(page.getByText("Review request cancelled")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Add everyone in your family, then click DONE.")).toBeVisible({
      timeout: 10_000,
    });

    /* Re-request — hands the family off to the referrer queue for the next test */
    await page.getByRole("button", { name: "DONE" }).click();
    await page.getByRole("button", { name: "Yes, I am done" }).click();
    await expect(page.getByText("Awaiting referrer review")).toBeVisible({ timeout: 10_000 });
  });

  test("referrer rejects with a reason; family sees it and re-requests; referrer approves", async ({ browser }) => {
    /* ── Referrer rejects from the queue ─────────────────────────── */
    const refPage = await uiLogin(browser, REFERRER_EMAIL, PASSWORD);
    await refPage.waitForURL(/\/dashboard/, { timeout: 15_000 });
    await refPage.goto("/referrer/wish-review");
    await expect(refPage.getByRole("heading", { name: "Wish Review Queue" })).toBeVisible({ timeout: 10_000 });

    const queueRow = refPage.getByRole("row").filter({ hasText: FAMILY_NAME });
    await expect(queueRow).toBeVisible({ timeout: 10_000 });

    /* Reject → reason modal (audience: the family) */
    await queueRow.getByRole("button", { name: "Reject" }).click();
    const rejectModal = refPage.locator("div.fixed.inset-0.z-50");
    await expect(rejectModal.getByText("Provide a reason the family can see:")).toBeVisible({
      timeout: 10_000,
    });
    await rejectModal.getByLabel("Rejection reason").fill(REASON_REFERRER);
    /* The row's own Reject button is still in the DOM — scope to the modal */
    await rejectModal.getByRole("button", { name: "Reject" }).click();

    await expect(refPage.getByText("Wishes sent back to family")).toBeVisible({ timeout: 10_000 });
    /* Scoped queue (this referrer has one family) drains to the empty state */
    await expect(refPage.getByText("No families awaiting wish review.")).toBeVisible({ timeout: 10_000 });

    /* ── Family sees the rejection and re-requests ───────────────── */
    const famPage = await uiLogin(browser, FAMILY_EMAIL, PASSWORD);
    await famPage.waitForURL(/\/family\/dashboard/, { timeout: 15_000 });
    await expect(famPage.getByText("Your referrer sent this back for revisions:")).toBeVisible({
      timeout: 10_000,
    });
    await expect(famPage.getByText(REASON_REFERRER)).toBeVisible();

    await famPage.getByRole("button", { name: "DONE" }).click();
    await famPage.getByRole("button", { name: "Yes, I am done" }).click();
    await expect(famPage.getByText("Awaiting referrer review")).toBeVisible({ timeout: 10_000 });

    /* ── Referrer approves — hands the family off to the admin queue */
    await refPage.goto("/referrer/wish-review");
    await expect(queueRow).toBeVisible({ timeout: 10_000 });
    await queueRow.getByRole("button", { name: "Approve" }).click();
    await expect(refPage.getByText("Wishes submitted for admin review")).toBeVisible({ timeout: 10_000 });
    await expect(refPage.getByText("No families awaiting wish review.")).toBeVisible({ timeout: 10_000 });

    /* Family is now referrer-locked */
    await famPage.reload();
    await expect(
      famPage.getByText("Your family profile has been reviewed by your referrer and is now locked."),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("admin rejects with a reason; referrer re-submits; admin approves", async ({ browser }) => {
    /* ── Admin rejects from the global approval queue ────────────── */
    const adminContext = await browser.newContext({ storageState: "storage/admin.json" });
    const adminPage = await adminContext.newPage();
    await adminPage.goto("/admin/wish-review");
    await expect(adminPage.getByRole("heading", { name: "Wish Approval Queue" })).toBeVisible({
      timeout: 10_000,
    });

    /* Global queue — other test files may leave their own rows behind */
    const adminRow = adminPage.getByRole("row").filter({ hasText: FAMILY_NAME });
    await expect(adminRow).toBeVisible({ timeout: 10_000 });

    await adminRow.getByRole("button", { name: "Reject" }).click();
    const rejectModal = adminPage.locator("div.fixed.inset-0.z-50");
    await expect(rejectModal.getByText("Provide a reason the referrer can see:")).toBeVisible({
      timeout: 10_000,
    });
    await rejectModal.getByLabel("Rejection reason").fill(REASON_ADMIN);
    await rejectModal.getByRole("button", { name: "Reject" }).click();

    await expect(adminPage.getByText("Wishes sent back to referrer")).toBeVisible({ timeout: 10_000 });
    await expect(adminRow).toHaveCount(0, { timeout: 10_000 });

    /* ── Referrer sees the rejection on the family detail page ───── */
    const refPage = await uiLogin(browser, REFERRER_EMAIL, PASSWORD);
    await refPage.waitForURL(/\/dashboard/, { timeout: 15_000 });
    await refPage.goto(`/referrer/families/${testData.familyId}`);
    await expect(refPage.getByText("Admin rejection:")).toBeVisible({ timeout: 10_000 });
    await expect(refPage.getByText(REASON_ADMIN)).toBeVisible();

    /* Re-submit → confirm → back in the admin queue */
    await refPage.getByRole("button", { name: "Re-submit for Admin Review" }).click();
    await expect(refPage.getByRole("button", { name: "Yes, submit" })).toBeVisible({ timeout: 10_000 });
    await refPage.getByRole("button", { name: "Yes, submit" }).click();
    await expect(refPage.getByText("Wishes submitted for admin review")).toBeVisible({ timeout: 10_000 });
    await expect(refPage.getByText("Awaiting admin review:")).toBeVisible();

    /* ── Admin approves — fully approved ─────────────────────────── */
    await adminPage.goto("/admin/wish-review");
    await expect(adminRow).toBeVisible({ timeout: 10_000 });
    await adminRow.getByRole("button", { name: "Approve" }).click();
    await expect(adminPage.getByText("Wishes approved — family is now visible to donors")).toBeVisible({
      timeout: 10_000,
    });
    await expect(adminRow).toHaveCount(0, { timeout: 10_000 });

    const famPage = await uiLogin(browser, FAMILY_EMAIL, PASSWORD);
    await famPage.waitForURL(/\/family\/dashboard/, { timeout: 15_000 });
    await expect(
      famPage.getByText("Your family profile is fully approved and visible to donors."),
    ).toBeVisible({ timeout: 10_000 });

    await adminContext.close();
  });

  test("family people page is read-only once the family is locked", async ({ browser }) => {
    const page = await uiLogin(browser, FAMILY_EMAIL, PASSWORD);
    await page.waitForURL(/\/family\/dashboard/, { timeout: 15_000 });
    await page.goto("/family/people");
    await expect(page.getByRole("heading", { name: "Manage People" })).toBeVisible({ timeout: 10_000 });

    /* Lock banner with the fully-approved variant */
    await expect(page.getByText("Editing is currently locked.")).toBeVisible();
    await expect(
      page.getByText("Your family profile is fully approved and visible to donors. Contact your referrer if changes are needed."),
    ).toBeVisible();

    /* No create/edit/delete controls */
    await expect(page.getByRole("button", { name: "+ Add Person" })).toHaveCount(0);

    /* Person is still listed, but the row shows "Locked" instead of actions */
    const personRow = page.getByRole("row").filter({ hasText: PERSON_NAME });
    await expect(personRow).toBeVisible();
    await expect(personRow.getByText("Locked", { exact: true })).toBeVisible();
    await expect(personRow.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await expect(personRow.getByRole("button", { name: "Delete" })).toHaveCount(0);
  });
});
