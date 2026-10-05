/**
 * Wish Cards — printable wish-card sheet (public page).
 *
 *  - The public wish list links to the /families/:id/wish-cards page.
 *  - The cards page shows one card per active wish — people in id order,
 *    each person's wishes in practical → fun → adult order — then the
 *    family-wish card last (distinct style, no name/age/wish type).
 *  - Person cards show the wish's display ID ("#" + owner's flat ID +
 *    type suffix) + role name + age + wish type (adult cards show no
 *    type label) + size/color; the family card shows the family wish's
 *    display ID ("#" + family ID + F).
 *  - The ID + logo are oversized for distance readability: the ID block
 *    takes ~2/3 of the card width (2× the logo's 1/3 cell), logo is 96px.
 *  - @page margin is 0 so the browser skips its print header/footer (date,
 *    title, URL); the cards' own 24px print margins keep content off the
 *    paper edge on every page.
 *  - The grid is 2×2 (4 cards per US Letter page), cards stay unsplit
 *    under print media, and screen chrome is hidden when printing.
 *
 * Self-contained: setup creates a reviewed family via the API — direct
 * (admin) creation (verified) + full approval (admin wish lock) — with a
 * child (practical + fun wishes), an adult (adult wish) and a family wish,
 * then cleans everything up in afterAll. The user path under test is
 * wish list → "Print wish cards" link → cards page (guest context — the
 * page is public; donors arriving from the email link may be logged out).
 */
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  createReferrerWithUser,
  createFamilyViaApi,
  createPersonViaApi,
  fullyApproveFamilyViaApi,
  deletePersonViaApi,
  deleteFamilyViaApi,
  deleteReferrerViaApi,
  deleteUserViaApi,
  loginViaApi,
} from "../helpers/api";

const SUFFIX = Math.random().toString(36).slice(2, 8);
const PASSWORD = "Password123!";

/* Unique identifying texts — each card is located by its wish description */
const CHILD_NAME = `Alice ${SUFFIX}`;
const ADULT_NAME = `Bob ${SUFFIX}`;
const PRACTICAL_WISH = `E2E coat wish ${SUFFIX}`;
const FUN_WISH = `E2E lego wish ${SUFFIX}`;
const ADULT_WISH = `E2E shoes wish ${SUFFIX}`;
const FAMILY_WISH = `E2E family wish ${SUFFIX}`;

/* Created-ID trackers — populated in beforeAll, read in afterAll */
const testData: {
  referrerId?: number;
  referrerUserId?: number;
  familyId?: number;
  personIds: number[];
} = { personIds: [] };

function familyId(): number {
  if (!testData.familyId) throw new Error("familyId not set — beforeAll failed?");
  return testData.familyId;
}

/**
 * Walk the real user path to the cards page: public wish list →
 * "Print wish cards" link. Returns the family's display ID (e.g. "3-2"),
 * read from the wish list heading, for the card display-ID assertions.
 */
async function openWishCards(page: Page, familyId: number): Promise<string> {
  await page.goto(`/families/${familyId}/wish-list`);
  const heading = page.getByRole("heading", { name: /^Family ID: / });
  await heading.waitFor({ state: "visible", timeout: 10_000 });

  /* Presentational display ID (e.g. "3-2") — read from the heading, never
     parsed out of a DB key. */
  const match = (await heading.innerText()).match(/\d+(?:-\d+)*/);
  if (!match) throw new Error(`No display ID in wish list heading: ${await heading.innerText()}`);

  await page.getByRole("link", { name: "Print wish cards →" }).click();
  await expect(page).toHaveURL(new RegExp(`/families/${familyId}/wish-cards$`));
  await expect(page.getByRole("heading", { name: "Wish Cards" })).toBeVisible({ timeout: 10_000 });
  return match[0];
}

test.describe.serial("Wish Cards", () => {
  test.beforeAll(async ({ request: req }) => {
    const api = await loginViaApi(req);

    const referrer = await createReferrerWithUser(api, {
      name: `E2E Cards Ref ${SUFFIX}`,
      familyLimit: 5,
      phoneNumber: "555-000-9999",
      email: `e2e-cards-ref-${SUFFIX}@example.com`,
      password: PASSWORD,
    });
    testData.referrerId = referrer.referrerId;
    testData.referrerUserId = referrer.userId;

    /* Direct (admin) creation → family is "verified"; full approval →
       admin wish lock: the reviewed state the public pages require. */
    const family = await createFamilyViaApi(api, referrer.referrerId, {
      familyName: `E2E Cards Family ${SUFFIX}`,
      familyWish: FAMILY_WISH,
      contactName: `Cards Contact ${SUFFIX}`,
      phoneNumber: "555-111-2222",
      address: `12 Cards Lane ${SUFFIX}`,
    });
    testData.familyId = family.familyId;

    /* Child (id order: first) — practical + fun wishes → 2 cards */
    const child = await createPersonViaApi(api, family.familyId, {
      givenName: CHILD_NAME,
      role: "son",
      age: 7,
      wish: PRACTICAL_WISH,
      size: "7",
      funWish: FUN_WISH,
    });
    testData.personIds.push(child.personId);

    /* Adult (id order: second) — single adult wish → 1 card */
    const adult = await createPersonViaApi(api, family.familyId, {
      givenName: ADULT_NAME,
      role: "father",
      age: 40,
      wish: ADULT_WISH,
      color: "Blue",
    });
    testData.personIds.push(adult.personId);

    await fullyApproveFamilyViaApi(api, family.familyId);
    await api.dispose();
  });

  test.afterAll(async ({ request: req }) => {
    const authed = await loginViaApi(req);
    for (const personId of testData.personIds) await deletePersonViaApi(authed, personId);
    if (testData.familyId) await deleteFamilyViaApi(authed, testData.familyId);
    if (testData.referrerUserId) await deleteUserViaApi(authed, testData.referrerUserId);
    if (testData.referrerId) await deleteReferrerViaApi(authed, testData.referrerId);
    await authed.dispose();
  });

  test("public wish list links to the wish cards page", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    /* Walk wish list → "Print wish cards" link (the helper's click fails if
       the link is missing, and it asserts the landing page) */
    await openWishCards(page, familyId());

    /* Intro copy explains the cards to the donor */
    await expect(page.getByText(/To help us stay organized, please print and attach each card to its gift/)).toBeVisible();
    await expect(page.getByText(/The numbers are each person's individual ID, and the final letter is the wish type/)).toBeVisible();

    await context.close();
  });

  test("renders one card per wish plus the family-wish card, in order", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    const famDisplayId = await openWishCards(page, familyId());
    const cards = page.locator("article.wish-card");

    /* 3 person wishes + 1 family wish → 4 cards */
    await expect(cards).toHaveCount(4, { timeout: 10_000 });

    /* Each wish lands on exactly one card */
    for (const desc of [PRACTICAL_WISH, FUN_WISH, ADULT_WISH, FAMILY_WISH]) {
      await expect(cards.filter({ hasText: desc })).toHaveCount(1);
    }

    /* Card order: child practical → child fun → adult adult → family */
    const texts = await cards.evaluateAll((els) => els.map((el) => el.textContent ?? ""));
    expect(texts[0]).toContain(PRACTICAL_WISH);
    expect(texts[1]).toContain(FUN_WISH);
    expect(texts[2]).toContain(ADULT_WISH);
    expect(texts[3]).toContain(FAMILY_WISH);

    /* Person cards carry the wish's own display ID: "#" + person flat ID
       (family ID + person position — people in id order → child 1, adult 2)
       + type suffix (practical A, fun B, adult X) */
    const [practicalCard, funCard, adultCard] = [cards.nth(0), cards.nth(1), cards.nth(2)];
    await expect(practicalCard.locator("span.font-mono")).toHaveText(`#${famDisplayId}-1A`);
    await expect(funCard.locator("span.font-mono")).toHaveText(`#${famDisplayId}-1B`);
    await expect(adultCard.locator("span.font-mono")).toHaveText(`#${famDisplayId}-2X`);

    /* ID + logo oversized for distance readability: huge mono ID in a block
       ≈ 2/3 of the card width, 96px logo in the remaining 1/3 cell */
    const practicalId = practicalCard.locator("span.font-mono");
    const [fontSize, textAlign] = await practicalId.evaluate((el) => {
      const s = getComputedStyle(el);
      return [s.fontSize, s.textAlign];
    });
    expect(fontSize).toBe("36px");
    expect(textAlign).toBe("right");
    const [idBlockW, logoCellW] = await practicalId.evaluate((el) => {
      const logoCell = el.parentElement?.firstElementChild;
      return [el.getBoundingClientRect().width, logoCell ? logoCell.getBoundingClientRect().width : 0];
    });
    expect(idBlockW).toBeCloseTo(logoCellW * 2, 0);
    expect(await practicalCard.locator("img").evaluate((el) => el.getBoundingClientRect().width)).toBeCloseTo(96, 0);

    /* Role name, age, wish type, and size/color (each only when set) */
    await expect(practicalCard).toContainText(`Son ${CHILD_NAME}`);
    await expect(practicalCard).toContainText("Age 7 · Practical");
    await expect(practicalCard).toContainText("Size: 7");
    await expect(practicalCard).not.toContainText("Color:");

    await expect(funCard).toContainText(`Son ${CHILD_NAME}`);
    await expect(funCard).toContainText("Age 7 · Fun");
    await expect(funCard).not.toContainText(/Size:|Color:/);

    await expect(adultCard).toContainText(`Father ${ADULT_NAME}`);
    await expect(adultCard).toContainText("Age 40");
    await expect(adultCard).toContainText("Color: Blue");
    await expect(adultCard).not.toContainText("Size:");
    /* Adults get no wish-type label — the age line stands on its own */
    await expect(adultCard).not.toContainText("Adult");

    /* The family card carries the family wish's display ID */
    await expect(page.locator("article.wish-card--family").locator("span.font-mono")).toHaveText(`#${famDisplayId}-F`);

    await context.close();
  });

  test("family-wish card has its own style and shows no name, age, or wish type", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await openWishCards(page, familyId());

    const familyCard = page.locator("article.wish-card--family");
    await expect(familyCard).toHaveCount(1, { timeout: 10_000 });

    /* Title + description, and last in the card set */
    await expect(familyCard.getByRole("heading", { name: "Family Wish" })).toBeVisible();
    await expect(familyCard).toContainText(FAMILY_WISH);
    const cards = page.locator("article.wish-card");
    expect(await cards.last().evaluate((el) => el.classList.contains("wish-card--family"))).toBe(true);

    /* No person identity: no given names, no age line, no wish-type label */
    await expect(familyCard).not.toContainText(CHILD_NAME);
    await expect(familyCard).not.toContainText(ADULT_NAME);
    await expect(familyCard).not.toContainText(/Age \d+/);
    await expect(familyCard).not.toContainText(/Practical|Fun|Adult/);

    await context.close();
  });

  test("cards page is print-optimized: 2×2 grid, unsplit cards, hidden chrome", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await openWishCards(page, familyId());

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

    /* @page margin 0 keeps the browser from drawing its print header/footer
       (date, title, URL); the cards' own 0.25in margins (24px) keep content
       off the paper edge on every page */
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
});
