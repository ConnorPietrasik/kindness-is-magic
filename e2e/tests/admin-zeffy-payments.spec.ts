/**
 * Admin — Zeffy unmatched payments (against the bundled Zeffy mock).
 *
 * Two donors each hold a pending cash claim (created through the checkout
 * API in setup); the mock is seeded with their payments plus a stray one.
 * Covers the admin reconciliation page: the unmatched-default payment list,
 * the manual-match modal (pending claims grouped by donor + expected-amount
 * hint), the matched state (linked claim + hidden behind the toggle), the
 * donor's paid state, the donor waiting page picking up an admin match
 * through its ~15s cart poll (success panel with no confirm click), and the
 * unmatch correction (confirm dialog reverts the claim to pending and the
 * payment lists unmatched again, claim reads "Awaiting payment").
 *
 * Skips (with a reason) when the mock or its .env wiring is missing —
 * see e2e/AGENTS.md. Mock payments are tag-scoped: the suite runs fully
 * parallel against one shared mock.
 */
import { test, expect, request as playwrightRequest, type Browser, type BrowserContext, type Page } from "@playwright/test";
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
import { getBaseUrl } from "../helpers/env";
import { mockReset, mockSeedPayments, zeffyMockGate } from "../helpers/zeffy-mock";

/** Tag scoping this spec's mock payments (the suite runs fully parallel). */
const TAG = "admin-zeffy";
const SUFFIX = Math.random().toString(36).slice(2, 8);
const PASSWORD = "Password123!";
const BIO_A = `E2E Zeffy Admin Family A ${SUFFIX}`;
const BIO_B = `E2E Zeffy Admin Family B ${SUFFIX}`;
const STRANGER_EMAIL = `e2e-zeffy-stranger-${SUFFIX}@example.com`;

interface Donor {
  userId: number;
  email: string;
}

const data: {
  d1: Donor | null;
  d2: Donor | null;
  referrerId?: number;
  referrerUserId?: number;
  familyA?: number;
  familyB?: number;
  personIds: number[];
  claim1Id?: number;
  claim2Id?: number;
  gate: string | null;
} = { d1: null, d2: null, personIds: [], gate: null };

async function loginDonor(browser: Browser, donor: Donor): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(donor.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard/);
  return { context, page };
}

/** One pending cash claim via the checkout endpoint (the commit point). */
async function checkoutClaimViaApi(email: string, password: string, familyId: number): Promise<number> {
  const ctx = await playwrightRequest.newContext({ baseURL: getBaseUrl() });
  try {
    await ctx.post("/api/auth/login", { data: { email, password } });
    const resp = await ctx.post("/api/donor/cart/checkout", {
      data: { items: [{ family_id: familyId, includes_groceries: false }] },
    });
    if (!resp.ok()) throw new Error(`checkout failed (${resp.status()}): ${await resp.text()}`);
    const body = (await resp.json()) as { claim_ids: number[] };
    return body.claim_ids[0];
  } finally {
    await ctx.dispose();
  }
}

test.describe.serial("Admin Zeffy payments — manual reconciliation (Zeffy mock)", () => {
  test.beforeAll(async ({ request: req }) => {
    data.gate = await zeffyMockGate();
    if (data.gate) return; // every test self-skips with the reason

    const admin = await loginViaApi(req);
    data.d1 = await createDonorWithUser(admin, {
      email: `e2e-zeffy-d1-${SUFFIX}@example.com`,
      password: PASSWORD,
      displayName: `Zeffy Donor One ${SUFFIX}`,
    });
    data.d2 = await createDonorWithUser(admin, {
      email: `e2e-zeffy-d2-${SUFFIX}@example.com`,
      password: PASSWORD,
      displayName: `Zeffy Donor Two ${SUFFIX}`,
    });

    const referrer = await createReferrerWithUserAndCredentials(admin, {
      name: `E2E Zeffy Ref ${SUFFIX}`,
      familyLimit: 5,
      phoneNumber: "555-000-7777",
      email: `e2e-zeffy-ref-${SUFFIX}@example.com`,
      password: PASSWORD,
    });
    data.referrerId = referrer.referrerId;
    data.referrerUserId = referrer.userId;

    const families: Array<["familyA" | "familyB", string]> = [
      ["familyA", BIO_A],
      ["familyB", BIO_B],
    ];
    for (const [key, bio] of families) {
      const family = await createFamilyViaApi(admin, referrer.referrerId, {
        familyName: bio,
        familyWish: `E2E zeffy wish ${SUFFIX}`,
        contactName: `Zeffy Contact ${SUFFIX}`,
        phoneNumber: "555-111-5555",
        address: `55 Zeffy Street ${SUFFIX}`,
        bio,
      });
      data[key] = family.familyId;
      const person = await createPersonViaApi(admin, family.familyId, {
        givenName: `Zeffy Child ${SUFFIX}`,
        role: "son",
        age: 9,
        wish: `E2E zeffy shoes ${SUFFIX}`,
        size: "9",
        funWish: `E2E zeffy bike ${SUFFIX}`,
      });
      data.personIds.push(person.personId);
      await fullyApproveFamilyViaApi(admin, family.familyId);
    }
    await admin.dispose();

    // Both donors check out a $500 cart (pending cash claims)
    data.claim1Id = await checkoutClaimViaApi(data.d1.email, PASSWORD, data.familyA!);
    data.claim2Id = await checkoutClaimViaApi(data.d2.email, PASSWORD, data.familyB!);

    // Payments: each donor's exact amount, plus a stray one (direct form visit)
    await mockReset(TAG);
    await mockSeedPayments(TAG, [
      { email: data.d1.email, name: `Zeffy Donor One ${SUFFIX}`, amountUsd: 500 },
      { email: STRANGER_EMAIL, name: "Stray Visitor", amountUsd: 750 },
      { email: data.d2.email, name: `Zeffy Donor Two ${SUFFIX}`, amountUsd: 350 },
    ]);
  });

  test.afterAll(async ({ request: req }) => {
    if (data.gate) return;
    const admin = await loginViaApi(req);
    for (const claimId of [data.claim1Id, data.claim2Id]) {
      if (claimId) await deleteClaimViaApi(admin, claimId);
    }
    await mockReset(TAG);
    for (const personId of data.personIds) await deletePersonViaApi(admin, personId);
    for (const familyId of [data.familyA, data.familyB]) {
      if (familyId) await deleteFamilyViaApi(admin, familyId);
    }
    if (data.d1) await deleteUserViaApi(admin, data.d1.userId);
    if (data.d2) await deleteUserViaApi(admin, data.d2.userId);
    if (data.referrerUserId) await deleteUserViaApi(admin, data.referrerUserId);
    if (data.referrerId) await deleteReferrerViaApi(admin, data.referrerId);
    await admin.dispose();
  });

  test("payment list shows unmatched payments with buyer, amount and currency", async ({ browser }) => {
    if (data.gate) {
      test.skip(true, data.gate);
      return;
    }
    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();
    try {
      await page.goto("/admin/zeffy-payments");
      await expect(page.getByRole("heading", { name: "Zeffy Payments" })).toBeVisible({ timeout: 10_000 });

      const row1 = page.locator("tr").filter({ hasText: data.d1!.email });
      await expect(row1).toContainText("$500.00");
      await expect(row1).toContainText("Unmatched");
      await expect(row1.getByRole("button", { name: "Match manually" })).toBeVisible();

      const stray = page.locator("tr").filter({ hasText: STRANGER_EMAIL });
      await expect(stray).toContainText("$750.00");
      await expect(stray).toContainText("Unmatched");

      const row2 = page.locator("tr").filter({ hasText: data.d2!.email });
      await expect(row2).toContainText("$350.00");
      await expect(row2).toContainText("Unmatched");

      // Nothing is matched yet (scoped to the rows — the "Matched" column
      // header matches a page-wide search) — and the toggle defaults to
      // hiding matched rows
      await expect(page.locator("tbody").getByText("Matched", { exact: true })).toHaveCount(0);
      await expect(page.getByLabel("Show matched")).not.toBeChecked();
    } finally {
      await context.close();
    }
  });

  test("manual match: grouped pending claims, amount hint, matched state + paid claim", async ({ browser }) => {
    if (data.gate) {
      test.skip(true, data.gate);
      return;
    }
    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();
    try {
      await page.goto("/admin/zeffy-payments");
      const row1 = page.locator("tr").filter({ hasText: data.d1!.email });
      await expect(row1.getByRole("button", { name: "Match manually" })).toBeVisible({ timeout: 10_000 });
      await row1.getByRole("button", { name: "Match manually" }).click();

      // Modal header: payment amount + buyer
      await expect(page.getByRole("heading", { name: "Match payment manually" })).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText(`from ${data.d1!.email}`)).toBeVisible();

      // Donor group: display name + email, item count + cart total
      const group = page.locator("div.mb-4").filter({ hasText: data.d1!.email });
      await expect(group.getByText(`Zeffy Donor One ${SUFFIX}`)).toBeVisible();
      await expect(group).toContainText("Cart total:");
      await expect(group).toContainText("$500");

      // Select the exact claim → the amount hint turns green
      await page.getByLabel(new RegExp(`Match claim ${data.claim1Id} \\(family`)).check();
      await expect(page.getByText("Selected total matches the payment amount.")).toBeVisible();

      await page.getByRole("button", { name: "Confirm match" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "Payment matched to 1 claim" })).toBeVisible({ timeout: 10_000 });

      // Matched rows are hidden by the unmatched-only default filter…
      await expect(row1).toHaveCount(0);
      // …and revealed by the toggle, with the claim link and no match button
      await page.getByLabel("Show matched").check();
      await expect(row1).toContainText("Matched", { timeout: 10_000 });
      await expect(row1.getByRole("link", { name: `claim ${data.claim1Id}` })).toBeVisible();
      await expect(row1.getByRole("button", { name: "Match manually" })).toHaveCount(0);
      // …and stay hidden after a reload with the toggle off
      await page.reload();
      await expect(page.getByRole("heading", { name: "Zeffy Payments" })).toBeVisible({ timeout: 10_000 });
      await expect(page.locator("tr").filter({ hasText: data.d1!.email })).toHaveCount(0);
    } finally {
      await context.close();
    }

    // The donor's claim now reads paid
    const d1 = await loginDonor(browser, data.d1!);
    try {
      await d1.page.goto("/donor/claims");
      await expect(d1.page.getByRole("heading", { name: "My Sponsorships" })).toBeVisible({ timeout: 10_000 });
      const claimRow = d1.page.locator("tr").filter({ hasText: BIO_A });
      await expect(claimRow).toContainText("cash");
      await expect(claimRow).toContainText("Paid");
      await expect(claimRow).not.toContainText("Awaiting payment");
    } finally {
      await d1.context.close();
    }
  });

  test("donor waiting page picks up an admin match through its cart poll (no confirm click)", async ({ browser }) => {
    if (data.gate) {
      test.skip(true, data.gate);
      return;
    }
    // Donor 2 sits on the cart's waiting state (committed claim, empty local cart)
    const d2 = await loginDonor(browser, data.d2!);
    try {
      await d2.page.goto("/donor/cart");
      await expect(d2.page.getByRole("button", { name: "I completed my payment" })).toBeVisible({ timeout: 10_000 });
      const waitingCard = d2.page.locator("li").filter({ hasText: BIO_B });
      await expect(waitingCard).toContainText("Awaiting payment");

      // The exact-amount payment lands on the mock…
      await mockSeedPayments(TAG, [{ email: data.d2!.email, name: `Zeffy Donor Two ${SUFFIX}`, amountUsd: 500 }]);

      // …and the admin matches it — the donor never clicks confirm
      const context = await browser.newContext({ storageState: "storage/admin.json" });
      const page = await context.newPage();
      try {
        await page.goto("/admin/zeffy-payments");
        const row = page.locator("tr").filter({ hasText: data.d2!.email }).filter({ hasText: "$500.00" });
        await expect(row.getByRole("button", { name: "Match manually" })).toBeVisible({ timeout: 10_000 });
        await row.getByRole("button", { name: "Match manually" }).click();
        await page.getByLabel(new RegExp(`Match claim ${data.claim2Id} \\(family`)).check({ timeout: 10_000 });
        await expect(page.getByText("Selected total matches the payment amount.")).toBeVisible();
        await page.getByRole("button", { name: "Confirm match" }).click();
        await expect(page.getByRole("alert").filter({ hasText: "Payment matched to 1 claim" })).toBeVisible({ timeout: 10_000 });
      } finally {
        await context.close();
      }

      // The ~15s poll of GET /api/donor/cart sees the cart empty → success
      // panel (the items were paid, not swept, so no false "expired" fallback).
      await expect(d2.page.getByRole("heading", { name: "Your payment was received" })).toBeVisible({ timeout: 45_000 });
      await expect(d2.page.getByRole("button", { name: "View my sponsorships" })).toBeVisible();
    } finally {
      await d2.context.close();
    }
  });

  test("unmatch: confirm dialog reverts the claim to pending and the payment lists unmatched again", async ({ browser }) => {
    if (data.gate) {
      test.skip(true, data.gate);
      return;
    }
    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();
    try {
      await page.goto("/admin/zeffy-payments");
      await expect(page.getByRole("heading", { name: "Zeffy Payments" })).toBeVisible({ timeout: 10_000 });

      // d1's $500 payment was matched in the manual-match test — the row sits
      // behind the show-matched toggle and carries the Unmatch action.
      await page.getByLabel("Show matched").check();
      const row1 = page.locator("tr").filter({ hasText: data.d1!.email }).filter({ hasText: "$500.00" });
      await expect(row1.getByRole("button", { name: "Unmatch" })).toBeVisible({ timeout: 10_000 });

      // Cancel first: the dialog closes and nothing happens.
      await row1.getByRole("button", { name: "Unmatch" }).click();
      await expect(page.getByText("Unmatch this payment?")).toBeVisible({ timeout: 10_000 });
      await page.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByText("Unmatch this payment?")).toHaveCount(0);

      // Then confirm: the claims go back to pending and the payment flips
      // back to unmatched (visible again without the toggle).
      await row1.getByRole("button", { name: "Unmatch" }).click();
      await page.getByRole("button", { name: "Yes, unmatch" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "Payment unmatched — 1 claim back to pending" })).toBeVisible({ timeout: 10_000 });

      await page.getByLabel("Show matched").uncheck();
      await expect(page.locator("tr").filter({ hasText: data.d1!.email }).filter({ hasText: "$500.00" })).toContainText("Unmatched", {
        timeout: 10_000,
      });
    } finally {
      await context.close();
    }

    // d1's claim is pending again (fresh payment window).
    const d1 = await loginDonor(browser, data.d1!);
    try {
      await d1.page.goto("/donor/claims");
      await expect(d1.page.getByRole("heading", { name: "My Sponsorships" })).toBeVisible({ timeout: 10_000 });
      const claimRow = d1.page.locator("tr").filter({ hasText: BIO_A });
      await expect(claimRow).toContainText("Awaiting payment");
    } finally {
      await d1.context.close();
    }
  });
});
