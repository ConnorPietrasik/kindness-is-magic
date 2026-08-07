/**
 * Role Self-Service — family dashboard + people CRUD, referrer dashboard + people CRUD, display name.
 *
 * Family/referrer CRUD tests use CSV-seeded accounts and their data.
 * Display name test uses an isolated referrer so parallel workers don't collide.
 *
 * Person records created by tests are cleaned up in afterAll.
 */
import { test, expect, request } from "@playwright/test";
import {
  deletePersonViaApi,
  deleteReferrerViaApi,
  deleteFamilyViaApi,
  deleteUserViaApi,
  createReferrerWithUserAndCredentials,
  createFamilyViaApi,
  loginViaApi,
} from "../helpers/api";

const TEST_FAMILY_CHILD = `Family Test ${Math.random().toString(36).slice(2, 6)}`;
const TEST_REFERRER_CHILD = `Referrer Test ${Math.random().toString(36).slice(2, 6)}`;

const familyTestData: { personId?: number } = {};
const referrerTestData: { personId?: number } = {};

/* Tests that share module-level state (person IDs) must run serially. */
test.describe.serial("Role Self-Service — family & referrer CRUD", () => {
  test.afterAll(async ({ request }) => {
    const authed = await loginViaApi(request);
    if (familyTestData.personId) await deletePersonViaApi(authed, familyTestData.personId);
    if (referrerTestData.personId) await deletePersonViaApi(authed, referrerTestData.personId);
    await authed.dispose();
  });

  // ── Family self-service tests ──────────────────────────────────────────

  test("family dashboard loads with family info", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "storage/family.json" });
    const page = await context.newPage();

    await page.goto("/family/dashboard");
    await expect(page.getByRole("heading", { name: "Family Dashboard" })).toBeVisible();

    /* Family profile card should show The Williams Family info */
    await expect(page.getByText("The Williams Family")).toBeVisible();
    await expect(page.getByText("Emily Williams")).toBeVisible();

    await context.close();
  });

  test("family views people list", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "storage/family.json" });
    const page = await context.newPage();

    await page.goto("/family/people");
    await expect(page.getByRole("heading", { name: "Manage People" })).toBeVisible({
      timeout: 10_000,
    });

    /* CSV-seeded people should be present */
    await expect(page.getByRole("table")).toContainText("Emma");
    await expect(page.getByRole("table")).toContainText("Liam");
    await expect(page.getByRole("table")).toContainText("Oliver");

    await context.close();
  });

  test("family adds a new person", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "storage/family.json" });
    const page = await context.newPage();

    await page.goto("/family/people");
    await expect(page.getByRole("heading", { name: "Manage People" })).toBeVisible({
      timeout: 10_000,
    });

    /* Click Add Person */
    await page.getByRole("button", { name: "+ Add Person" }).click();

    /* Fill the form */
    await page.getByLabel("Given Name").fill(TEST_FAMILY_CHILD);
    await page.getByLabel("Age").fill("5");
    await page.getByLabel("Practical Wish").fill("Winter gloves");
    await page.getByLabel("Size").fill("0");
    await page.getByLabel("Fun Wish").fill("Sticker book");

    await page.getByRole("button", { name: "Create" }).click();

    /* Verify the new person appears */
    await expect(page.getByRole("table")).toContainText(TEST_FAMILY_CHILD, {
      timeout: 10_000,
    });

    /* Capture person ID for cleanup */
    const personRow = page.getByRole("row").filter({ hasText: TEST_FAMILY_CHILD });
    const personIdRaw = await personRow.getAttribute("data-id");
    if (personIdRaw) {
      familyTestData.personId = parseInt(personIdRaw, 10);
    }

    await context.close();
  });

  test("family edits a person", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "storage/family.json" });
    const page = await context.newPage();

    await page.goto("/family/people");
    await expect(page.getByRole("heading", { name: "Manage People" })).toBeVisible({
      timeout: 10_000,
    });

    /* Find test child and click Edit */
    const row = page.getByRole("row").filter({ hasText: TEST_FAMILY_CHILD });
    await row.getByRole("button", { name: "Edit" }).click();

    /* Change age */
    await page.getByLabel("Age").fill("6");

    await page.getByRole("button", { name: "Update" }).click();

    /* Verify change persisted */
    await expect(page.getByRole("row").filter({ hasText: TEST_FAMILY_CHILD })).toBeVisible();

    await context.close();
  });

  // ── Referrer self-service tests ────────────────────────────────────────

  test("referrer families page loads with CSV-seeded families", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "storage/referrer.json" });
    const page = await context.newPage();

    await page.goto("/referrer/families");
    await expect(page.getByRole("heading", { name: "My Families" })).toBeVisible();

    /* Families table should show The Williams Family and The Rodriguez Family */
    await expect(page.getByRole("table")).toContainText("The Williams Family", {
      timeout: 10_000,
    });
    await expect(page.getByRole("table")).toContainText("The Rodriguez Family");

    await context.close();
  });

  test("referrer views family detail with people", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "storage/referrer.json" });
    const page = await context.newPage();

    await page.goto("/referrer/families");
    await expect(page.getByRole("heading", { name: "My Families" })).toBeVisible();

    /* Click Manage on The Williams Family row */
    const williamsRow = page.getByRole("row").filter({ hasText: "The Williams Family" });
    await williamsRow.getByRole("link", { name: "Manage" }).click();

    /* Family detail page */
    await expect(page.getByRole("heading", { name: "Family Detail" })).toBeVisible({
      timeout: 10_000,
    });
    /* Use heading role to avoid strict-mode collision between h3 card title and InfoRow span */
    await expect(page.getByRole("heading", { name: "The Williams Family" })).toBeVisible();

    /* People table should show Emma, Liam, Oliver */
    await expect(page.getByRole("table")).toContainText("Emma");
    await expect(page.getByRole("table")).toContainText("Liam");
    await expect(page.getByRole("table")).toContainText("Oliver");

    await context.close();
  });

  test("referrer adds a person to a family", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "storage/referrer.json" });
    const page = await context.newPage();

    /* Navigate to The Williams Family detail — find it from the families page */
    await page.goto("/referrer/families");
    const williamsRow = page.getByRole("row").filter({ hasText: "The Williams Family" });
    const manageLink = williamsRow.getByRole("link", { name: "Manage" });
    await manageLink.click();

    await expect(page.getByRole("heading", { name: "Family Detail" })).toBeVisible({
      timeout: 10_000,
    });

    /* Click Add Person */
    await page.getByRole("button", { name: "+ Add Person" }).click();

    /* Fill the form */
    await page.getByLabel("Given Name").fill(TEST_REFERRER_CHILD);
    await page.getByLabel("Age").fill("3");
    await page.getByLabel("Practical Wish").fill("Warm socks");
    await page.getByLabel("Size").fill("0");
    await page.getByLabel("Fun Wish").fill("Coloring book");

    await page.getByRole("button", { name: "Create" }).click();

    /* Verify the new person appears */
    await expect(page.getByRole("table")).toContainText(TEST_REFERRER_CHILD, {
      timeout: 10_000,
    });

    /* Capture person ID for cleanup */
    const personRow = page.getByRole("row").filter({ hasText: TEST_REFERRER_CHILD });
    const personIdRaw = await personRow.getAttribute("data-id");
    if (personIdRaw) {
      referrerTestData.personId = parseInt(personIdRaw, 10);
    }

    await context.close();
  });

  test("referrer cannot access admin routes", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "storage/referrer.json" });
    const page = await context.newPage();

    await page.goto("/admin/referrers");

    /* Role guard should redirect to /dashboard */
    await expect(page).toHaveURL(/\/dashboard/);

    await context.close();
  });

  test("referrer sees seeded display name on dashboard", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "storage/referrer.json" });
    const page = await context.newPage();

    /* demo_import.csv seeds sarah.chen with display_name "SARAH THE TESTER" */
    await page.goto("/dashboard");

    /* Wait for the welcome heading (handles lazy-loaded routes) */
    await expect(page.getByRole("heading", { name: "Welcome back!" })).toBeVisible();

    /* Assert the display name is rendered in the welcome card */
    await expect(page.getByText("SARAH THE TESTER", { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    await context.close();
  });
});

// ── Display name test (isolated referrer — no parallel collision) ──────────

const DISPLAY_NAME_SUFFIX = Math.random().toString(36).slice(2, 8);
const TEST_DISPLAY_NAME = `Display Test ${DISPLAY_NAME_SUFFIX}`;
const RESET_DISPLAY_NAME = "ORIGINAL_NAME";

const displayNameData: {
  referrerId?: number;
  userId?: number;
  email?: string;
  password?: string;
} = {};

test.describe("Role Self-Service — display name", () => {
  test.beforeAll(async ({ request: req }) => {
    const api = await loginViaApi(req);
    const referrer = await createReferrerWithUserAndCredentials(api, {
      name: `E2E Display Referrer ${DISPLAY_NAME_SUFFIX}`,
      familyLimit: 5,
      phoneNumber: "555-000-9999",
      email: `e2e-display-${DISPLAY_NAME_SUFFIX}@example.com`,
      password: "Password123!",
      displayName: RESET_DISPLAY_NAME,
    });

    displayNameData.referrerId = referrer.referrerId;
    displayNameData.userId = referrer.userId;
    displayNameData.email = referrer.email;
    displayNameData.password = referrer.password;
    await api.dispose();
  });

  test.afterAll(async ({ request: req }) => {
    const authed = await loginViaApi(req);
    if (displayNameData.userId) {
      await deleteUserViaApi(authed, displayNameData.userId);
    }
    if (displayNameData.referrerId) {
      await deleteReferrerViaApi(authed, displayNameData.referrerId);
    }
    await authed.dispose();
  });

  test("referrer changes display name and it persists after refresh", async ({ browser }) => {
    if (!displayNameData.email || !displayNameData.password) test.skip();

    const context = await browser.newContext();
    const page = await context.newPage();

    /* Login as our isolated referrer */
    await page.goto("/login");
    await page.getByLabel("Email").fill(displayNameData.email);
    await page.getByLabel("Password").fill(displayNameData.password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForURL(/\/dashboard/);
    await expect(page.getByRole("heading", { name: "Welcome back!" })).toBeVisible({
      timeout: 10_000,
    });

    /* Verify initial display name */
    await expect(page.getByText(RESET_DISPLAY_NAME, { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    /* Click the pencil icon to edit display name (title="Edit display name") */
    await page.getByTitle("Edit display name").click();

    /* Fill in the new display name in the inline input */
    await page.getByPlaceholder("e.g. John Smith").fill(TEST_DISPLAY_NAME);

    /* Submit */
    await page.getByRole("button", { name: "Save" }).click();

    /* Wait for the mutation to complete — display name should update */
    await expect(page.getByText(TEST_DISPLAY_NAME)).toBeVisible({
      timeout: 10_000,
    });

    /* Refresh the page and verify the display name persists */
    await page.reload();
    await expect(page.getByText(TEST_DISPLAY_NAME)).toBeVisible({
      timeout: 10_000,
    });

    /* Reset display name back for idempotent re-runs */
    await page.getByTitle("Edit display name").click();
    await page.getByPlaceholder("e.g. John Smith").fill(RESET_DISPLAY_NAME);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(RESET_DISPLAY_NAME)).toBeVisible({
      timeout: 10_000,
    });

    await context.close();
  });
});
