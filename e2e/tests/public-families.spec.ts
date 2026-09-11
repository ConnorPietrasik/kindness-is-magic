/**
 * Public Families Browse — the /families donor browse page (role-downstream
 * covers the per-family wish list, not the browse page itself).
 *
 *  - Cards show fully-approved families only; unapproved families are hidden.
 *  - Member-count and age-range filters narrow the card list.
 *  - The sort button cycles family size / youngest age (both directions) and
 *    persists the choice in the URL.
 *
 * Cards show display ID + bio (no family names), so each family is identified
 * by a unique bio. Setup creates three families with distinct member counts
 * and ages; all data is API-created and cleaned up in afterAll.
 */
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  createReferrerWithUserAndCredentials,
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
/* Unique bios — the identifying text on the browse cards */
const BIO_A = `E2E browse family A ${SUFFIX}`;
const BIO_B = `E2E browse family B ${SUFFIX}`;
const BIO_C = `E2E browse family C ${SUFFIX}`;

/* Created-ID trackers — populated in beforeAll, read in afterAll */
const testData: {
  referrerId?: number;
  referrerUserId?: number;
  familyAId?: number;
  familyBId?: number;
  familyCId?: number;
  personIds: number[];
} = { personIds: [] };

/** Text of every card in the browse grid, in DOM (list) order. */
async function cardTexts(page: Page): Promise<string[]> {
  return page.locator("div.grid > a").evaluateAll((els) => els.map((el) => el.textContent ?? ""));
}

/** Index of the card containing the given bio (-1 if absent). */
async function cardIndex(page: Page, bio: string): Promise<number> {
  const texts = await cardTexts(page);
  return texts.findIndex((t) => t.includes(bio));
}

test.describe.serial("Public Families Browse", () => {
  test.beforeAll(async ({ request: req }) => {
    const api = await loginViaApi(req);

    const referrer = await createReferrerWithUserAndCredentials(api, {
      name: `E2E Browse Ref ${SUFFIX}`,
      familyLimit: 5,
      phoneNumber: "555-000-9999",
      email: `e2e-browse-ref-${SUFFIX}@example.com`,
      password: PASSWORD,
    });
    testData.referrerId = referrer.referrerId;
    testData.referrerUserId = referrer.userId;

    const contactName = `Browse Contact ${SUFFIX}`;
    const address = `10 Browse Avenue ${SUFFIX}`;
    const phone = "555-111-2222";

    /* Family A — 3 members, ages 3/7/40 → "3 members", "Ages 3–40" (approved) */
    const familyA = await createFamilyViaApi(api, referrer.referrerId, {
      familyName: `E2E Browse A ${SUFFIX}`,
      familyWish: `E2E browse wish A ${SUFFIX}`,
      contactName,
      phoneNumber: phone,
      address,
      bio: BIO_A,
    });
    testData.familyAId = familyA.familyId;
    for (const [role, age] of [
      ["son", 3],
      ["daughter", 7],
      ["father", 40],
    ] as const) {
      const person = await createPersonViaApi(api, familyA.familyId, {
        givenName: `${role[0].toUpperCase()}${role.slice(1)} ${SUFFIX}${age}`,
        role,
        age,
        wish: `E2E browse wish A ${SUFFIX} ${age}`,
        /* Children (under 18) require a fun wish as well */
        funWish: age < 18 ? `E2E browse fun A ${SUFFIX} ${age}` : undefined,
      });
      testData.personIds.push(person.personId);
    }
    await fullyApproveFamilyViaApi(api, familyA.familyId);

    /* Family B — 1 member, age 25 → "1 member", "Ages 25" (approved) */
    const familyB = await createFamilyViaApi(api, referrer.referrerId, {
      familyName: `E2E Browse B ${SUFFIX}`,
      familyWish: `E2E browse wish B ${SUFFIX}`,
      contactName,
      phoneNumber: phone,
      address,
      bio: BIO_B,
    });
    testData.familyBId = familyB.familyId;
    const personB = await createPersonViaApi(api, familyB.familyId, {
      givenName: `Mother ${SUFFIX}`,
      role: "mother",
      age: 25,
      wish: `E2E browse wish B ${SUFFIX}`,
    });
    testData.personIds.push(personB.personId);
    await fullyApproveFamilyViaApi(api, familyB.familyId);

    /* Family C — approved never; must stay hidden from the browse page */
    const familyC = await createFamilyViaApi(api, referrer.referrerId, {
      familyName: `E2E Browse C ${SUFFIX}`,
      familyWish: `E2E browse wish C ${SUFFIX}`,
      contactName,
      phoneNumber: phone,
      address,
      bio: BIO_C,
    });
    testData.familyCId = familyC.familyId;
    const personC = await createPersonViaApi(api, familyC.familyId, {
      givenName: `Child ${SUFFIX}`,
      role: "son",
      age: 5,
      wish: `E2E browse wish C ${SUFFIX}`,
      funWish: `E2E browse fun C ${SUFFIX}`,
    });
    testData.personIds.push(personC.personId);

    await api.dispose();
  });

  test.afterAll(async ({ request: req }) => {
    const authed = await loginViaApi(req);
    for (const personId of testData.personIds) await deletePersonViaApi(authed, personId);
    for (const familyId of [testData.familyAId, testData.familyBId, testData.familyCId]) {
      if (familyId) await deleteFamilyViaApi(authed, familyId);
    }
    if (testData.referrerUserId) await deleteUserViaApi(authed, testData.referrerUserId);
    if (testData.referrerId) await deleteReferrerViaApi(authed, testData.referrerId);
    await authed.dispose();
  });

  test("browse page shows fully-approved families and hides unapproved ones", async ({ page }) => {
    await page.goto("/families");
    await expect(page.getByRole("heading", { name: "Families Needing Gifts" })).toBeVisible({
      timeout: 10_000,
    });

    /* Approved families appear as cards with member count + age range */
    const cardA = page.locator("div.grid > a").filter({ hasText: BIO_A });
    await expect(cardA).toBeVisible({ timeout: 10_000 });
    await expect(cardA).toContainText("3 members");
    await expect(cardA).toContainText("Ages 3–40");

    const cardB = page.locator("div.grid > a").filter({ hasText: BIO_B });
    await expect(cardB).toBeVisible();
    await expect(cardB).toContainText("1 member");
    await expect(cardB).toContainText("Ages 25");

    /* Unapproved family is not listed */
    await expect(page.locator("div.grid > a").filter({ hasText: BIO_C })).toHaveCount(0);
  });

  test("member-count filters narrow the card list", async ({ page }) => {
    await page.goto("/families");
    const cardA = page.locator("div.grid > a").filter({ hasText: BIO_A });
    const cardB = page.locator("div.grid > a").filter({ hasText: BIO_B });
    await expect(cardA).toBeVisible({ timeout: 10_000 });
    await expect(cardB).toBeVisible();

    /* Min Members = 3 → only the 3-member family */
    await page.getByLabel("Min Members").fill("3");
    await expect(cardA).toBeVisible({ timeout: 10_000 });
    await expect(cardB).toHaveCount(0);

    /* Clear restores both, then Max Members = 1 → only the 1-member family */
    await page.getByRole("button", { name: "Clear" }).click();
    await expect(cardA).toBeVisible({ timeout: 10_000 });
    await expect(cardB).toBeVisible();

    await page.getByLabel("Max Members").fill("1");
    await expect(cardB).toBeVisible({ timeout: 10_000 });
    await expect(cardA).toHaveCount(0);

    await page.getByRole("button", { name: "Clear" }).click();
    await expect(cardA).toBeVisible({ timeout: 10_000 });
    await expect(cardB).toBeVisible();
  });

  test("age filters narrow the card list", async ({ page }) => {
    await page.goto("/families");
    const cardA = page.locator("div.grid > a").filter({ hasText: BIO_A });
    const cardB = page.locator("div.grid > a").filter({ hasText: BIO_B });
    await expect(cardA).toBeVisible({ timeout: 10_000 });
    await expect(cardB).toBeVisible();

    /* Min Age = 20 → youngest-in-family ≥ 20: excludes A (youngest 3), keeps B (25) */
    await page.getByLabel("Min Age").fill("20");
    await expect(cardB).toBeVisible({ timeout: 10_000 });
    await expect(cardA).toHaveCount(0);

    await page.getByRole("button", { name: "Clear" }).click();
    await expect(cardA).toBeVisible({ timeout: 10_000 });
    await expect(cardB).toBeVisible();
  });

  test("sort button cycles options and persists the choice in the URL", async ({ page }) => {
    await page.goto("/families");
    await expect(page.getByRole("button", { name: "Sort: Default" })).toBeVisible({ timeout: 10_000 });

    /* Family Size ↑ — 1-member B before 3-member A */
    await page.getByRole("button", { name: "Sort: Default" }).click();
    await expect(page.getByRole("button", { name: "Sort: Family Size ↑" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page).toHaveURL(/sort=person_count/);
    expect(await cardIndex(page, BIO_B)).toBeLessThan(await cardIndex(page, BIO_A));

    /* Family Size ↓ — A first */
    await page.getByRole("button", { name: "Sort: Family Size ↑" }).click();
    await expect(page.getByRole("button", { name: "Sort: Family Size ↓" })).toBeVisible();
    await expect(page).toHaveURL(/sort=-person_count/);
    expect(await cardIndex(page, BIO_A)).toBeLessThan(await cardIndex(page, BIO_B));

    /* Youngest ↑ — A (youngest 3) before B (25) */
    await page.getByRole("button", { name: "Sort: Family Size ↓" }).click();
    await expect(page.getByRole("button", { name: "Sort: Youngest ↑" })).toBeVisible();
    await expect(page).toHaveURL(/sort=min_age/);
    expect(await cardIndex(page, BIO_A)).toBeLessThan(await cardIndex(page, BIO_B));

    /* Youngest ↓ — B first */
    await page.getByRole("button", { name: "Sort: Youngest ↑" }).click();
    await expect(page.getByRole("button", { name: "Sort: Youngest ↓" })).toBeVisible();
    await expect(page).toHaveURL(/sort=-min_age/);
    expect(await cardIndex(page, BIO_B)).toBeLessThan(await cardIndex(page, BIO_A));

    /* Back to Default — sort param removed from the URL */
    await page.getByRole("button", { name: "Sort: Youngest ↓" }).click();
    await expect(page.getByRole("button", { name: "Sort: Default" })).toBeVisible();
    await expect(page).not.toHaveURL(/sort=/);
  });
});
