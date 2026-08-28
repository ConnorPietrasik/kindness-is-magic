/**
 * Guest claim from the public wish list → direct claim.
 *
 * Covers the "remember which family a guest clicked for signup" flow in
 * both claim-dialog entry paths: the family ID is stored client-side when
 * the guest clicks a dialog button and consumed on successful auth.
 *
 * 1. Existing donor: "Claim this family" → "Sign in" → login form → lands
 *    back on that family's wish list with the claim modal open.
 * 2. Guest: "Claim this family" → "Register" → donor self-registration →
 *    lands back with the claim modal open. Completing the claim takes them
 *    to the claim detail page.
 *
 * describe.serial: both tests share module state and the same isolated
 * family. The sign-in test runs first and cancels its modal, leaving the
 * family unclaimed for the registration test.
 */
import { test, expect, request } from "@playwright/test";
import {
  approveWishChain,
  createDonorWithUser,
  createIsolatedFamilyScenario,
  deleteFamilyViaApi,
  deletePersonViaApi,
  deleteReferrerViaApi,
  deleteUserViaApi,
  listUsersViaApi,
  loginViaApi,
} from "../helpers/api";

const SUFFIX = Math.random().toString(36).slice(2, 8);
const PASSWORD = "Password123!";
const SIGNIN_DONOR_EMAIL = `e2e-donor-${SUFFIX}@example.com`;
const REG_DONOR_EMAIL = `e2e-donor-reg-${SUFFIX}@example.com`;

const testData: {
  donorUserId?: number;
  referrerId?: number;
  familyId?: number;
  personId?: number;
} = {};

test.describe.serial("Guest claim from wish list → direct claim", () => {
  test.beforeAll(async ({ request: req }) => {
    const api = await loginViaApi(req);

    // Existing donor for the sign-in path
    const donor = await createDonorWithUser(api, {
      email: SIGNIN_DONOR_EMAIL,
      password: PASSWORD,
      displayName: `Donor ${SUFFIX}`,
    });
    testData.donorUserId = donor.userId;

    // Isolated family scenario (referrer → family → person with wishes)
    const scenario = await createIsolatedFamilyScenario(api, SUFFIX);
    testData.referrerId = scenario.referrerId;
    testData.familyId = scenario.familyId;
    testData.personId = scenario.personId;

    // Fully approve so the family is visible on the public wish list
    await approveWishChain(api, scenario.familyId, scenario.referrerEmail, scenario.referrerPassword);

    await api.dispose();
  });

  test.afterAll(async ({ request: req }) => {
    const authed = await loginViaApi(req);

    // Donor created via API for the sign-in path
    if (testData.donorUserId) await deleteUserViaApi(authed, testData.donorUserId);

    // Donor created via the UI during the registration test — look up by email
    const users = await listUsersViaApi(authed, "donor");
    const regDonor = users.users.find((u) => u.email === REG_DONOR_EMAIL);
    if (regDonor) await deleteUserViaApi(authed, regDonor.id);

    // Clean up in reverse creation order
    if (testData.personId) await deletePersonViaApi(authed, testData.personId);
    if (testData.familyId) await deleteFamilyViaApi(authed, testData.familyId);
    if (testData.referrerId) await deleteReferrerViaApi(authed, testData.referrerId);

    await authed.dispose();
  });

  test("existing donor signs in from the claim dialog and lands on the open claim modal", async ({ browser }) => {
    if (!testData.familyId) test.skip();

    const context = await browser.newContext();
    const page = await context.newPage();

    // 1. Guest opens the public wish list
    await page.goto(`/families/${testData.familyId}/wish-list`);
    await expect(page.getByText("Family Members")).toBeVisible({ timeout: 10_000 });

    // 2. "Claim this family" shows the guest sign-in / register modal
    await page.getByRole("button", { name: "Claim this family" }).click();
    await expect(page.getByRole("heading", { name: "Sign in to Claim" })).toBeVisible();

    // 3. "Sign in" in the dialog — remembers the family and goes to the login page
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/login/);

    // 4. Log in as the API-created donor
    await page.getByLabel("Email").fill(SIGNIN_DONOR_EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    // 5. Lands back on the same family's wish list with the claim modal open
    await page.waitForURL(new RegExp(`/families/${testData.familyId}/wish-list`));
    await expect(page.getByRole("heading", { name: "Claim This Family" })).toBeVisible({ timeout: 10_000 });

    // 6. Cancel — leave the family unclaimed for the registration test
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("heading", { name: "Claim This Family" })).not.toBeVisible();

    await context.close();
  });

  test("guest registers from the wish list and lands on the open claim modal", async ({ browser }) => {
    if (!testData.familyId) test.skip();

    const context = await browser.newContext();
    const page = await context.newPage();

    // 1. Guest opens the public wish list
    await page.goto(`/families/${testData.familyId}/wish-list`);
    await expect(page.getByText("Family Members")).toBeVisible({ timeout: 10_000 });

    // 2. "Claim this family" shows the guest sign-in / register modal
    await page.getByRole("button", { name: "Claim this family" }).click();
    await expect(page.getByRole("heading", { name: "Sign in to Claim" })).toBeVisible();

    // 3. Register — stores the family and navigates to donor self-registration
    await page.getByRole("button", { name: "Register" }).click();
    await expect(page).toHaveURL(/\/register-donor/);

    // 4. Fill in and submit the registration form
    await page.getByLabel("Display Name").fill(`Donor ${SUFFIX}`);
    await page.getByLabel("Email").fill(REG_DONOR_EMAIL);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Confirm Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Create Account" }).click();

    // 5. Lands back on the same family's wish list with the claim modal open
    await page.waitForURL(new RegExp(`/families/${testData.familyId}/wish-list`));
    await expect(page.getByRole("heading", { name: "Claim This Family" })).toBeVisible({ timeout: 10_000 });

    // 6. Complete the claim (gifts is the default commitment)
    await page.getByRole("button", { name: "Claim Family" }).click();
    await page.waitForURL(/\/donor\/claims\/\d+/);
    await expect(page.getByText("Claim Details")).toBeVisible({ timeout: 10_000 });

    await context.close();
  });
});
