/**
 * Purchaser Wish Cards — printable sheet of every wish assigned to a purchaser.
 *
 *  - Both entry points open the page: the dashboard "Wish Cards" tile and the
 *    header "Wish Cards" action on the Assigned Gifts page.
 *  - The sheet holds one card per assigned wish, grouped by family in the
 *    assigned-gifts list order — family-wish card first in each block, then
 *    people in id order with practical → fun → adult order — the same cards
 *    as the public sheet.
 *  - Cards are keyed by display IDs (no family PII); person cards carry role
 *    name + age + wish type (adult cards show no type label).
 *  - Print guarantees match the public sheet: 2×2 US Letter grid, unsplit
 *    cards, hidden chrome, @page margin 0.
 *
 * Self-contained: setup creates a referrer with two families (first: child
 * + adult, second: a single child) plus two fresh purchaser users (admin
 * API), assigns every wish of both families to the first purchaser, and
 * cleans everything up in afterAll.
 */
import { expect, test } from "@playwright/test";
import { loginAs } from "../helpers/auth";
import {
  batchAssignWishesViaApi,
  createFamilyViaApi,
  createPersonViaApi,
  createReferrerWithUser,
  deleteFamilyViaApi,
  deletePersonViaApi,
  deleteReferrerViaApi,
  deleteUserViaApi,
  listWishesViaApi,
  loginViaApi,
} from "../helpers/api";

const SUFFIX = Math.random().toString(36).slice(2, 8);
const PASSWORD = "Password123!";

/* Unique identifying texts — each card is located by its wish description */
const FAMILY_WISH_1 = `E2E pwc family wish 1 ${SUFFIX}`;
const PRACTICAL_WISH_1 = `E2E pwc coat wish ${SUFFIX}`;
const FUN_WISH_1 = `E2E pwc lego wish ${SUFFIX}`;
const ADULT_WISH_1 = `E2E pwc shoes wish ${SUFFIX}`;
const FAMILY_WISH_2 = `E2E pwc family wish 2 ${SUFFIX}`;
const PRACTICAL_WISH_2 = `E2E pwc scooter wish ${SUFFIX}`;
const FUN_WISH_2 = `E2E pwc kite wish ${SUFFIX}`;
const CHILD_NAME_1 = `Alice ${SUFFIX}`;
const ADULT_NAME_1 = `Bob ${SUFFIX}`;
const CHILD_NAME_2 = `Carol ${SUFFIX}`;

/* Created-ID trackers — populated in beforeAll, read in afterAll */
const testData: {
  referrerId?: number;
  referrerUserId?: number;
  familyIds: number[];
  personIds: number[];
  purchaserEmail: string;
  purchaserUserId?: number;
  emptyPurchaserEmail: string;
  emptyPurchaserUserId?: number;
} = {
  personIds: [],
  familyIds: [],
  purchaserEmail: `e2e-pwc-purchaser-${SUFFIX}@example.com`,
  emptyPurchaserEmail: `e2e-pwc-empty-${SUFFIX}@example.com`,
};

async function createPurchaserViaApi(request: import("@playwright/test").APIRequestContext, email: string): Promise<number> {
  const resp = await request.post("/api/admin/users", {
    data: { email, password: PASSWORD, role: "purchaser" },
  });
  if (!resp.ok()) {
    throw new Error(`createPurchaserViaApi(${email}) failed (${resp.status()}): ${await resp.text()}`);
  }
  const result = (await resp.json()) as { id: number };
  return result.id;
}

test.describe.serial("Purchaser Wish Cards", () => {
  test.beforeAll(async ({ request: req }) => {
    const api = await loginViaApi(req);

    const referrer = await createReferrerWithUser(api, {
      name: `E2E PWC Ref ${SUFFIX}`,
      familyLimit: 5,
      phoneNumber: "555-000-9998",
      email: `e2e-pwc-ref-${SUFFIX}@example.com`,
      password: PASSWORD,
    });
    testData.referrerId = referrer.referrerId;
    testData.referrerUserId = referrer.userId;

    /* Family 1: child (practical + fun) + adult (adult) → 4 cards */
    const fam1 = await createFamilyViaApi(api, referrer.referrerId, {
      familyName: `E2E PWC Family A ${SUFFIX}`,
      familyWish: FAMILY_WISH_1,
      contactName: `PWC Contact A ${SUFFIX}`,
      phoneNumber: "555-222-3333",
      address: `1 PWC Lane ${SUFFIX}`,
    });
    testData.familyIds.push(fam1.familyId);
    const child1 = await createPersonViaApi(api, fam1.familyId, {
      givenName: CHILD_NAME_1,
      role: "son",
      age: 7,
      wish: PRACTICAL_WISH_1,
      size: "7",
      funWish: FUN_WISH_1,
    });
    testData.personIds.push(child1.personId);
    const adult1 = await createPersonViaApi(api, fam1.familyId, {
      givenName: ADULT_NAME_1,
      role: "father",
      age: 40,
      wish: ADULT_WISH_1,
      color: "Blue",
    });
    testData.personIds.push(adult1.personId);

    /* Family 2: single child (practical + fun) → 3 cards */
    const fam2 = await createFamilyViaApi(api, referrer.referrerId, {
      familyName: `E2E PWC Family B ${SUFFIX}`,
      familyWish: FAMILY_WISH_2,
      contactName: `PWC Contact B ${SUFFIX}`,
      phoneNumber: "555-333-4444",
      address: `2 PWC Lane ${SUFFIX}`,
    });
    testData.familyIds.push(fam2.familyId);
    const child2 = await createPersonViaApi(api, fam2.familyId, {
      givenName: CHILD_NAME_2,
      role: "daughter",
      age: 9,
      wish: PRACTICAL_WISH_2,
      funWish: FUN_WISH_2,
    });
    testData.personIds.push(child2.personId);

    /* Two purchasers: the assigned one and an empty one (empty-state test) */
    testData.purchaserUserId = await createPurchaserViaApi(api, testData.purchaserEmail);
    testData.emptyPurchaserUserId = await createPurchaserViaApi(api, testData.emptyPurchaserEmail);

    /* Assign every wish of both families to the purchaser */
    for (const familyId of testData.familyIds) {
      const { wishes } = await listWishesViaApi(api, { familyId });
      await batchAssignWishesViaApi(api, wishes.map((w) => w.id), testData.purchaserUserId);
    }

    await api.dispose();
  });

  test.afterAll(async ({ request: req }) => {
    const authed = await loginViaApi(req);
    for (const personId of testData.personIds) await deletePersonViaApi(authed, personId);
    for (const familyId of testData.familyIds) await deleteFamilyViaApi(authed, familyId);
    if (testData.purchaserUserId) await deleteUserViaApi(authed, testData.purchaserUserId);
    if (testData.emptyPurchaserUserId) await deleteUserViaApi(authed, testData.emptyPurchaserUserId);
    if (testData.referrerUserId) await deleteUserViaApi(authed, testData.referrerUserId);
    if (testData.referrerId) await deleteReferrerViaApi(authed, testData.referrerId);
    await authed.dispose();
  });

  test("dashboard tile and assigned-gifts header both open the wish cards page", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    /* Purchasers land on /dashboard after login */
    await loginAs(page, { email: testData.purchaserEmail, password: PASSWORD });
    await expect(page).toHaveURL("/dashboard");

    /* Dashboard tile entry point */
    await page.getByRole("link", { name: "Wish Cards" }).click();
    await expect(page).toHaveURL("/purchaser/wish-cards");
    await expect(page.getByRole("heading", { name: "Wish Cards" })).toBeVisible({ timeout: 10_000 });

    /* Assigned-gifts header entry point */
    await page.goto("/purchaser/assigned-gifts");
    await expect(page.getByRole("heading", { name: "Assigned Gifts" })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("link", { name: "Wish Cards", exact: true }).click();
    await expect(page).toHaveURL("/purchaser/wish-cards");

    await context.close();
  });

  test("renders one card per assigned wish, grouped by family in list order", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await loginAs(page, { email: testData.purchaserEmail, password: PASSWORD });
    await page.goto("/purchaser/wish-cards");
    const cards = page.locator("article.wish-card");
    await expect(cards).toHaveCount(7, { timeout: 10_000 });

    /* Each assigned wish lands on exactly one card */
    for (const desc of [FAMILY_WISH_1, PRACTICAL_WISH_1, FUN_WISH_1, ADULT_WISH_1, FAMILY_WISH_2, PRACTICAL_WISH_2, FUN_WISH_2]) {
      await expect(cards.filter({ hasText: desc })).toHaveCount(1);
    }

    /* Flat display IDs: {referrer id}-{family pos}-{person pos}{suffix}.
       Our referrer's families are positions 1 and 2; people are in id order. */
    const ref = testData.referrerId;
    const monoIds = await cards.locator("span.font-mono").allTextContents();
    expect(monoIds).toEqual([
      `#${ref}-1-F`,
      `#${ref}-1-1A`,
      `#${ref}-1-1B`,
      `#${ref}-1-2X`,
      `#${ref}-2-F`,
      `#${ref}-2-1A`,
      `#${ref}-2-1B`,
    ]);

    /* Person cards carry role name, age, wish type, and size/color */
    const practical1 = cards.nth(1);
    await expect(practical1).toContainText(`Son ${CHILD_NAME_1}`);
    await expect(practical1).toContainText("Age 7 · Practical");
    await expect(practical1).toContainText("Size: 7");

    const adult1 = cards.nth(3);
    await expect(adult1).toContainText(`Father ${ADULT_NAME_1}`);
    await expect(adult1).toContainText("Age 40");
    await expect(adult1).toContainText("Color: Blue");
    /* Adults get no wish-type label — the age line is exactly "Age 40"
       (a type label would extend it to "Age 40 · Adult"), so the assertion
       doesn't rely on the description text avoiding the word "Adult" */
    await expect(adult1.getByText("Age 40", { exact: true })).toBeVisible();

    /* Family cards: distinct style, no name/age/type — one per family block */
    const familyCards = page.locator("article.wish-card--family");
    await expect(familyCards).toHaveCount(2);
    await expect(familyCards.nth(0)).toContainText(FAMILY_WISH_1);
    await expect(familyCards.nth(1)).toContainText(FAMILY_WISH_2);
    await expect(familyCards.nth(0)).not.toContainText(/Age \d+/);
    await expect(familyCards.nth(0)).not.toContainText(CHILD_NAME_1);

    /* No family PII on the sheet — families are identified by display ID only */
    await expect(page.locator("body")).not.toContainText(`E2E PWC Family A ${SUFFIX}`);
    await expect(page.locator("body")).not.toContainText(`E2E PWC Family B ${SUFFIX}`);

    await context.close();
  });

  test("sheet is print-optimized: 2×2 grid, unsplit cards, hidden chrome", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await loginAs(page, { email: testData.purchaserEmail, password: PASSWORD });
    await page.goto("/purchaser/wish-cards");
    await expect(page.locator("article.wish-card")).toHaveCount(7, { timeout: 10_000 });

    /* The 2×2 grid (4 cards per US Letter page) holds on screen too */
    const grid = page.locator(".wish-cards-grid");
    expect(await grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length)).toBe(2);

    /* Print media: cards stay whole and the screen-only chrome disappears */
    await page.emulateMedia({ media: "print" });
    const cards = page.locator("article.wish-card");
    const count = await cards.count();
    for (let i = 0; i < count; i++) {
      expect(await cards.nth(i).evaluate((el) => getComputedStyle(el).breakInside)).toBe("avoid");
    }
    await expect(page.getByRole("button", { name: "Print" })).toBeHidden();
    /* The app header is screen chrome — it must not print */
    await expect(page.locator("header")).toBeHidden();

    /* @page margin 0 keeps the browser from drawing its print header/footer;
       the cards' own 0.25in margins (24px) keep content off the paper edge */
    const pageMargin = await page.evaluate(() => {
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          if (rule instanceof CSSPageRule) return rule.style.margin;
        }
      }
      return null;
    });
    expect(pageMargin).toBe("0px");
    expect(await cards.nth(0).evaluate((el) => getComputedStyle(el).marginTop)).toBe("24px");

    await context.close();
  });

  test("shows the empty state when nothing is assigned", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await loginAs(page, { email: testData.emptyPurchaserEmail, password: PASSWORD });
    await page.goto("/purchaser/wish-cards");

    await expect(page.getByText("No wishes to print yet.")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("article.wish-card")).toHaveCount(0);

    await context.close();
  });
});
