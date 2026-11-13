/**
 * Public Families Browse — the /families donor browse page (role-downstream
 * covers the per-family wish list, not the browse page itself).
 *
 *  - Cards show fully-approved families only; unapproved families are hidden.
 *  - The member-count filters narrow the card list.
 *  - The sort button cycles family size / youngest age (both directions) and
 *    persists the choice in the URL.
 *
 * Cards show display ID + bio (no family names), so each family is identified
 * by a unique bio. Setup creates three families with distinct member counts
 * and ages; all data is API-created and cleaned up in afterAll.
 */
import { test, expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
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

/**
 * The families sharing a filtered list with our scenario families depend on
 * what concurrently-running e2e specs have alive on this shared stack, so
 * card assertions must never assume page 1 (page size 12). These helpers
 * walk the grid's pages instead.
 *
 * Two more hazards on this shared stack: (1) every filter/sort/page change
 * re-fetches and renders a FULL-PAGE spinner (grid + pagination unmounted
 * until the data lands), and (2) background refetches (window focus) plus
 * parallel specs' create/delete churn can re-render the list between any
 * two steps — page number, total, even which families are listed. So the
 * walks never trust their own bookkeeping: the list is settled before every
 * read/click, each page turn is verified against the "Showing X–Y of Z"
 * offset text, and positions are computed from that offset.
 */

/** Heading visible = the full-page spinner is gone = current data rendered. */
async function waitHeading(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Families Needing Gifts" })).toBeVisible({ timeout: 15_000 });
}

/** 1-based offset of the first card on the current page ("Showing X–Y of Z"). */
async function pageStart(page: Page): Promise<number> {
  // The text is absent on single-page lists (they show "N total" instead of a range) — keep it bounded.
  const text = await page
    .getByText(/Showing \d+\D+\d+ of \d+/)
    .first()
    .textContent({ timeout: 500 })
    .catch(() => null);
  const m = text?.match(/Showing (\d+)/);
  return m ? parseInt(m[1], 10) : 1;
}

/**
 * Click a pagination button and settle on the re-fetch it triggers. The
 * response latch is armed before the click so a slow fetch can't be missed;
 * the click is time-boxed because a concurrent re-render can detach or
 * disable the button between check and click.
 */
async function turnPage(page: Page, buttonName: string): Promise<void> {
  const resp = page
    .waitForResponse((r) => r.request().method() === "GET" && r.url().includes("/api/families"), {
      timeout: 15_000,
    })
    .catch(() => null);
  try {
    await page.getByRole("button", { name: buttonName }).click({ timeout: 3000 });
  } catch {
    // The list re-rendered under us — settle on the new state
    await waitHeading(page);
    return;
  }
  await resp;
  await waitHeading(page);
}

/** Jump to page 1 of the browse grid (no-op when already there / single page). */
async function gotoFirstPage(page: Page): Promise<void> {
  await waitHeading(page);
  const firstBtn = page.getByRole("button", { name: "First page" });
  // Only readable after settling: a missing button means a single-page list
  // (no page buttons on a single page), not a spinner.
  if ((await firstBtn.count()) === 0) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await firstBtn.isDisabled()) return; // already on page 1
    const before = await pageStart(page);
    await turnPage(page, "First page");
    const now = await pageStart(page);
    if (now === 1 || now !== before) return;
  }
}

/** Turn to the next page if one exists; returns false at the end of the list. */
async function gotoNextPage(page: Page): Promise<boolean> {
  await waitHeading(page);
  const nextBtn = page.getByRole("button", { name: "Next page" });
  for (let attempt = 0; attempt < 3; attempt++) {
    if ((await nextBtn.count()) === 0 || (await nextBtn.isDisabled())) return false;
    const before = await pageStart(page);
    await turnPage(page, "Next page");
    if ((await pageStart(page)) !== before) return true;
    // The turn lost to a background re-render — re-check the new state
  }
  return false;
}

/** Read the current page's cards into the positions map (1-based offset → 0-based index). */
async function readPageInto(page: Page, pos: Record<string, number | null>, bios: string[]): Promise<void> {
  const start = await pageStart(page);
  const texts = await cardTexts(page);
  for (const bio of bios) {
    if (pos[bio] == null) {
      const idx = texts.findIndex((t) => t.includes(bio));
      if (idx >= 0) pos[bio] = start - 1 + idx;
    }
  }
}

/** Return the card locator for the bio, walking pages to it (from page 1). */
async function findCard(page: Page, bio: string): Promise<Locator> {
  await gotoFirstPage(page);
  const card = page.locator("div.grid > a").filter({ hasText: bio });
  for (let turns = 0; turns <= 5; turns++) {
    if ((await card.count()) > 0) return card;
    if (turns === 5 || !(await gotoNextPage(page))) {
      throw new Error(`browse card "${bio}" not found (walked ${turns + 1} page(s))`);
    }
  }
  throw new Error(`browse card "${bio}" not found after 5 page turns`);
}

/**
 * Absolute (0-based) position of each bio across the grid's pages — one
 * forward walk from page 1, so it also covers cards on different pages.
 * Absent cards get null (only after every page was checked).
 */
async function cardPositions(page: Page, bios: string[]): Promise<Record<string, number | null>> {
  await gotoFirstPage(page);
  const pos: Record<string, number | null> = Object.fromEntries(bios.map((b) => [b, null]));
  for (let turns = 0; turns <= 5; turns++) {
    await readPageInto(page, pos, bios);
    if (bios.every((b) => pos[b] != null)) return pos;
    if (turns === 5 || !(await gotoNextPage(page))) {
      // End of the list — re-read once: a background refetch may have
      // re-rendered this page with different content after the last read.
      await readPageInto(page, pos, bios);
      return pos;
    }
  }
  return pos;
}

/** The filter inputs debounce 300ms before triggering a re-fetch. */
async function pastDebounce(page: Page): Promise<void> {
  await page.waitForTimeout(400);
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

    /* Narrow to ≤3-member families (demo CSV alone has more fully-approved
       families than one page holds). */
    await page.getByLabel("Max Family Members").fill("3");
    await pastDebounce(page);

    /* Approved A + B appear as cards (found by walking pages — concurrent
       e2e families may share the filtered list and push them past page 1);
       unapproved C is absent from every page. */
    const pos = await cardPositions(page, [BIO_A, BIO_B, BIO_C]);
    expect(pos[BIO_A]).not.toBeNull();
    expect(pos[BIO_B]).not.toBeNull();
    expect(pos[BIO_C]).toBeNull();

    /* Cards show member count + age range */
    const cardA = await findCard(page, BIO_A);
    await expect(cardA).toContainText("3 members");
    await expect(cardA).toContainText("Ages 3–40");

    const cardB = await findCard(page, BIO_B);
    await expect(cardB).toContainText("1 member");
    await expect(cardB).toContainText("Ages 25");
  });

  test("member-count filters narrow the card list", async ({ page }) => {
    await page.goto("/families");

    /* Start from a narrowed list (demo CSV has more approved families than
       one page holds). Positions are absolute across pages — concurrent e2e
       families may share the filtered list. */
    await page.getByLabel("Max Family Members").fill("3");
    await pastDebounce(page);
    let pos = await cardPositions(page, [BIO_A, BIO_B]);
    expect(pos[BIO_A]).not.toBeNull();
    expect(pos[BIO_B]).not.toBeNull();

    /* Min Family Members = 3 → only 3-member families: A stays, B (1 member) drops */
    await page.getByLabel("Min Family Members").fill("3");
    await pastDebounce(page);
    pos = await cardPositions(page, [BIO_A, BIO_B]);
    expect(pos[BIO_A]).not.toBeNull();
    expect(pos[BIO_B]).toBeNull();

    /* Clearing just the min restores B (Max Family Members = 3 still applies) */
    await page.getByLabel("Min Family Members").fill("");
    await pastDebounce(page);
    pos = await cardPositions(page, [BIO_A, BIO_B]);
    expect(pos[BIO_A]).not.toBeNull();
    expect(pos[BIO_B]).not.toBeNull();

    /* Max Family Members = 1 → only the 1-member family B */
    await page.getByLabel("Max Family Members").fill("1");
    await pastDebounce(page);
    pos = await cardPositions(page, [BIO_A, BIO_B]);
    expect(pos[BIO_B]).not.toBeNull();
    expect(pos[BIO_A]).toBeNull();

    /* Clear resets the filter inputs */
    await page.getByRole("button", { name: "Clear" }).click();
    await pastDebounce(page);
    await waitHeading(page);
    expect(await page.getByLabel("Min Family Members").inputValue()).toBe("");
    expect(await page.getByLabel("Max Family Members").inputValue()).toBe("");
  });

  test("sort button cycles options and persists the choice in the URL", async ({ page }) => {
    await page.goto("/families");
    /* Start from a narrowed list (demo CSV has more approved families than
       one page holds). Order is checked with absolute positions across
       pages — concurrent e2e families may share the filtered list. */
    await page.getByLabel("Max Family Members").fill("3");
    await pastDebounce(page);
    await expect(page.getByRole("button", { name: "Sort: Default" })).toBeVisible({ timeout: 10_000 });

    /* Family Size ↑ — 1-member B before 3-member A */
    await page.getByRole("button", { name: "Sort: Default" }).click();
    await expect(page.getByRole("button", { name: "Sort: Family Size ↑" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page).toHaveURL(/sort=person_count/);
    let pos = await cardPositions(page, [BIO_A, BIO_B]);
    expect(pos[BIO_B]).not.toBeNull();
    expect(pos[BIO_A]).not.toBeNull();
    expect(pos[BIO_B]!).toBeLessThan(pos[BIO_A]!);

    /* Family Size ↓ — A first */
    await page.getByRole("button", { name: "Sort: Family Size ↑" }).click();
    await expect(page.getByRole("button", { name: "Sort: Family Size ↓" })).toBeVisible();
    await expect(page).toHaveURL(/sort=-person_count/);
    pos = await cardPositions(page, [BIO_A, BIO_B]);
    expect(pos[BIO_A]).not.toBeNull();
    expect(pos[BIO_B]).not.toBeNull();
    expect(pos[BIO_A]!).toBeLessThan(pos[BIO_B]!);

    /* Youngest ↑ — A (youngest 3) before B (25) */
    await page.getByRole("button", { name: "Sort: Family Size ↓" }).click();
    await expect(page.getByRole("button", { name: "Sort: Youngest ↑" })).toBeVisible();
    await expect(page).toHaveURL(/sort=min_age/);
    pos = await cardPositions(page, [BIO_A, BIO_B]);
    expect(pos[BIO_A]).not.toBeNull();
    expect(pos[BIO_B]).not.toBeNull();
    expect(pos[BIO_A]!).toBeLessThan(pos[BIO_B]!);

    /* Youngest ↓ — B first */
    await page.getByRole("button", { name: "Sort: Youngest ↑" }).click();
    await expect(page.getByRole("button", { name: "Sort: Youngest ↓" })).toBeVisible();
    await expect(page).toHaveURL(/sort=-min_age/);
    pos = await cardPositions(page, [BIO_A, BIO_B]);
    expect(pos[BIO_B]).not.toBeNull();
    expect(pos[BIO_A]).not.toBeNull();
    expect(pos[BIO_B]!).toBeLessThan(pos[BIO_A]!);

    /* Back to Default — sort param removed from the URL */
    await page.getByRole("button", { name: "Sort: Youngest ↓" }).click();
    await expect(page.getByRole("button", { name: "Sort: Default" })).toBeVisible();
    await expect(page).not.toHaveURL(/sort=/);
  });
});
