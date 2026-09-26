/**
 * Donor cart — cash sponsorship checkout (against the bundled Zeffy mock).
 *
 * The dev/e2e stack's backend is pointed at the `zeffy-mock` compose service
 * (ZEFFY_API_BASE in .env), so checkout and manual confirm run the real
 * reconciliation code without a single call to the real, org-rate-limited
 * Zeffy API. Tests skip (with a reason) when the mock or its .env wiring is
 * missing — see e2e/AGENTS.md.
 *
 * Cases:
 *  - the modal's cash option only fills the local cart ($500, +$100 after the
 *    groceries toggle); a carted family stays visible in the public browse
 *    and still claimable (cart ≠ claim)
 *  - checkout opens a popup whose URL carries only the donor's email —
 *    Zeffy can't pre-fill the amount, so the donor enters the total from the
 *    cart page's how-to-pay instructions (incl. setting the 11% Zeffy tip to
 *    $0, with a screenshot); the committed item renders "Awaiting payment"
 *  - a checked-out family is hidden from the default public list, shows
 *    "Awaiting payment" on the claims list, owner-only "payment pending"
 *    wording on the wish list, and the amber chip under the admin's
 *    include-claimed toggle
 *  - 409 race: a family claimed by another donor while it sits in the first
 *    donor's local cart is named in the toast and dropped
 *  - Remove (committed item) releases the family — it reappears in a second
 *    donor's default list, who can then claim it
 *  - manual confirm: stale payment ignored / mismatch banner / exact-amount
 *    payment applied → success panel
 *
 * Shared module state (donors, families, claim ids) → describe.serial.
 * All entities are API-created and cleaned up in afterAll.
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
  loginViaApi,
} from "../helpers/api";
import { getBaseUrl } from "../helpers/env";
import { getZeffyFormUrl, mockReset, mockSeedPayments, zeffyMockGate } from "../helpers/zeffy-mock";

/** Tag scoping this spec's mock payments (the suite runs fully parallel). */
const TAG = "donor-cart";
const SUFFIX = Math.random().toString(36).slice(2, 8);
const PASSWORD = "Password123!";
const BIO_A = `E2E Cart Family A ${SUFFIX}`;
const BIO_B = `E2E Cart Family B ${SUFFIX}`;
const BIO_C = `E2E Cart Family C ${SUFFIX}`;

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
  familyC?: number;
  personIds: number[];
  claimAId?: number;
  claimBId?: number;
  claimA2Id?: number;
  gate: string | null;
} = { d1: null, d2: null, personIds: [], gate: null };

/** Cancel every one of a donor's claims (cleanup path). */
async function cancelAllClaims(donor: Donor): Promise<void> {
  const ctx = await playwrightRequest.newContext({ baseURL: getBaseUrl() });
  try {
    await ctx.post("/api/auth/login", { data: { email: donor.email, password: PASSWORD } });
    const resp = await ctx.get("/api/donor/claims");
    if (resp.ok()) {
      const claims = (await resp.json()) as Array<{ id: number }>;
      for (const claim of claims) await ctx.delete(`/api/donor/claims/${claim.id}`);
    }
  } finally {
    await ctx.dispose();
  }
}

/** Login a per-test donor through the UI (no donor storageState exists). */
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

/** Wish list → claim modal → cash option → cart page (the local-cart path). */
async function addToCartViaModal(page: Page, familyId: number): Promise<void> {
  await page.goto(`/families/${familyId}/wish-list`);
  await page.getByRole("button", { name: "Sponsor this family" }).click();
  await expect(page.getByRole("heading", { name: "Sponsor This Family" })).toBeVisible({ timeout: 10_000 });
  await page.getByLabel("I'll provide monetary support").check();
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByRole("heading", { name: "Added to your cart" })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Go to cart & checkout" }).click();
  await expect(page).toHaveURL(/\/donor\/cart/);
}

/**
 * The browse page paginates 12 cards per page and the demo CSV seeds more
 * fully-approved families than one page — narrow to 1-member families so the
 * scenario cards share page 1 with the demo data. A filter change re-renders
 * the whole page as a spinner, so re-wait for the heading before asserting.
 */
async function filterToOneMember(page: Page): Promise<void> {
  await page.getByLabel("Max Family Members").fill("1");
  await expect(page.getByRole("heading", { name: "Families Needing Gifts" })).toBeVisible({ timeout: 10_000 });
}

test.describe.serial("Donor cart — cash sponsorship checkout (Zeffy mock)", () => {
  test.beforeAll(async ({ request: req }) => {
    data.gate = await zeffyMockGate();
    if (data.gate) return; // every test self-skips with the reason

    const admin = await loginViaApi(req);
    data.d1 = await createDonorWithUser(admin, {
      email: `e2e-cart-d1-${SUFFIX}@example.com`,
      password: PASSWORD,
      displayName: `Cart Donor One ${SUFFIX}`,
    });
    data.d2 = await createDonorWithUser(admin, {
      email: `e2e-cart-d2-${SUFFIX}@example.com`,
      password: PASSWORD,
      displayName: `Cart Donor Two ${SUFFIX}`,
    });

    const referrer = await createReferrerWithUserAndCredentials(admin, {
      name: `E2E Cart Ref ${SUFFIX}`,
      familyLimit: 5,
      phoneNumber: "555-000-8888",
      email: `e2e-cart-ref-${SUFFIX}@example.com`,
      password: PASSWORD,
    });
    data.referrerId = referrer.referrerId;
    data.referrerUserId = referrer.userId;

    const families: Array<["familyA" | "familyB" | "familyC", string]> = [
      ["familyA", BIO_A],
      ["familyB", BIO_B],
      ["familyC", BIO_C],
    ];
    for (const [key, bio] of families) {
      const family = await createFamilyViaApi(admin, referrer.referrerId, {
        familyName: bio,
        familyWish: `E2E cart wish ${SUFFIX}`,
        contactName: `Cart Contact ${SUFFIX}`,
        phoneNumber: "555-111-4444",
        address: `44 Cart Lane ${SUFFIX}`,
        bio,
      });
      data[key] = family.familyId;
      const person = await createPersonViaApi(admin, family.familyId, {
        givenName: `Cart Child ${SUFFIX}`,
        role: "son",
        age: 7,
        wish: `E2E cart coat ${SUFFIX}`,
        size: "7",
        funWish: `E2E cart LEGO set ${SUFFIX}`,
      });
      data.personIds.push(person.personId);
      await fullyApproveFamilyViaApi(admin, family.familyId);
    }
    await admin.dispose();
  });

  test.afterAll(async ({ request: req }) => {
    if (data.gate) return;
    if (data.d1) await cancelAllClaims(data.d1);
    if (data.d2) await cancelAllClaims(data.d2);
    await mockReset(TAG);
    const admin = await loginViaApi(req);
    for (const personId of data.personIds) await deletePersonViaApi(admin, personId);
    for (const familyId of [data.familyA, data.familyB, data.familyC]) {
      if (familyId) await deleteFamilyViaApi(admin, familyId);
    }
    if (data.d1) await deleteUserViaApi(admin, data.d1.userId);
    if (data.d2) await deleteUserViaApi(admin, data.d2.userId);
    if (data.referrerUserId) await deleteUserViaApi(admin, data.referrerUserId);
    if (data.referrerId) await deleteReferrerViaApi(admin, data.referrerId);
    await admin.dispose();
  });

  test("cash in the modal only fills the local cart — the family stays public and claimable", async ({ browser }) => {
    if (data.gate) {
      test.skip(true, data.gate);
      return;
    }
    const { context, page } = await loginDonor(browser, data.d1!);
    try {
      await addToCartViaModal(page, data.familyA!);
      const row = page.locator("li").filter({ hasText: BIO_A });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText("$500");
      // Groceries add-on: $500 → $600 on the row and in the total
      await row.locator('input[type="checkbox"]').check();
      await expect(row).toContainText("$600");
      // The totals row (the only border-t block on the page) shows the recomputed total
      const totalsRow = page.locator("div.border-t");
      await expect(totalsRow.getByText("Total (1 family)")).toBeVisible();
      await expect(totalsRow.getByText("$600")).toBeVisible();
    } finally {
      await context.close();
    }

    // No claim was created — the family is still in the default public list
    // and still claimable (anonymous visitor's view).
    const anonContext = await browser.newContext();
    const anon = await anonContext.newPage();
    try {
      await anon.goto("/families");
      await expect(anon.getByRole("heading", { name: "Families Needing Gifts" })).toBeVisible({ timeout: 10_000 });
      await filterToOneMember(anon);
      const card = anon.locator("main > div.grid > a").filter({ hasText: BIO_A });
      await expect(card).toHaveCount(1);
      await card.click();
      await expect(anon.getByRole("button", { name: "Sponsor this family" })).toBeVisible({ timeout: 10_000 });
    } finally {
      await anonContext.close();
    }
  });

  test("checkout opens the Zeffy popup with the donor's email (no amount pre-fill) and commits a pending claim", async ({ browser }) => {
    if (data.gate) {
      test.skip(true, data.gate);
      return;
    }
    await mockReset(TAG);
    const { context, page } = await loginDonor(browser, data.d1!);
    try {
      await addToCartViaModal(page, data.familyA!);
      const row = page.locator("li").filter({ hasText: BIO_A });
      await row.locator('input[type="checkbox"]').check(); // groceries → $600

      const [popup] = await Promise.all([
        page.waitForEvent("popup"),
        page.getByRole("button", { name: "Pay with Zeffy" }).click(),
      ]);
      await popup.waitForLoadState("domcontentloaded");
      const url = new URL(popup.url());
      expect(`${url.origin}${url.pathname}`).toBe(getZeffyFormUrl());
      // No amount in the URL — Zeffy forms can't pre-fill it; the donor
      // enters the total from the cart page's instructions
      expect(url.searchParams.has("Amount")).toBe(false);
      expect(url.searchParams.get("email")).toBe(data.d1!.email);
      // The mock form page echoes the params it received
      await expect(popup.locator("#params")).toContainText(`email=${data.d1!.email}`);
      await popup.close();

      // Waiting state with the committed (server-side) item
      await expect(page.getByRole("button", { name: "I completed my payment" })).toBeVisible({ timeout: 10_000 });
      // How-to-pay instructions: the exact amount (entered by hand) and the
      // tip-to-$0 note with the screenshot
      await expect(page.getByRole("heading", { name: "How to pay on Zeffy" })).toBeVisible();
      await expect(page.getByText("Enter $600 exactly as the donation amount")).toBeVisible();
      const tipScreenshot = page.getByRole("img", { name: /Help keep Zeffy free/ });
      await expect(tipScreenshot).toBeVisible();
      await expect(tipScreenshot).toHaveAttribute("src", "/zeffy-tip-zero.png");
      await expect(page.getByText(/no worries — an admin will match it manually/)).toBeVisible();
      await expect(page.getByText("If your payment doesn't match automatically, an admin will review it within a day.")).toBeVisible();
      const committed = page.locator("li").filter({ hasText: BIO_A });
      await expect(committed).toHaveCount(1);
      await expect(committed).toContainText("Awaiting payment");
      await expect(committed).toContainText("$600");

      // Record the committed claim id (cleanup + later tests)
      const api = await playwrightRequest.newContext({ baseURL: getBaseUrl() });
      try {
        await api.post("/api/auth/login", { data: { email: data.d1!.email, password: PASSWORD } });
        const cart = (await (await api.get("/api/donor/cart")).json()) as { items: Array<{ claim_id: number }> };
        expect(cart.items).toHaveLength(1);
        data.claimAId = cart.items[0].claim_id;
      } finally {
        await api.dispose();
      }
    } finally {
      await context.close();
    }
  });

  test("a checked-out family is hidden from the default browse and reads pending to its owner", async ({ browser }) => {
    if (data.gate) {
      test.skip(true, data.gate);
      return;
    }
    // Anonymous: hidden from the default list; the wish list still tells
    // every visitor the family is taken (no owner wording).
    const anonContext = await browser.newContext();
    const anon = await anonContext.newPage();
    try {
      await anon.goto("/families");
      await expect(anon.getByRole("heading", { name: "Families Needing Gifts" })).toBeVisible({ timeout: 10_000 });
      await filterToOneMember(anon);
      await expect(anon.locator("main > div.grid > a").filter({ hasText: BIO_A })).toHaveCount(0);
      await anon.goto(`/families/${data.familyA}/wish-list`);
      await expect(anon.getByText("This family is already sponsored")).toBeVisible({ timeout: 10_000 });
    } finally {
      await anonContext.close();
    }

    // Owner: "Awaiting payment" on the claims list + owner wish-list wording.
    const { context, page } = await loginDonor(browser, data.d1!);
    try {
      await page.goto("/donor/claims");
      await expect(page.getByRole("heading", { name: "My Sponsorships" })).toBeVisible({ timeout: 10_000 });
      const row = page.locator("tr").filter({ hasText: BIO_A });
      await expect(row).toContainText("Awaiting payment");
      await expect(row).toContainText("cash");
      await expect(row.getByRole("link", { name: "Go to checkout" })).toBeVisible();
      await page.goto(`/families/${data.familyA}/wish-list`);
      await expect(page.getByText("You are sponsoring this family — payment pending")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByRole("link", { name: "View sponsorship details →" })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("admin's include-claimed toggle reveals the family with the amber Awaiting payment chip", async ({ browser }) => {
    if (data.gate) {
      test.skip(true, data.gate);
      return;
    }
    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();
    try {
      await page.goto("/families");
      await expect(page.getByRole("heading", { name: "Families Needing Gifts" })).toBeVisible({ timeout: 10_000 });
      const card = page.locator("main > div.grid > a").filter({ hasText: BIO_A });
      await expect(card).toHaveCount(0);

      await page.getByLabel("Show sponsored families").check();
      await expect(page).toHaveURL(/include_claimed=true/);
      await filterToOneMember(page);
      await expect(card).toBeVisible({ timeout: 10_000 });
      await expect(card).toContainText("Awaiting payment");
    } finally {
      await context.close();
    }
  });

  test("checkout 409s when another donor claims a carted family — it is named and dropped", async ({ browser }) => {
    if (data.gate) {
      test.skip(true, data.gate);
      return;
    }
    const { context, page } = await loginDonor(browser, data.d1!);
    try {
      await addToCartViaModal(page, data.familyB!);
      const rowB = page.locator("li").filter({ hasText: BIO_B });
      await expect(rowB).toContainText("$500");
      // The committed family A (pending since the checkout test) is still listed
      const rowA = page.locator("li").filter({ hasText: BIO_A });
      await expect(rowA).toHaveCount(1);

      // Donor 2 gift-claims family B while it sits in donor 1's LOCAL cart
      const api = await playwrightRequest.newContext({ baseURL: getBaseUrl() });
      try {
        await api.post("/api/auth/login", { data: { email: data.d2!.email, password: PASSWORD } });
        const claimResp = await api.post(`/api/families/${data.familyB}/claim`, {
          data: { commitment_type: "gifts" },
        });
        expect(claimResp.ok()).toBe(true);
        data.claimBId = ((await claimResp.json()) as { id: number }).id;
      } finally {
        await api.dispose();
      }

      await page.getByRole("button", { name: "Pay with Zeffy" }).click();
      // The 409 detail names the family; the local item is dropped by id
      await expect(page.getByRole("alert").filter({ hasText: "was just sponsored" })).toBeVisible({ timeout: 10_000 });
      await expect(rowB).toHaveCount(0);
      // The committed family A is untouched
      await expect(rowA).toHaveCount(1);
    } finally {
      await context.close();
    }
  });

  test("removing a committed item releases the family — a second donor can claim it", async ({ browser }) => {
    if (data.gate) {
      test.skip(true, data.gate);
      return;
    }
    const { context, page } = await loginDonor(browser, data.d1!);
    try {
      await page.goto("/donor/cart");
      // Committed A (pending) + empty local cart → straight to the waiting state
      const rowA = page.locator("li").filter({ hasText: BIO_A });
      await expect(rowA).toHaveCount(1);
      await expect(page.getByRole("button", { name: "I completed my payment" })).toBeVisible({ timeout: 10_000 });

      await rowA.getByRole("button", { name: "Remove" }).click();
      await expect(page.getByText("Cancel this sponsorship?")).toBeVisible({ timeout: 10_000 });
      await page.getByRole("button", { name: "Yes, cancel" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "Sponsorship cancelled" })).toBeVisible();
      await expect(page.getByText("Your sponsorship cart is empty.")).toBeVisible({ timeout: 10_000 });
    } finally {
      await context.close();
    }

    // The family is back in the default public list…
    const anonContext = await browser.newContext();
    const anon = await anonContext.newPage();
    try {
      await anon.goto("/families");
      await expect(anon.getByRole("heading", { name: "Families Needing Gifts" })).toBeVisible({ timeout: 10_000 });
      await filterToOneMember(anon);
      await expect(anon.locator("main > div.grid > a").filter({ hasText: BIO_A })).toHaveCount(1);
    } finally {
      await anonContext.close();
    }

    // …and donor 2 can actually claim it (gifts, through the UI).
    const d2 = await loginDonor(browser, data.d2!);
    try {
      await d2.page.goto(`/families/${data.familyA}/wish-list`);
      await d2.page.getByRole("button", { name: "Sponsor this family" }).click();
      await expect(d2.page.getByRole("heading", { name: "Sponsor This Family" })).toBeVisible({ timeout: 10_000 });
      await d2.page.getByRole("button", { name: "Sponsor family" }).click();
      await expect(d2.page.getByRole("heading", { name: /You made Family .+'s Christmas magical/ })).toBeVisible({ timeout: 10_000 });
      await d2.page.getByRole("button", { name: "View your sponsorship" }).click();
      await d2.page.waitForURL(/\/donor\/claims\/\d+/);
      data.claimA2Id = Number(d2.page.url().split("/").pop());
    } finally {
      await d2.context.close();
    }
  });

  test("manual confirm: stale payment ignored, mismatch flagged, exact match pays the cart", async ({ browser }) => {
    if (data.gate) {
      test.skip(true, data.gate);
      return;
    }
    await mockReset(TAG);
    const { context, page } = await loginDonor(browser, data.d1!);
    try {
      await addToCartViaModal(page, data.familyC!);
      const rowC = page.locator("li").filter({ hasText: BIO_C });
      await expect(rowC).toContainText("$500"); // no groceries → $500

      const [popup] = await Promise.all([
        page.waitForEvent("popup"),
        page.getByRole("button", { name: "Pay with Zeffy" }).click(),
      ]);
      await popup.waitForLoadState("domcontentloaded");
      expect(new URL(popup.url()).searchParams.has("Amount")).toBe(false);
      await popup.close();

      const confirmBtn = page.getByRole("button", { name: "I completed my payment" });
      await expect(confirmBtn).toBeVisible({ timeout: 10_000 });
      const clickConfirm = () =>
        Promise.all([
          page.waitForResponse((r) => r.url().includes("/api/donor/cart/confirm")),
          confirmBtn.click(),
        ]);

      // 1) A payment OLDER than the cart's payment-window anchor is ignored
      //    (the reconciliation window keeps stale payments from matching).
      await mockSeedPayments(TAG, [{ email: data.d1!.email, amountUsd: 500, createdOffsetSeconds: -2 * 86_400 }]);
      await clickConfirm();
      await expect(confirmBtn).toBeEnabled();
      await expect(page.getByText(/We found a payment of/)).toHaveCount(0);

      // 2) A fresh payment with a different amount → the mismatch banner
      await mockSeedPayments(TAG, [{ email: data.d1!.email, amountUsd: 250 }]);
      await clickConfirm();
      await expect(page.getByText("We found a payment of $250, but your cart total is $500.")).toBeVisible({
        timeout: 10_000,
      });

      // 3) The exact-amount payment is applied → success panel
      await mockSeedPayments(TAG, [{ email: data.d1!.email, amountUsd: 500 }]);
      await clickConfirm();
      await expect(page.getByRole("heading", { name: "Your payment was received" })).toBeVisible({ timeout: 10_000 });
      await expect(page.getByRole("button", { name: "View my sponsorships" })).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
