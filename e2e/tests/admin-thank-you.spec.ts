/**
 * Admin — Thank-You Emails.
 *
 * The merged donor list (a fulfilled gift sponsor + a general donor whose
 * payment sits on the separate general-donation campaign, mirrored but
 * never reconciled), the personalized draft (composer pre-fill, send,
 * auto-thanked on success), and the manual mark/unmark-thanked round-trip
 * for out-of-band thanking.
 *
 * The general donor rides on the Zeffy mock's second campaign: its payment
 * is seeded there, then pulled into the local mirror with the Zeffy page's
 * "Sync with Zeffy" button (the mirror is append-only, so the sync is the
 * only in-test path in). Skips (with a reason) when the mock or its .env
 * wiring is missing — see e2e/AGENTS.md. Mock payments are tag-scoped: the
 * suite runs fully parallel against one shared mock.
 */
import { test, expect, request as playwrightRequest, type Browser, type BrowserContext, type Page } from "@playwright/test";
import {
  createDonorWithUser,
  createFamilyViaApi,
  createReferrerWithUser,
  deleteClaimViaApi,
  deleteFamilyViaApi,
  deleteReferrerViaApi,
  deleteUserViaApi,
  fullyApproveFamilyViaApi,
  loginViaApi,
} from "../helpers/api";
import { getBaseUrl, getEnvValue } from "../helpers/env";
import { getZeffyGeneralCampaignId, mockReset, mockSeedPayments, zeffyMockGate } from "../helpers/zeffy-mock";

/** Tag scoping this spec's mock payments (the suite runs fully parallel). */
const TAG = "admin-thank-you";
const SUFFIX = Math.random().toString(36).slice(2, 8);
const PASSWORD = "Password123!";
const DONOR_EMAIL = `e2e-thankyou-donor-${SUFFIX}@example.com`;
const GENERAL_EMAIL = `e2e-thankyou-general-${SUFFIX}@example.com`;
const FAMILY_NAME = `E2E Thank You Family ${SUFFIX}`;

const data: {
  gate: string | null;
  referrerId?: number;
  referrerUserId?: number;
  familyId?: number;
  donorUserId?: number;
  claimId?: number;
} = { gate: null };

test.describe.serial("Admin thank-you emails (Zeffy mock)", () => {
  test.beforeAll(async ({ request: req }) => {
    data.gate =
      (getEnvValue("ZEFFY_GENERAL_CAMPAIGN_ID")
        ? null
        : "ZEFFY_GENERAL_CAMPAIGN_ID is not set in .env — the general donor's campaign can't be seeded") ??
      (await zeffyMockGate());
    if (data.gate) return; // every test self-skips with the reason

    const admin = await loginViaApi(req);
    try {
      const referrer = await createReferrerWithUser(admin, {
        name: `E2E ThankYou Ref ${SUFFIX}`,
        familyLimit: 2,
        phoneNumber: "555-000-8888",
        email: `e2e-thankyou-ref-${SUFFIX}@example.com`,
        password: PASSWORD,
      });
      data.referrerId = referrer.referrerId;
      data.referrerUserId = referrer.userId;

      const family = await createFamilyViaApi(admin, referrer.referrerId, {
        familyName: FAMILY_NAME,
        familyWish: `E2E thank-you wish ${SUFFIX}`,
        contactName: `Thank You Contact ${SUFFIX}`,
        phoneNumber: "555-222-4444",
        address: `8 Thank You Lane ${SUFFIX}`,
        bio: `E2E thank-you family ${SUFFIX}`,
      });
      data.familyId = family.familyId;
      await fullyApproveFamilyViaApi(admin, family.familyId);

      const donor = await createDonorWithUser(admin, {
        email: DONOR_EMAIL,
        password: PASSWORD,
        displayName: `Carol E2E ${SUFFIX}`,
      });
      data.donorUserId = donor.userId;

      // The donor gift-claims the family, then the admin fulfils it
      const donorCtx = await playwrightRequest.newContext({ baseURL: getBaseUrl() });
      try {
        await donorCtx.post("/api/auth/login", { data: { email: DONOR_EMAIL, password: PASSWORD } });
        const claimResp = await donorCtx.post(`/api/families/${family.familyId}/claim`, {
          data: { commitment_type: "gifts" },
        });
        if (!claimResp.ok()) throw new Error(`gift claim failed (${claimResp.status()}): ${await claimResp.text()}`);
        data.claimId = ((await claimResp.json()) as { id: number }).id;
      } finally {
        await donorCtx.dispose();
      }
      const fulfillResp = await admin.post(`/api/donor/claims/${data.claimId}/fulfill`);
      if (!fulfillResp.ok()) throw new Error(`fulfill failed (${fulfillResp.status()}): ${await fulfillResp.text()}`);

      // The general donor: a payment on the separate general-donation
      // campaign (the org's real setup) — pulled in by the sync the first
      // test performs
      await mockReset(TAG);
      await mockSeedPayments(TAG, [
        { email: GENERAL_EMAIL, name: `General Giver ${SUFFIX}`, amountUsd: 75, campaignId: getZeffyGeneralCampaignId() },
      ]);
    } finally {
      await admin.dispose();
    }
  });

  test.afterAll(async ({ request: req }) => {
    if (data.gate) return;
    const admin = await loginViaApi(req);
    if (data.claimId) await deleteClaimViaApi(admin, data.claimId);
    // The tests end with the donor marked thanked (the send's auto-mark plus
    // the round-trip's re-mark) — clear the row the tests created. 404 = a
    // failing run left no mark behind.
    const unmark = await admin.post("/api/admin/thank-you/unthanked", { data: { email: DONOR_EMAIL } });
    if (!unmark.ok()) console.warn(`[admin-thank-you] thank-you unmark returned ${unmark.status()}`);
    await mockReset(TAG);
    if (data.familyId) await deleteFamilyViaApi(admin, data.familyId);
    if (data.donorUserId) await deleteUserViaApi(admin, data.donorUserId);
    if (data.referrerUserId) await deleteUserViaApi(admin, data.referrerUserId);
    if (data.referrerId) await deleteReferrerViaApi(admin, data.referrerId);
    await admin.dispose();
  });

  async function adminPage(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();
    return { context, page };
  }

  test("lists the fulfilled sponsor and the general donor", async ({ browser }) => {
    if (data.gate) {
      test.skip(true, data.gate);
      return;
    }
    const { context, page } = await adminPage(browser);
    try {
      await page.goto("/admin/thank-you");
      await expect(page.getByRole("heading", { name: "Thank-You Emails" })).toBeVisible({ timeout: 10_000 });

      // The fulfilled gift sponsor (the mirror doesn't know the general
      // donor yet — sync it in via the Zeffy page first)
      const sponsorRow = page.locator("tr").filter({ hasText: DONOR_EMAIL });
      await expect(sponsorRow).toContainText(FAMILY_NAME, { timeout: 10_000 });
      await expect(sponsorRow).toContainText("Sponsorship");
      await expect(sponsorRow).toContainText("Not thanked");

      await page.goto("/admin/zeffy-payments");
      // Wait for the sync the click triggers: the POST is issued a tick
      // after the click resolves, and navigating to the thank-you page
      // before it completes aborts it — the general donor would never
      // reach the mirror and the assertions below would time out.
      const [syncRes] = await Promise.all([
        page.waitForResponse((res) => res.url().includes("/api/admin/zeffy/sync")),
        page.getByRole("button", { name: "Sync with Zeffy" }).click(),
      ]);
      expect(syncRes.status()).toBe(200);
      // The general donor's payment is on the separate general-donation
      // campaign — the sync pulls it into the mirror, but it never appears
      // on the reconciliation page (the thank-you page is where it surfaces)
      await expect(page.locator("tr").filter({ hasText: GENERAL_EMAIL })).toHaveCount(0);

      await page.goto("/admin/thank-you");
      const general = page.locator("tr").filter({ hasText: GENERAL_EMAIL });
      await expect(general).toContainText("General", { timeout: 10_000 });
      await expect(general).toContainText("$75");
      await expect(general).toContainText("Not thanked");

      // Exactly the two scenario donors on the page (their rows; the list
      // may hold history from other runs, so scope to their emails)
      await expect(page.locator("tbody tr").filter({ hasText: DONOR_EMAIL })).toHaveCount(1);
      await expect(page.locator("tbody tr").filter({ hasText: GENERAL_EMAIL })).toHaveCount(1);
    } finally {
      await context.close();
    }
  });

  test("draft opens pre-filled; sending auto-marks the donor thanked", async ({ browser }) => {
    if (data.gate) {
      test.skip(true, data.gate);
      return;
    }
    const { context, page } = await adminPage(browser);
    try {
      await page.goto("/admin/thank-you");
      const sponsorRow = page.locator("tr").filter({ hasText: DONOR_EMAIL });
      await expect(sponsorRow).toContainText("Sponsorship", { timeout: 10_000 });

      await sponsorRow.getByRole("button", { name: "Draft email" }).click();

      const dialog = page.getByRole("dialog", { name: "Send email" });
      await expect(dialog).toBeVisible({ timeout: 10_000 });
      // The personalized draft: recipient + subject + a body confirming the
      // sponsorship (family names are PII and must not reach the donor)
      await expect(dialog.getByLabel("Recipient")).toHaveValue(DONOR_EMAIL);
      await expect(dialog.getByLabel("Subject (optional)")).toHaveValue("Thank you, Carol, for your sponsorship");
      await expect(dialog.getByLabel("Message")).toHaveValue(/The family has received all their gifts/);
      await expect(dialog.getByLabel("Message")).not.toHaveValue(new RegExp(FAMILY_NAME));

      await dialog.getByRole("button", { name: "Send" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "Email sent" })).toBeVisible({ timeout: 15_000 });

      // A successful send auto-marked the donor thanked (the row refetched)
      await expect(sponsorRow).toContainText("Thanked", { timeout: 10_000 });
      await expect(sponsorRow.getByRole("button", { name: "Mark unthanked" })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("manual unmark / mark round-trips for out-of-band thanking", async ({ browser }) => {
    if (data.gate) {
      test.skip(true, data.gate);
      return;
    }
    const { context, page } = await adminPage(browser);
    try {
      await page.goto("/admin/thank-you");
      const sponsorRow = page.locator("tr").filter({ hasText: DONOR_EMAIL });
      await expect(sponsorRow).toContainText("Thanked", { timeout: 10_000 });

      // Unmark (e.g. the admin realized the email bounced)
      await sponsorRow.getByRole("button", { name: "Mark unthanked" }).click();
      await expect(sponsorRow).toContainText("Not thanked", { timeout: 10_000 });

      // Mark (thanked out-of-band — in person, phone, own email client)
      await sponsorRow.getByRole("button", { name: "Mark thanked" }).click();
      await expect(sponsorRow).toContainText("Thanked", { timeout: 10_000 });
    } finally {
      await context.close();
    }
  });
});
