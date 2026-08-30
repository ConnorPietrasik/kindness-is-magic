/**
 * Donor Self-Service — donor home (shared dashboard), claim a family, view claims,
 * mark wishes as purchased, cancel claim.
 *
 * Creates an isolated donor user + family scenario so parallel workers
 * don't collide with each other or with CSV-seeded data.
 */
import { test, expect, request } from "@playwright/test";
import {
  createDonorWithUser,
  createIsolatedFamilyScenario,
  approveWishChain,
  loginViaApi,
  deleteFamilyViaApi,
  deleteReferrerViaApi,
  deleteUserViaApi,
} from "../helpers/api";

const SUFFIX = Math.random().toString(36).slice(2, 8);

const testData: {
  donorUserId?: number;
  donorEmail?: string;
  donorPassword?: string;
  referrerId?: number;
  familyId?: number;
} = {};

test.describe.serial("Donor Self-Service — claim lifecycle", () => {
  test.beforeAll(async ({ request: req }) => {
    const api = await loginViaApi(req);

    // Create donor user
    const donor = await createDonorWithUser(api, {
      email: `e2e-donor-${SUFFIX}@example.com`,
      password: "Password123!",
      displayName: `Donor ${SUFFIX}`,
    });
    testData.donorUserId = donor.userId;
    testData.donorEmail = donor.email;
    testData.donorPassword = donor.password;

    // Create isolated family scenario (referrer → family → person with wishes)
    const scenario = await createIsolatedFamilyScenario(api, SUFFIX);
    testData.referrerId = scenario.referrerId;
    testData.familyId = scenario.familyId;

    // Fully approve the family so it shows up in public families
    await approveWishChain(api, scenario.familyId, scenario.referrerEmail, scenario.referrerPassword);

    await api.dispose();
  });

  test.afterAll(async ({ request: req }) => {
    const authed = await loginViaApi(req);
    if (testData.donorUserId) await deleteUserViaApi(authed, testData.donorUserId);
    if (testData.familyId) await deleteFamilyViaApi(authed, testData.familyId);
    if (testData.referrerId) await deleteReferrerViaApi(authed, testData.referrerId);
    await authed.dispose();
  });

  // ── Donor dashboard ────────────────────────────────────────────────────

  test("donor lands on the shared dashboard with welcome card and gift claim cap", async ({ browser }) => {
    if (!testData.donorEmail || !testData.donorPassword) {
      test.skip();
      return;
    }

    const context = await browser.newContext();
    const page = await context.newPage();

    // Login as donor
    await page.goto("/login");
    await page.getByLabel("Email").fill(testData.donorEmail);
    await page.getByLabel("Password").fill(testData.donorPassword);
    await page.getByRole("button", { name: "Sign in" }).click();

    // Donors are redirected to the shared dashboard
    await page.waitForURL(/\/dashboard/);
    await expect(page.getByRole("heading", { name: "Welcome back!" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(`Donor ${SUFFIX}`)).toBeVisible();

    // Gift claim cap should show 0 / 5
    await expect(page.getByText("0 / 5")).toBeVisible();

    // Navigation cards should be present
    await expect(page.getByText("My Claims", { exact: true })).toBeVisible();
    await expect(page.getByText("Browse Families", { exact: true })).toBeVisible();

    await context.close();
  });

  // ── Header title link ──────────────────────────────────────────────────

  test("donor can return to the dashboard from the header title", async ({ browser }) => {
    if (!testData.donorEmail || !testData.donorPassword) {
      test.skip();
      return;
    }

    const context = await browser.newContext();
    const page = await context.newPage();

    // Login as donor
    await page.goto("/login");
    await page.getByLabel("Email").fill(testData.donorEmail);
    await page.getByLabel("Password").fill(testData.donorPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/dashboard/);

    // Go to a donor sub-page, then use the centred "Kindness is Magic" title to return home
    await page.getByRole("link", { name: "My Claims" }).click();
    await page.waitForURL(/\/donor\/claims/);

    await page.getByRole("link", { name: "Kindness is Magic" }).click();

    // Regression: donor was missing from /dashboard roles → redirect loop → white screen
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 10_000 });
    await expect(page.getByRole("heading", { name: "Welcome back!" })).toBeVisible();

    await context.close();
  });

  // ── Browse families and view wish list ─────────────────────────────────

  test("donor browses families and views wish list", async ({ browser }) => {
    if (!testData.donorEmail || !testData.donorPassword || !testData.familyId) {
      test.skip();
      return;
    }

    const context = await browser.newContext();
    const page = await context.newPage();

    // Login as donor
    await page.goto("/login");
    await page.getByLabel("Email").fill(testData.donorEmail);
    await page.getByLabel("Password").fill(testData.donorPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/dashboard/);

    // Navigate to browse families
    await page.getByRole("link", { name: "Browse Families" }).click();
    await expect(page.getByRole("heading", { name: "Families Needing Gifts" })).toBeVisible({
      timeout: 10_000,
    });

    // Navigate directly to the isolated family's wish list (cards show display_id, not family name)
    await page.goto(`/families/${testData.familyId}/wish-list`);
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });

    // Wish list should show the "Claim this family" button for authenticated claim-capable users
    await expect(page.getByRole("button", { name: "Claim this family" })).toBeVisible();

    await context.close();
  });

  // ── Claim a family ─────────────────────────────────────────────────────

  test("donor claims a family with gifts commitment", async ({ browser }) => {
    if (!testData.donorEmail || !testData.donorPassword || !testData.familyId) {
      test.skip();
      return;
    }

    const context = await browser.newContext();
    const page = await context.newPage();

    // Login as donor
    await page.goto("/login");
    await page.getByLabel("Email").fill(testData.donorEmail);
    await page.getByLabel("Password").fill(testData.donorPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/dashboard/);

    // Navigate to the family wish list directly
    await page.goto(`/families/${testData.familyId}/wish-list`);
    // Page heading is display_id (e.g. "10-1"); verify by checking family members section
    await expect(page.getByText("Family Members")).toBeVisible({ timeout: 10_000 });

    // Click "Claim this family" button
    await page.getByRole("button", { name: "Claim this family" }).click();

    // Claim modal should appear
    await expect(page.getByRole("heading", { name: "Claim This Family" })).toBeVisible({
      timeout: 10_000,
    });

    // Select "Gifts" commitment (should be default)
    await expect(page.getByLabel("I'll purchase the items on their wish list")).toBeChecked();

    // Submit the claim
    await page.getByRole("button", { name: "Claim Family" }).click();

    // Should navigate to claim detail page
    await page.waitForURL(/\/donor\/claims\/\d+/);
    await expect(page.getByText("Claim Details")).toBeVisible({ timeout: 10_000 });

    // Verify claim details
    await expect(page.getByText("gifts", { exact: true })).toBeVisible();

    await context.close();
  });

  // ── View claims list ───────────────────────────────────────────────────

  test("donor views claims list", async ({ browser }) => {
    if (!testData.donorEmail || !testData.donorPassword) {
      test.skip();
      return;
    }

    const context = await browser.newContext();
    const page = await context.newPage();

    // Login as donor
    await page.goto("/login");
    await page.getByLabel("Email").fill(testData.donorEmail);
    await page.getByLabel("Password").fill(testData.donorPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/dashboard/);

    // Navigate to claims list
    await page.getByRole("link", { name: "My Claims" }).click();
    await expect(page.getByRole("heading", { name: "My Claims" })).toBeVisible({
      timeout: 10_000,
    });

    // Claims table should show the claimed family
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByText("active", { exact: true })).toBeVisible();
    await expect(page.getByText("gifts", { exact: true })).toBeVisible();

    await context.close();
  });

  // ── View claim detail and mark wish as purchased ───────────────────────

  test("donor views claim detail and marks wish as purchased", async ({ browser }) => {
    if (!testData.donorEmail || !testData.donorPassword) {
      test.skip();
      return;
    }

    const context = await browser.newContext();
    const page = await context.newPage();

    // Login as donor
    await page.goto("/login");
    await page.getByLabel("Email").fill(testData.donorEmail);
    await page.getByLabel("Password").fill(testData.donorPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/dashboard/);

    // Navigate to claims list, then to claim detail
    await page.getByRole("link", { name: "My Claims" }).click();
    await expect(page.getByRole("heading", { name: "My Claims" })).toBeVisible({
      timeout: 10_000,
    });

    // Wait for the claims table to populate (React Query may lag behind heading render)
    await expect(page.getByRole("cell", { name: "Active" })).toBeVisible({ timeout: 10_000 });

    // Click "View" link on the claim row (styled as button but semantically a link)
    await page.getByRole("link", { name: "View" }).click();
    await expect(page.getByText("Claim Details")).toBeVisible({ timeout: 10_000 });

    // Should show the family members and their wishes
    await expect(page.getByText("Family Members & Wishes")).toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();

    // The family wish is part of the claim — shown above the members table
    await expect(page.getByText("Family Wish", { exact: true })).toBeVisible();
    await expect(page.getByText("A warm blanket for everyone")).toBeVisible();

    // For gifts claims, "Mark purchased" buttons should be visible
    const markPurchasedBtn = page.getByRole("button", { name: "Mark purchased" });
    const count = await markPurchasedBtn.count();
    expect(count).toBeGreaterThan(0);

    // Click the first "Mark purchased" button
    await markPurchasedBtn.first().click();

    // Mark purchased dialog should appear
    await expect(page.getByRole("heading", { name: /Mark as purchased/ })).toBeVisible({
      timeout: 10_000,
    });

    // Fill in purchase details
    await page.getByLabel("Purchased at").fill("Target");
    await page.getByLabel("Note").fill("Got a great deal");

    // Submit
    await page.getByRole("button", { name: "Mark Purchased", exact: true }).click();

    // Should show success toast and "Purchased" indicator
    await expect(page.getByText("✓ Purchased")).toBeVisible({ timeout: 10_000 });

    await context.close();
  });

  // ── Cancel claim ───────────────────────────────────────────────────────

  test("donor cancels a claim", async ({ browser }) => {
    if (!testData.donorEmail || !testData.donorPassword) {
      test.skip();
      return;
    }

    const context = await browser.newContext();
    const page = await context.newPage();

    // Login as donor
    await page.goto("/login");
    await page.getByLabel("Email").fill(testData.donorEmail);
    await page.getByLabel("Password").fill(testData.donorPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/dashboard/);

    // Navigate to claims list
    await page.getByRole("link", { name: "My Claims" }).click();
    await expect(page.getByRole("heading", { name: "My Claims" })).toBeVisible({
      timeout: 10_000,
    });

    // Wait for the claims table to populate
    await expect(page.getByRole("cell", { name: "Active" })).toBeVisible({ timeout: 10_000 });

    // Navigate to claim detail ("View" is a Link styled as a button)
    await page.getByRole("link", { name: "View" }).click();
    await expect(page.getByText("Claim Details")).toBeVisible({ timeout: 10_000 });

    // Open the actions dropdown (kebab menu with aria-label="More actions")
    await page.getByRole("button", { name: "More actions" }).click();

    // Click "Cancel Claim"
    await page.getByText("Cancel Claim").click();

    // Confirmation dialog should appear
    await expect(page.getByRole("button", { name: "Yes, cancel" })).toBeVisible({
      timeout: 10_000,
    });

    // Confirm cancellation
    await page.getByRole("button", { name: "Yes, cancel" }).click();

    // Should navigate away or show empty state
    await page.waitForTimeout(1000);

    // Navigate to claims list to verify claim is gone
    await page.goto("/donor/claims");
    await expect(page.getByRole("heading", { name: "My Claims" })).toBeVisible({
      timeout: 10_000,
    });

    // Should show empty state
    await expect(page.getByText("You haven't claimed any families yet.")).toBeVisible();

    await context.close();
  });
});
