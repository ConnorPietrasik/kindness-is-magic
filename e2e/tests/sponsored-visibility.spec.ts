/**
 * Sponsored visibility — sponsored families and their status.
 *
 *  - /families hides families that anyone sponsor (gift or cash) from every
 *    visitor's default list. The donor's OWN sponsored family moves to the
 *    "Sponsored by me" section above the grid (visible without any toggle).
 *  - The "Show sponsored families" toggle (URL: ?include_claimed=true) is
 *    admin-only and reveals claimed families with a three-state chip from
 *    claim_status — "Sponsored" (active) / "Awaiting payment" (pending cash)
 *    / "Fulfilled". Non-admins are unaffected even with the param in the URL
 *    (admin share link).
 *  - The public wish list tells EVERY visitor the sponsorship status
 *    (no "Sponsor this family" CTA) so nobody is surprised by the 409.
 *  - The claiming donor sees their own status + claim-detail link on the wish list.
 *
 * Setup: referrer → fully-approved family A → donor claims A (gifts) via API.
 * All data is API-created and cleaned up in afterAll.
 */
import { test, expect } from "@playwright/test";
import { request as playwrightRequest } from "@playwright/test";
import {
  createReferrerWithUserAndCredentials,
  createFamilyViaApi,
  createPersonViaApi,
  createDonorWithUser,
  fullyApproveFamilyViaApi,
  deletePersonViaApi,
  deleteFamilyViaApi,
  deleteReferrerViaApi,
  deleteUserViaApi,
  deleteClaimViaApi,
  loginViaApi,
} from "../helpers/api";
import { loginAs, loginAsAdmin } from "../helpers/auth";
import { getBaseUrl } from "../helpers/env";

const SUFFIX = Math.random().toString(36).slice(2, 8);
const PASSWORD = "Password123!";
const BIO_A = `E2E sponsored family A ${SUFFIX}`;

const testData: {
  referrerId?: number;
  referrerUserId?: number;
  familyId?: number;
  personIds: number[];
  claimId?: number;
  donorUserId?: number;
  donorEmail?: string;
} = { personIds: [] };

test.describe.serial("Sponsored visibility", () => {
  test.beforeAll(async ({ request: req }) => {
    const admin = await loginViaApi(req);

    const referrer = await createReferrerWithUserAndCredentials(admin, {
      name: `E2E Sponsored Ref ${SUFFIX}`,
      familyLimit: 2,
      phoneNumber: "555-000-9998",
      email: `e2e-sponsored-ref-${SUFFIX}@example.com`,
      password: PASSWORD,
    });
    testData.referrerId = referrer.referrerId;
    testData.referrerUserId = referrer.userId;

    const family = await createFamilyViaApi(admin, referrer.referrerId, {
      familyName: `E2E Sponsored A ${SUFFIX}`,
      familyWish: `E2E sponsored wish ${SUFFIX}`,
      contactName: `Sponsored Contact ${SUFFIX}`,
      phoneNumber: "555-111-3333",
      address: `20 Sponsored Avenue ${SUFFIX}`,
      bio: BIO_A,
    });
    testData.familyId = family.familyId;
    const person = await createPersonViaApi(admin, family.familyId, {
      givenName: `Child ${SUFFIX}`,
      role: "son",
      age: 6,
      wish: `E2E sponsored child wish ${SUFFIX}`,
      funWish: `E2E sponsored child fun ${SUFFIX}`,
    });
    testData.personIds.push(person.personId);
    await fullyApproveFamilyViaApi(admin, family.familyId);

    const donor = await createDonorWithUser(admin, {
      email: `e2e-sponsored-donor-${SUFFIX}@example.com`,
      password: PASSWORD,
    });
    testData.donorUserId = donor.userId;
    testData.donorEmail = donor.email;

    // Donor claims family A via API (separate context — own cookie jar)
    const donorApi = await playwrightRequest.newContext({ baseURL: getBaseUrl() });
    await loginViaApi(donorApi, donor.email, donor.password);
    const claimResp = await donorApi.post(`/api/families/${family.familyId}/claim`, {
      data: { commitment_type: "gifts" },
    });
    if (!claimResp.ok()) {
      const body = await claimResp.text();
      throw new Error(`Sponsored visibility setup: claim failed (${claimResp.status()}): ${body}`);
    }
    testData.claimId = ((await claimResp.json()) as { id: number }).id;
    await donorApi.dispose();

    await admin.dispose();
  });

  test.afterAll(async ({ request: req }) => {
    const admin = await loginViaApi(req);
    if (testData.claimId) await deleteClaimViaApi(admin, testData.claimId);
    for (const personId of testData.personIds) await deletePersonViaApi(admin, personId);
    if (testData.familyId) await deleteFamilyViaApi(admin, testData.familyId);
    if (testData.donorUserId) await deleteUserViaApi(admin, testData.donorUserId);
    if (testData.referrerUserId) await deleteUserViaApi(admin, testData.referrerUserId);
    if (testData.referrerId) await deleteReferrerViaApi(admin, testData.referrerId);
    await admin.dispose();
  });

  test("browse page hides sponsored families from anonymous visitors (toggle hidden, URL param ignored)", async ({
    page,
  }) => {
    await page.goto("/families");
    const card = page.locator("div.grid > a").filter({ hasText: BIO_A });
    /* While the list is in flight the whole page is a spinner, so a visible
       heading means the family list has fully loaded — the absence assertion
       below cannot race the fetch. */
    await expect(page.getByRole("heading", { name: "Families Needing Gifts" })).toBeVisible({ timeout: 10_000 });
    await expect(card).toHaveCount(0);
    /* The toggle is admin-only — anonymous visitors never see it */
    await expect(page.getByLabel("Show sponsored families")).toHaveCount(0);

    /* Our family has exactly one member (no demo family does), so narrowing to
       1-member families keeps it on page 1 even though the demo CSV has more
       fully-approved families than one browse page holds. The admin-only
       ?include_claimed=true URL param must not reveal it to anonymous visitors. */
    await page.goto("/families?include_claimed=true");
    await expect(page.getByRole("heading", { name: "Families Needing Gifts" })).toBeVisible({ timeout: 10_000 });
    await page.getByLabel("Max Family Members").fill("1");
    await expect(page.getByRole("heading", { name: "Families Needing Gifts" })).toBeVisible({ timeout: 10_000 });
    await expect(card).toHaveCount(0);
  });

  test("admin sees the show-sponsored toggle and it reveals sponsored families", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/families");
    const card = page.locator("div.grid > a").filter({ hasText: BIO_A });
    await expect(page.getByRole("heading", { name: "Families Needing Gifts" })).toBeVisible({ timeout: 10_000 });
    await expect(card).toHaveCount(0);

    await page.getByLabel("Show sponsored families").check();
    await expect(page).toHaveURL(/include_claimed=true/);
    /* 1-member narrowing — same rationale as the anonymous test in this file */
    await page.getByLabel("Max Family Members").fill("1");
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card).toContainText("Sponsored");
  });

  test("wish list shows the sponsored status to anonymous visitors (no CTA)", async ({ page }) => {
    await page.goto(`/families/${testData.familyId}/wish-list`);
    await expect(page.getByText("This family is already sponsored")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Sponsor this family" })).toHaveCount(0);
  });

  test("claiming donor sees own family in the Sponsored by me section (no grid card, no toggle)", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await loginAs(page, { email: testData.donorEmail!, password: PASSWORD });
      await page.goto("/families");
      await expect(page.getByRole("heading", { name: "Families Needing Gifts" })).toBeVisible({ timeout: 10_000 });
      /* 1-member narrowing — same rationale as the anonymous test in this file */
      await page.getByLabel("Max Family Members").fill("1");
      /* The donor's OWN claimed family is out of the default grid… */
      const gridCard = page.locator("main > div.grid > a").filter({ hasText: BIO_A });
      await expect(gridCard).toHaveCount(0);
      /* …and shows in the "Sponsored by me" section instead (gift claim →
         green "Sponsored" chip), visible without the admin-only toggle. */
      const sectionCard = page
        .locator('section[aria-label="Sponsored by me"] a')
        .filter({ hasText: BIO_A });
      await expect(sectionCard).toBeVisible({ timeout: 10_000 });
      await expect(sectionCard).toContainText("Sponsored");
      await expect(page.getByLabel("Show sponsored families")).toHaveCount(0);

      await page.goto(`/families/${testData.familyId}/wish-list`);
      await expect(page.getByText("You are sponsoring this family")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByRole("link", { name: "View sponsorship details →" })).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
