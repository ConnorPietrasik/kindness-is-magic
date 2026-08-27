/**
 * Core Flow — complete end-to-end test of the primary user journey.
 *
 * Steps:
 *  1. Admin generates a referrer invite code
 *  2. Guest registers as a referrer using the code
 *  3. Admin approves the referrer
 *  4. Referrer views their dashboard (family invite code is visible)
 *  5. Guest registers as a family using the referrer's family invite code
 *  6. Referrer approves the family
 *  7. Family adds a person with wishes
 *  8. Family requests review
 *  9. Referrer sees the notification and approves wishes (submits to admin)
 * 10. Admin sees notification and approves wishes (fully approved)
 * 11. Guest views the public wish list
 *
 * Uses unique names per run so re-runs without a DB wipe don't collide.
 */
import { test, expect, request } from "@playwright/test";
import { getAdminEmail, getAdminPassword } from "../helpers/env";
import { findRowInTable } from "../helpers/assertions";

/* Unique test data so re-runs without a DB wipe don't collide */
const SUFFIX = Math.random().toString(36).slice(2, 8);
const TEST_REFERRER_NAME = `E2E Referrer ${SUFFIX}`;
const TEST_REFERRER_EMAIL = `e2e-ref-${SUFFIX}@example.com`;
const TEST_FAMILY_NAME = `E2E Family ${SUFFIX}`;
const TEST_FAMILY_EMAIL = `e2e-fam-${SUFFIX}@example.com`;
const TEST_CHILD_NAME = `Child ${SUFFIX}`;
const PASSWORD = "Password123!";

/* Track IDs for cleanup */
const testData: {
  referrerId?: number;
  familyId?: number;
  personId?: number;
} = {};

test.describe("Core Flow", () => {
  test.afterAll(async ({ request: req }) => {
    /* Login as admin so we can delete via admin endpoints */
    await req.post("/api/auth/login", {
      data: { email: getAdminEmail(), password: getAdminPassword() },
    });

    /* Clean up in reverse creation order */
    if (testData.personId) {
      await req.delete(`/api/admin/people/${testData.personId}`);
    }
    if (testData.familyId) {
      await req.delete(`/api/admin/families/${testData.familyId}`);
    }
    if (testData.referrerId) {
      await req.delete(`/api/admin/referrers/${testData.referrerId}`);
    }
  });

  test("full core flow: invite → register → approve → review → public wish list", async ({ browser }) => {
    /* Shared admin API context for lookups and cleanup */
    const adminApi = await request.newContext({ baseURL: "http://localhost" });
    await adminApi.post("/api/auth/login", {
      data: { email: getAdminEmail(), password: getAdminPassword() },
    });

    try {
      /* ═══════════════════════════════════════════════════════════
       * Step 1 — Admin generates a referrer invite code
       * ═══════════════════════════════════════════════════════════ */
      const adminContext = await browser.newContext({ storageState: "storage/admin.json" });
      const adminPage = await adminContext.newPage();

      await adminPage.goto("/admin/invite-codes");
      await expect(adminPage.getByRole("heading", { name: "Invite Codes" })).toBeVisible();

      await adminPage.getByRole("button", { name: "+ Generate New" }).click();
      await expect(adminPage.getByRole("heading", { name: "Generate Invite Code" })).toBeVisible();

      await adminPage.getByLabel("Family Limit").fill("5");
      await adminPage.getByRole("button", { name: "Generate" }).click();
      await expect(adminPage.getByText("Invite Code Generated")).toBeVisible({ timeout: 10_000 });

      const referrerInviteCode = (
        await adminPage.locator("div.font-mono.font-bold").textContent()
      )!.trim();
      expect(referrerInviteCode).toMatch(/^KRI-/);

      /* ═══════════════════════════════════════════════════════════
       * Step 2 — Guest registers as a referrer using the code
       * ═══════════════════════════════════════════════════════════ */
      const guestContext = await browser.newContext();
      const guestPage = await guestContext.newPage();

      await guestPage.goto("/register-referrer");
      await expect(guestPage.getByRole("heading", { name: "Referrer Registration" })).toBeVisible();

      await guestPage.getByLabel("Invite Code").fill(referrerInviteCode);
      await guestPage.getByLabel("Name").fill(TEST_REFERRER_NAME);
      await guestPage.getByLabel("Email").fill(TEST_REFERRER_EMAIL);
      await guestPage.getByLabel("Phone Number").fill("555-000-9999");
      await guestPage.getByRole("textbox", { name: "Password", exact: true }).fill(PASSWORD);
      await guestPage.getByLabel("Confirm Password").fill(PASSWORD);
      await guestPage.getByRole("button", { name: "Create Account" }).click();

      /* Auto-login → dashboard */
      await expect(guestPage).toHaveURL(/\/dashboard/, { timeout: 10_000 });
      await expect(guestPage.getByRole("heading", { name: "Welcome back!" })).toBeVisible();
      /* Pending referrer sees the approval banner */
      await expect(guestPage.getByText("pending approval")).toBeVisible({ timeout: 5_000 });

      await guestContext.close();

      /* ═══════════════════════════════════════════════════════════
       * Step 3 — Admin approves the referrer
       * ═══════════════════════════════════════════════════════════ */
      await adminPage.goto("/admin/referrers");
      await expect(adminPage.getByRole("heading", { name: "Manage Referrers" })).toBeVisible();

      /* Select "Pending" from approval status filter to reveal pending referrers */
      await adminPage.selectOption('[aria-label="Approval status filter"]', 'pending');

      /* Find the new referrer (may need to paginate through accumulated referrers) */
      const referrerRow = (await findRowInTable(adminPage, TEST_REFERRER_NAME))!;
      expect(referrerRow).not.toBeNull();

      /* Capture referrer ID for cleanup */
      const referrerIdRaw = await referrerRow.locator("td").first().textContent();
      if (referrerIdRaw) testData.referrerId = parseInt(referrerIdRaw!.trim(), 10);

      /* Click Approve → confirm dialog → confirm */
      await referrerRow.getByRole("button", { name: "Approve" }).click();
      await adminPage.getByRole("button", { name: "Yes, approve" }).click();

      /* Badge should update — wait for the row to no longer show pending buttons */
      await expect(referrerRow.getByRole("button", { name: "Approve" })).toBeHidden({ timeout: 10_000 });

      /* ═══════════════════════════════════════════════════════════
       * Step 4 — Referrer views dashboard (family invite code visible)
       * ═══════════════════════════════════════════════════════════ */
      const referrerContext = await browser.newContext();
      const referrerPage = await referrerContext.newPage();

      await referrerPage.goto("/login");
      await referrerPage.getByLabel("Email").fill(TEST_REFERRER_EMAIL);
      await referrerPage.getByLabel("Password").fill(PASSWORD);
      await referrerPage.getByRole("button", { name: "Sign in" }).click();
      await referrerPage.waitForURL(/\/dashboard/);
      await expect(referrerPage.getByRole("heading", { name: "Welcome back!" })).toBeVisible();

      /* Extract the family invite code from the Referrer Profile card */
      const familyInviteCode = (
        await referrerPage.locator('span:has-text("KFI-")').first().textContent()
      )!.trim();
      expect(familyInviteCode).toMatch(/^KFI-/);

      /* ═══════════════════════════════════════════════════════════
       * Step 5 — Guest registers as a family using the code
       * ═══════════════════════════════════════════════════════════ */
      const familyGuestContext = await browser.newContext();
      const familyGuestPage = await familyGuestContext.newPage();

      await familyGuestPage.goto("/register-family");
      await expect(familyGuestPage.getByRole("heading", { name: "Family Registration" })).toBeVisible();

      await familyGuestPage.getByLabel("Invite Code").fill(familyInviteCode);
      await familyGuestPage.getByLabel("Family Name").fill(TEST_FAMILY_NAME);
      await familyGuestPage.getByLabel("Family Wish").fill("A warm winter coat for everyone");
      await familyGuestPage.getByLabel("Contact Name").fill("Test Contact");
      await familyGuestPage.getByLabel("Email").fill(TEST_FAMILY_EMAIL);
      await familyGuestPage.getByRole("textbox", { name: "Password", exact: true }).fill(PASSWORD);
      await familyGuestPage.getByLabel("Confirm Password").fill(PASSWORD);
      await familyGuestPage.getByLabel("Phone Number").fill("555-111-2222");
      await familyGuestPage.getByRole("button", { name: "Create Account" }).click();

      /* Auto-login → family dashboard */
      await expect(familyGuestPage).toHaveURL(/\/family\/dashboard/, { timeout: 10_000 });
      await expect(familyGuestPage.getByRole("heading", { name: "Family Dashboard" })).toBeVisible();

      /* Capture family ID for cleanup (paginate if needed) */
      let familyFound: { id: number } | undefined;
      for (let page = 1; page <= 20; page++) {
        const familiesResp = await adminApi.get(`/api/admin/families?page=${page}&page_size=100`);
        const familiesData = (await familiesResp.json()) as {
          families: Array<{ id: number; family_name: string }>;
          total: number;
        };
        familyFound = familiesData.families.find((f) => f.family_name === TEST_FAMILY_NAME);
        if (familyFound) break;
        if (familiesData.families.length === 0) break; // no more pages
      }
      expect(familyFound).toBeTruthy();
      testData.familyId = familyFound!.id;

      await familyGuestContext.close();

      /* ═══════════════════════════════════════════════════════════
       * Step 6 — Referrer approves the family
       * ═══════════════════════════════════════════════════════════ */
      /* Referrer dashboard should show pending approval notification */
      await referrerPage.goto("/dashboard");
      await expect(referrerPage.getByRole("heading", { name: "Welcome back!" })).toBeVisible();
      await expect(referrerPage.getByText(/family.*awaiting your approval/)).toBeVisible({ timeout: 10_000 });

      /* Click the notification link to go to pending families */
      await referrerPage.getByRole("link", { name: /awaiting your approval/ }).click();
      await expect(referrerPage.getByRole("heading", { name: "Family Invites" })).toBeVisible({
        timeout: 10_000,
      });

      /* Wait for the family to appear in the pending table */
      await expect(referrerPage.getByRole("table")).toContainText(TEST_FAMILY_NAME, { timeout: 10_000 });

      /* Click Approve on the family row */
      const familyRow = referrerPage.getByRole("row").filter({ hasText: TEST_FAMILY_NAME });
      await familyRow.getByRole("button", { name: "Approve" }).click();

      /* Family should disappear from pending list */
      await expect(referrerPage.getByText("No families waiting for approval")).toBeVisible({ timeout: 10_000 });

      /* ═══════════════════════════════════════════════════════════
       * Step 7 — Family adds a person with wishes
       * ═══════════════════════════════════════════════════════════ */
      const familyContext = await browser.newContext();
      const familyPage = await familyContext.newPage();

      await familyPage.goto("/login");
      await familyPage.getByLabel("Email").fill(TEST_FAMILY_EMAIL);
      await familyPage.getByLabel("Password").fill(PASSWORD);
      await familyPage.getByRole("button", { name: "Sign in" }).click();
      await familyPage.waitForURL(/\/family\/dashboard/);
      await expect(familyPage.getByRole("heading", { name: "Family Dashboard" })).toBeVisible();

      /* Navigate to people management */
      await familyPage.goto("/family/people");
      await expect(familyPage.getByRole("heading", { name: "Manage People" })).toBeVisible({
        timeout: 10_000,
      });

      /* Click Add Person */
      await familyPage.getByRole("button", { name: "+ Add Person" }).click();

      /* Fill the form — age must be entered first to reveal wish fields */
      await familyPage.getByLabel("Given Name").fill(TEST_CHILD_NAME);
      await familyPage.getByLabel("Age").fill("7");

      /* Wait for wish fields to appear (they're conditionally rendered) */
      await expect(familyPage.getByLabel("Practical Wish")).toBeVisible({ timeout: 5_000 });

      await familyPage.getByLabel("Practical Wish").fill("Warm winter coat");
      await familyPage.getByLabel("Size").fill("7");
      await familyPage.getByLabel("Fun Wish").fill("LEGO set");
      await familyPage.getByRole("button", { name: "Create" }).click();

      /* Verify the person appears in the table */
      await expect(familyPage.getByRole("table")).toContainText(TEST_CHILD_NAME, { timeout: 10_000 });

      /* Capture person ID for cleanup */
      const personRow = familyPage.getByRole("row").filter({ hasText: TEST_CHILD_NAME });
      const personIdRaw = await personRow.getAttribute("data-id");
      if (personIdRaw) testData.personId = parseInt(personIdRaw, 10);

      /* ═══════════════════════════════════════════════════════════
       * Step 8 — Family requests review
       * ═══════════════════════════════════════════════════════════ */
      await familyPage.goto("/family/dashboard");
      await expect(familyPage.getByRole("heading", { name: "Family Dashboard" })).toBeVisible();

      /* Click "Request Review" */
      await familyPage.getByRole("button", { name: "Request Review" }).click();

      /* Confirm the dialog */
      await familyPage.getByRole("button", { name: "Yes, request review" }).click();

      /* Banner should change to "Awaiting referrer review" */
      await expect(familyPage.getByText("Awaiting referrer review")).toBeVisible({ timeout: 10_000 });

      /* ═══════════════════════════════════════════════════════════
       * Step 9 — Referrer sees notification and approves wishes
       * ═══════════════════════════════════════════════════════════ */
      await referrerPage.goto("/dashboard");
      await expect(referrerPage.getByRole("heading", { name: "Welcome back!" })).toBeVisible();

      /* Notification about wish review should appear */
      await expect(referrerPage.getByText(/awaiting your wish review/)).toBeVisible({ timeout: 10_000 });

      /* Click the notification link */
      await referrerPage.getByRole("link", { name: /awaiting your wish review/ }).click();
      await expect(referrerPage.getByRole("heading", { name: "Wish Review Queue" })).toBeVisible({
        timeout: 10_000,
      });

      /* Wait for the family to appear in the review queue */
      await expect(referrerPage.getByRole("table")).toContainText(TEST_FAMILY_NAME, { timeout: 10_000 });

      /* Click Approve on the review row */
      const reviewRow = referrerPage.getByRole("row").filter({ hasText: TEST_FAMILY_NAME });
      await reviewRow.getByRole("button", { name: "Approve" }).click();

      /* Queue should be empty after approval */
      await expect(referrerPage.getByText("No families awaiting wish review")).toBeVisible({ timeout: 10_000 });

      /* ═══════════════════════════════════════════════════════════
       * Step 10 — Admin sees notification and approves wishes
       * ═══════════════════════════════════════════════════════════ */
      await adminPage.goto("/dashboard");
      await expect(adminPage.getByRole("heading", { name: "Welcome back!" })).toBeVisible();

      /* Notification about wish approval should appear */
      await expect(adminPage.getByText(/awaiting your wish approval/)).toBeVisible({ timeout: 10_000 });

      /* Click the notification link */
      await adminPage.getByRole("link", { name: /awaiting your wish approval/ }).click();
      await expect(adminPage.getByRole("heading", { name: "Wish Approval Queue" })).toBeVisible({
        timeout: 10_000,
      });

      /* Wait for the family to appear in the admin review queue */
      await expect(adminPage.getByRole("table")).toContainText(TEST_FAMILY_NAME, { timeout: 10_000 });

      /* Click Approve */
      const adminReviewRow = adminPage.getByRole("row").filter({ hasText: TEST_FAMILY_NAME });
      await adminReviewRow.getByRole("button", { name: "Approve" }).click();

      /* Our family should leave the queue (the queue is global — parallel test
         files may legitimately leave their own rows behind) */
      await expect(adminReviewRow).toHaveCount(0, { timeout: 10_000 });

      /* ═══════════════════════════════════════════════════════════
       * Step 11 — Guest views the public wish list
       * ═══════════════════════════════════════════════════════════ */
      const publicContext = await browser.newContext();
      const publicPage = await publicContext.newPage();

      await publicPage.goto(`/families/${testData.familyId}/wish-list`);

      /* Page heading shows the display ID (numeric, e.g. "1" or "2-3") */
      await expect(
        publicPage.getByRole("heading", { name: /^\d+(?:-\d+)*$/ }),
      ).toBeVisible({ timeout: 10_000 });

      /* Family wish card is visible */
      await expect(publicPage.getByText("A warm winter coat for everyone")).toBeVisible();

      /* People table shows the child and their wishes */
      await expect(publicPage.getByRole("table")).toContainText(TEST_CHILD_NAME);
      await expect(publicPage.getByRole("table")).toContainText("Warm winter coat");
      await expect(publicPage.getByRole("table")).toContainText("LEGO set");

      /* ═══════════════════════════════════════════════════════════
       * Close all contexts
       * ═══════════════════════════════════════════════════════════ */
      await adminContext.close();
      await referrerContext.close();
      await familyContext.close();
      await publicContext.close();
    } finally {
      await adminApi.dispose();
    }
  });
});
