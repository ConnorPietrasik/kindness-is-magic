/**
 * Admin — Sponsorships — cancelled sponsorships are invisible to every
 * other surface; the admin Sponsorships page is where operators find and
 * restore them. Four paths, all UI-driven:
 *
 *  1. Admin cancels an unpaid cash claim from the claim detail → it appears
 *     under the Cancelled filter on the Sponsorships page → restore brings
 *     it back.
 *  2. A donor cancels a gift claim → it appears with the donor's email and a
 *     disabled restore (gifts are not restorable).
 *  3. A paid cash claim: the cancel action is not offered at all.
 *  4. A sponsorship whose family was deleted: the claim stays readable and
 *     the non-enumerable family shows as #<pk>.
 *
 * Paths 1–2 create isolated donor + family scenarios so parallel workers
 * don't collide with each other or with CSV-seeded data. Paths 3–4 share a
 * PERSISTENT fixture (a paid cash claim under a fixed-named referrer): paid
 * sponsorships cannot be cancelled, so the fixture is created once and
 * reused on every run (found by donor-email search) instead of leaking one
 * orphan claim row per run.
 */
import { test, expect, request as playwrightRequest } from "@playwright/test";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import {
  createDonorWithUser,
  createIsolatedFamilyScenario,
  createReferrerWithUserAndCredentials,
  createFamilyViaApi,
  createPersonViaApi,
  approveWishChain,
  loginViaApi,
  deleteClaimViaApi,
  deleteFamilyViaApi,
  deleteReferrerViaApi,
  deleteUserViaApi,
} from "../helpers/api";
import { getAdminEmail } from "../helpers/env";

const STORAGE_ADMIN = "storage/admin.json";
const SUFFIX = Math.random().toString(36).slice(2, 8);

// Persistent paid-claim fixture (see ensurePaidFixture) — fixed identifiers
// so the claim is findable on every run.
const FIXTURE_TAG = "paid-sponsorship";
const FIXTURE_REFERRER_NAME = `E2E Ref ${FIXTURE_TAG}`;
const FIXTURE_REFERRER_EMAIL = `e2e-ref-${FIXTURE_TAG}@example.com`;
const FIXTURE_REFERRER_PASSWORD = "Password123!";
const FIXTURE_FAMILY_NAME = `E2E Family ${FIXTURE_TAG}`;

const testData: {
  donorUserId?: number;
  donorEmail?: string;
  donorPassword?: string;
  // scenario 1: admin's UNPAID cash claim (canceled + restored by the admin)
  cashReferrerId?: number;
  cashReferrerUserId?: number;
  cashFamilyId?: number;
  cashClaimId?: number;
  // scenario 2: the donor's GIFT claim (canceled by the donor)
  giftReferrerId?: number;
  giftReferrerUserId?: number;
  giftFamilyId?: number;
  giftClaimId?: number;
  // scenario 3: the PAID cash claim (cancel must not be offered) — PERSISTENT
  // fixture (not cleaned up in afterAll; its referrer/user ids are not tracked)
  paidFamilyId?: number;
  paidClaimId?: number;
} = {};

/** Log a user in through the UI (no storageState exists for dynamic users). */
async function loginUser(browser: Browser, email: string, password: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard/);
  return { context, page };
}

/** One isolated, fully-approved family scenario (setup only). */
async function seedFamily(api: Parameters<typeof createIsolatedFamilyScenario>[0], tag: string) {
  const scenario = await createIsolatedFamilyScenario(api, tag);
  await approveWishChain(api, scenario.familyId, scenario.referrerEmail, scenario.referrerPassword);
  return scenario;
}

/**
 * Persistent fixture: a PAID cash claim, created once and reused on every
 * run.
 *
 * Paid sponsorships cannot be cancelled, so a per-run paid claim would
 * outlive its cleanup (afterAll can only delete the family around it) and
 * leak one orphan row on the Sponsorships page per run. Instead the fixture
 * uses fixed identifiers: the claim's donor is a persistent referrer user
 * (cash claims belong to whoever creates them, and only admin/referrer can
 * create them directly), and it is found on later runs by the donor-email
 * search. Its family is hidden from the public browse while claimed, and
 * once the deleted-family test (the last one) deletes it and orphans the
 * claim, the claim is still found by donor-email — so steady state is one
 * claim + one donor + one (deleted) family, forever, instead of one more
 * per run.
 *
 * Crash recovery: an unpaid fixture claim (crashed before mark-paid, or
 * swept by the expiry loop) is repaired in place (restore + mark-paid);
 * a half-built fixture family/referrer is reused when fully approved, and
 * rebuilt (best-effort) otherwise; a fixture family soft-deleted by an
 * earlier run's deleted-family test is restored in place.
 */
async function ensurePaidFixture(api: Parameters<typeof createIsolatedFamilyScenario>[0]): Promise<{ claimId: number; familyId: number }> {
  // 1. Existing fixture claim (found by the persistent donor's email)
  const claimsResp = await api.get("/api/admin/claims", { params: { search: FIXTURE_REFERRER_EMAIL, page_size: 200 } });
  if (claimsResp.ok()) {
    const claims = ((await claimsResp.json()).claims ?? []) as Array<{
      id: number;
      commitment_type: string;
      paid_at: string | null;
      deleted_at: string | null;
      family: { id: number; deleted: boolean };
    }>;
    const cash = claims.find((c) => c.commitment_type === "cash" && c.paid_at != null) ?? claims.find((c) => c.commitment_type === "cash");
    if (cash) {
      if (cash.deleted_at != null) {
        const restored = await api.post(`/api/donor/claims/${cash.id}/restore`);
        if (!restored.ok()) throw new Error(`fixture restore failed (${restored.status()})`);
      }
      if (cash.paid_at == null) {
        const marked = await api.post(`/api/donor/claims/${cash.id}/mark-paid`, { data: {} });
        if (!marked.ok()) throw new Error(`fixture mark-paid failed (${marked.status()})`);
      }
      // The family may have been soft-deleted by an earlier run's
      // deleted-family test (the paid claim outlives it) — restore it so
      // every run starts from a paid claim under an ACTIVE family, which is
      // what the claim-detail menu assertions assume.
      if (cash.family.deleted) {
        const famRestored = await api.post(`/api/admin/families/${cash.family.id}/restore`);
        if (!famRestored.ok()) throw new Error(`fixture family restore failed (${famRestored.status()})`);
      }
      return { claimId: cash.id, familyId: cash.family.id };
    }
  }

  // 2. No claim (first run, or crashed run) — rebuild the missing pieces,
  // reusing a crashed run's fully-approved family when one survives.
  let familyId: number | null = null;
  const famsResp = await api.get("/api/admin/families", { params: { search_name: FIXTURE_FAMILY_NAME, page_size: 50 } });
  if (famsResp.ok()) {
    const fams = ((await famsResp.json()).families ?? []) as Array<{ id: number; wish_lock_level: string }>;
    familyId = fams.find((f) => f.wish_lock_level === "admin")?.id ?? null;
  }
  if (familyId == null) {
    let referrerId: number | null = null;
    const refsResp = await api.get("/api/admin/referrers", { params: { search: FIXTURE_REFERRER_NAME, page_size: 50 } });
    if (refsResp.ok()) {
      const refs = ((await refsResp.json()).referrers ?? []) as Array<{ id: number; name: string }>;
      referrerId = refs.find((r) => r.name === FIXTURE_REFERRER_NAME)?.id ?? null;
    }
    if (referrerId == null) {
      const referrer = await createReferrerWithUserAndCredentials(api, {
        name: FIXTURE_REFERRER_NAME,
        familyLimit: 5,
        phoneNumber: "555-000-9999",
        email: FIXTURE_REFERRER_EMAIL,
        password: FIXTURE_REFERRER_PASSWORD,
      });
      referrerId = referrer.referrerId;
    }
    const family = await createFamilyViaApi(api, referrerId, {
      familyName: FIXTURE_FAMILY_NAME,
      familyWish: "A warm blanket for everyone",
      contactName: `Contact ${FIXTURE_TAG}`,
      phoneNumber: "555-111-2222",
      address: "none",
    });
    await createPersonViaApi(api, family.familyId, {
      givenName: `Child ${FIXTURE_TAG}`,
      role: "son",
      age: 7,
      wish: "Warm winter coat",
      size: "7",
      funWish: "LEGO set",
    });
    await approveWishChain(api, family.familyId, FIXTURE_REFERRER_EMAIL, FIXTURE_REFERRER_PASSWORD);
    familyId = family.familyId;
  }

  // 3. The claim belongs to its creator — create it as the fixture referrer,
  // then mark it paid as admin (mark-paid is admin-only).
  const fixtureApi = await playwrightRequest.newContext();
  try {
    const login = await fixtureApi.post("/api/auth/login", { data: { email: FIXTURE_REFERRER_EMAIL, password: FIXTURE_REFERRER_PASSWORD } });
    if (!login.ok()) throw new Error(`fixture login failed (${login.status()})`);
    const claim = await fixtureApi.post(`/api/families/${familyId}/claim`, { data: { commitment_type: "cash" } });
    if (!claim.ok()) throw new Error(`fixture claim failed (${claim.status()})`);
    const claimId = (await claim.json()).id;
    const marked = await api.post(`/api/donor/claims/${claimId}/mark-paid`, { data: {} });
    if (!marked.ok()) throw new Error(`fixture mark-paid failed (${marked.status()})`);
    return { claimId, familyId };
  } finally {
    await fixtureApi.dispose();
  }
}

test.describe.serial("Admin — Sponsorships", () => {
  test.beforeAll(async ({ request: req }) => {
    const api = await loginViaApi(req);

    // Hygiene: restore any stale admin-owned, unpaid, soft-deleted cash claims
    // left by an earlier crashed run (they would collide with test 2's
    // "row disappears" assertion). Our own seeds happen below.
    // Claims whose family was also deleted can't be restored (404 — a family
    // deleted out from under a cancelled claim is not sponsorable again), so
    // they linger in the Cancelled filter as audit rows; test 2 narrows by
    // family name for exactly this reason.
    const stale = await api.get("/api/admin/claims", { params: { status: "cancelled", page_size: 200 } });
    if (stale.ok()) {
      for (const item of (await stale.json()).claims as Array<{ id: number; donor_email: string; paid_at: string | null }>) {
        if (item.donor_email === getAdminEmail() && item.paid_at == null) {
          const resp = await api.post(`/api/donor/claims/${item.id}/restore`);
          if (!resp.ok()) console.log(`stale restore of claim ${item.id}: ${resp.status()}`);
        }
      }
    }

    // Donor (scenario 2 owner)
    const donor = await createDonorWithUser(api, {
      email: `e2e-donor-${SUFFIX}@example.com`,
      password: "Password123!",
      displayName: `Cancelled Donor ${SUFFIX}`,
    });
    testData.donorUserId = donor.userId;
    testData.donorEmail = donor.email;
    testData.donorPassword = donor.password;

    // Scenario 1: admin's unpaid cash claim (recovery path)
    const cash = await seedFamily(api, SUFFIX);
    testData.cashReferrerId = cash.referrerId;
    testData.cashReferrerUserId = cash.referrerUserId;
    testData.cashFamilyId = cash.familyId;
    const cashClaim = await api.post(`/api/families/${cash.familyId}/claim`, { data: { commitment_type: "cash" } });
    if (!cashClaim.ok()) throw new Error(`cash claim seed failed (${cashClaim.status()})`);
    testData.cashClaimId = (await cashClaim.json()).id;

    // Scenario 2: the donor's gift claim
    const gift = await seedFamily(api, `${SUFFIX}-gift`);
    testData.giftReferrerId = gift.referrerId;
    testData.giftReferrerUserId = gift.referrerUserId;
    testData.giftFamilyId = gift.familyId;
    const donorApi = await playwrightRequest.newContext();
    await donorApi.post("/api/auth/login", { data: { email: donor.email, password: donor.password } });
    const giftClaim = await donorApi.post(`/api/families/${gift.familyId}/claim`, { data: { commitment_type: "gifts" } });
    if (!giftClaim.ok()) throw new Error(`gift claim seed failed (${giftClaim.status()})`);
    testData.giftClaimId = (await giftClaim.json()).id;
    await donorApi.dispose();

    // Scenario 3: the PAID cash claim — persistent fixture (see
    // ensurePaidFixture): created once, reused on every run, never cleaned up.
    const paid = await ensurePaidFixture(api);
    testData.paidFamilyId = paid.familyId;
    testData.paidClaimId = paid.claimId;

    await api.dispose();
  });

  test.afterAll(async ({ request: req }) => {
    const authed = await loginViaApi(req);
    // Clean up the per-run scenarios. The paid fixture is deliberately NOT
    // touched: paid claims cannot be cancelled, so deleting its family would
    // just orphan the claim (and re-creating it per run is what the fixture
    // design avoids).
    if (testData.cashClaimId) await deleteClaimViaApi(authed, testData.cashClaimId);
    if (testData.giftClaimId) await deleteClaimViaApi(authed, testData.giftClaimId);
    if (testData.cashFamilyId) await deleteFamilyViaApi(authed, testData.cashFamilyId);
    if (testData.giftFamilyId) await deleteFamilyViaApi(authed, testData.giftFamilyId);
    if (testData.cashReferrerId) await deleteReferrerViaApi(authed, testData.cashReferrerId);
    if (testData.giftReferrerId) await deleteReferrerViaApi(authed, testData.giftReferrerId);
    if (testData.cashReferrerUserId) await deleteUserViaApi(authed, testData.cashReferrerUserId);
    if (testData.giftReferrerUserId) await deleteUserViaApi(authed, testData.giftReferrerUserId);
    if (testData.donorUserId) await deleteUserViaApi(authed, testData.donorUserId);
    await authed.dispose();
  });

  test("admin cancels an unpaid cash sponsorship from the claim detail", async ({ browser }) => {
    if (!testData.cashClaimId) {
      test.skip();
      return;
    }

    const context = await browser.newContext({ storageState: STORAGE_ADMIN });
    const page = await context.newPage();
    try {
      await page.goto(`/donor/claims/${testData.cashClaimId}`);
      await expect(page.getByText("Awaiting payment")).toBeVisible();

      await page.getByRole("button", { name: "More actions" }).click();
      await page.getByRole("menuitem", { name: "Cancel sponsorship" }).click();
      await page.getByRole("button", { name: "Yes, cancel" }).click();
      await expect(page.getByText("Sponsorship cancelled")).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("admin sees the cancelled sponsorship and can restore it", async ({ browser }) => {
    if (!testData.cashClaimId) {
      test.skip();
      return;
    }

    const context = await browser.newContext({ storageState: STORAGE_ADMIN });
    const page = await context.newPage();
    try {
      await page.goto("/admin/sponsorships");
      // Narrow to this run's cancelled claim: the Cancelled filter is shared
      // across runs, and crashed runs can leave admin-owned claims whose
      // families were deleted in afterAll — unrestorable (see the hygiene
      // loop in beforeAll), so they linger in the list as audit rows.
      await page.getByLabel("Sponsorship status filter").selectOption("cancelled");
      await page.getByLabel("Search by donor email or family name").fill(`E2E Family ${SUFFIX}`);

      // The cancelled claim is visible — the list is keyed by donor email.
      // The search input debounces 1s before refetching, and toBeVisible
      // strict-mode-fails on the pre-search render — wait for the narrowing.
      const row = page.getByRole("row").filter({ hasText: getAdminEmail() });
      await expect(row).toHaveCount(1);
      await expect(row).toBeVisible();
      await expect(row).toContainText("cash");
      // The family name is shown (searchable by name, visible on the row)
      await expect(row).toContainText(`E2E Family ${SUFFIX}`);

      // Restore it
      await row.getByRole("button", { name: "Restore" }).click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(`E2E Family ${SUFFIX}`);
      await dialog.getByRole("button", { name: "Restore" }).click();

      // Success toast + the row disappears from the list
      await expect(page.getByRole("alert")).toContainText("restored");
      await expect(page.getByRole("row").filter({ hasText: getAdminEmail() })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("donor cancels a gift sponsorship; admin sees it with a disabled restore", async ({ browser }) => {
    if (!testData.donorEmail || !testData.donorPassword || !testData.giftClaimId) {
      test.skip();
      return;
    }

    // Donor cancels from the claim list
    const donor = await loginUser(browser, testData.donorEmail, testData.donorPassword!);
    try {
      await donor.page.goto("/donor/claims");
      await donor.page.getByRole("link", { name: "View" }).first().click();
      await expect(donor.page).toHaveURL(/\/donor\/claims\/\d+/);

      await donor.page.getByRole("button", { name: "More actions" }).click();
      await donor.page.getByRole("menuitem", { name: "Cancel sponsorship" }).click();
      await donor.page.getByRole("button", { name: "Yes, cancel" }).click();
      await expect(donor.page.getByText("Sponsorship cancelled")).toBeVisible();
    } finally {
      await donor.context.close();
    }

    // Admin sees the cancellation under the Cancelled filter — gifts cannot be restored
    const context = await browser.newContext({ storageState: STORAGE_ADMIN });
    const page = await context.newPage();
    try {
      await page.goto("/admin/sponsorships");
      await page.getByLabel("Sponsorship status filter").selectOption("cancelled");

      const row = page.getByRole("row").filter({ hasText: testData.donorEmail! });
      await expect(row).toBeVisible();
      await expect(row).toContainText("gifts");
      await expect(row).toContainText(`E2E Family ${SUFFIX}-gift`);

      const restore = row.getByRole("button", { name: "Restore" });
      await expect(restore).toBeDisabled();
      await expect(restore).toHaveAttribute("title", "Gift sponsorships cannot be restored");
    } finally {
      await context.close();
    }
  });

  test("paid cash claim: cancel is not offered", async ({ browser }) => {
    if (!testData.paidClaimId) {
      test.skip();
      return;
    }

    // Owner view: the claim belongs to the fixture referrer (claims belong
    // to their creator) — Edit details is offered, cancel is not
    const owner = await loginUser(browser, FIXTURE_REFERRER_EMAIL, FIXTURE_REFERRER_PASSWORD);
    try {
      await owner.page.goto(`/donor/claims/${testData.paidClaimId}`);
      await expect(owner.page.getByText("Paid", { exact: true })).toBeVisible();

      await owner.page.getByRole("button", { name: "More actions" }).click();
      await expect(owner.page.getByRole("menuitem", { name: "Edit details" })).toBeVisible();
      await expect(owner.page.getByRole("menuitem", { name: "Cancel sponsorship" })).toHaveCount(0);
    } finally {
      await owner.context.close();
    }

    // Admin view (non-owner): Mark fulfilled is offered, cancel still isn't
    const context = await browser.newContext({ storageState: STORAGE_ADMIN });
    const page = await context.newPage();
    try {
      await page.goto(`/donor/claims/${testData.paidClaimId}`);
      await page.getByRole("button", { name: "More actions" }).click();
      await expect(page.getByRole("menuitem", { name: "Mark fulfilled" })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "Cancel sponsorship" })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("view works on a sponsorship whose family was deleted", async ({ browser, request }) => {
    if (!testData.paidClaimId || !testData.paidFamilyId) {
      test.skip();
      return;
    }

    // The fixture family is active here — ensurePaidFixture restored it if
    // a previous run's pass through this test left it deleted. The 404
    // tolerance is only a safety net for the delete below.
    const authed = await loginViaApi(request);
    const resp = await authed.delete(`/api/admin/families/${testData.paidFamilyId}`);
    await authed.dispose();
    if (!resp.ok() && resp.status() !== 404) throw new Error(`family delete failed (${resp.status()})`);

    const context = await browser.newContext({ storageState: STORAGE_ADMIN });
    const page = await context.newPage();
    try {
      // The sponsorships row stays identifiable by the (now deleted)
      // family's name — the name, not the positional display ID, is stable.
      await page.goto("/admin/sponsorships");
      await page.getByLabel("Search by donor email or family name").fill(FIXTURE_REFERRER_EMAIL);
      const row = page.getByRole("row").filter({ hasText: FIXTURE_REFERRER_EMAIL });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(FIXTURE_FAMILY_NAME);

      // No 404 — the claim record stays readable; the non-enumerable family
      // shows as #<pk> (display IDs are positions among active families)
      await page.goto(`/donor/claims/${testData.paidClaimId}`);
      await expect(page.getByRole("heading", { name: `Family #${testData.paidFamilyId}` })).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
