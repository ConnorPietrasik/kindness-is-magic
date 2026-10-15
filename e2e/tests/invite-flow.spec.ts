/**
 * Invite and self-registration flow.
 *
 * This file needs two contexts: admin (to generate invite) + guest (to register).
 * Tests run as per-test (no shared context) because they need fresh unauthenticated state.
 *
 * Uses a random suffix on emails so re-runs without DB wipe don't collide.
 */
import { test, expect } from "@playwright/test";
import {
  deleteUserViaApi,
  listReferrersViaApi,
  listUsersViaApi,
  loginViaApi,
  resetReferrerSentEmailsViaApi,
} from "../helpers/api";

/* Unique suffix so re-runs without a DB wipe don't hit "Email already registered" */
const SUFFIX = Math.random().toString(36).slice(2, 8);

test.describe("Invite and self-registration", () => {
  /* Referrer users created via UI self-registration — look up by unique email
     and delete (the second registration attempt in the reject test fails, so
     no user exists for second-user-invite) */
  test.afterAll(async ({ request: req }) => {
    const authed = await loginViaApi(req);
    for (const email of [`e2e-invite-${SUFFIX}@example.com`, `first-user-invite-${SUFFIX}@example.com`]) {
      const users = await listUsersViaApi(authed, "referrer", email);
      const user = users.users.find((u) => u.email === email);
      if (user) await deleteUserViaApi(authed, user.id);
    }
    await authed.dispose();
  });

  test("admin generates invite code and referrer self-registers", async ({ browser }) => {
    /* ── Step 1: Admin generates invite code ── */
    const adminContext = await browser.newContext({
      storageState: "storage/admin.json",
    });
    const adminPage = await adminContext.newPage();
    await adminPage.goto("/admin/referrers");
    await expect(adminPage.getByRole("heading", { name: "Manage Referrers" })).toBeVisible();

    /* Open the inline generator form */
    await adminPage.getByRole("button", { name: "Invite referrers" }).click();
    await expect(adminPage.getByRole("heading", { name: "Generate Invite Code" })).toBeVisible();

    /* Fill family limit and generate */
    await adminPage.getByLabel("Family Limit").fill("5");
    await adminPage.getByRole("button", { name: "Generate" }).click();

    /* Wait for invite code display */
    const inviteCodeBox = adminPage.getByText("Invite Code Generated");
    await expect(inviteCodeBox).toBeVisible({ timeout: 10_000 });

    /* Extract the invite code (it's displayed in a large monospace font) */
    const codeElement = adminPage.locator("div.font-mono.font-bold");
    const inviteCode = await codeElement.textContent();
    expect(inviteCode).toBeTruthy();
    const trimmedCode = inviteCode!.trim();
    expect(trimmedCode).toMatch(/^KRI-/);

    /* ── Step 2: Fresh unauthenticated context — referrer self-registers ── */
    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();
    await guestPage.goto("/register-referrer");
    await expect(guestPage.getByRole("heading", { name: "Referrer Registration" })).toBeVisible();

    /* Fill the registration form */
    await guestPage.getByLabel("Invite Code").fill(trimmedCode);
    await guestPage.getByLabel("Name").fill("E2E Invite Referrer");
    await guestPage.getByLabel("Email").fill(`e2e-invite-${SUFFIX}@example.com`);
    await guestPage.getByLabel("Phone Number").fill("555-000-1234");
    /* Use getByRole with exact name to avoid strict-mode collision between
       Password and Confirm Password inputs (label htmlFor association issue) */
    await guestPage.getByRole("textbox", { name: "Password", exact: true }).fill("Password123!");
    await guestPage.getByLabel("Confirm Password").fill("Password123!");

    await guestPage.getByRole("button", { name: "Create account" }).click();

    /* Should auto-login and redirect to main dashboard */
    await expect(guestPage).toHaveURL(/\/dashboard/, { timeout: 10_000 });
    await expect(guestPage.getByRole("heading", { name: "Welcome back!" })).toBeVisible();
    /* .first() — display name appears in welcome card AND referrer info card (both show the name) */
    await expect(guestPage.getByText("E2E Invite Referrer").first()).toBeVisible();

    await adminContext.close();
    await guestContext.close();
  });

  test("admin generates invite with email and sees send confirmation", async ({ browser }) => {
    const adminContext = await browser.newContext({
      storageState: "storage/admin.json",
    });
    const adminPage = await adminContext.newPage();
    await adminPage.goto("/admin/referrers");
    await expect(adminPage.getByRole("heading", { name: "Manage Referrers" })).toBeVisible();

    /* Open the inline generator form */
    await adminPage.getByRole("button", { name: "Invite referrers" }).click();
    await expect(adminPage.getByRole("heading", { name: "Generate Invite Code" })).toBeVisible();

    /* Fill family limit, email, and a custom message */
    await adminPage.getByLabel("Family Limit").fill("3");
    await adminPage.getByLabel("Email (optional)").fill(`e2e-email-invite-${SUFFIX}@example.com`);
    await adminPage.getByLabel("Custom Message (optional)").fill("Welcome to the magic!");

    /* Live preview reflects the custom message; the default prose is gone
       (paragraph role — the same text also sits in the Custom Message textarea) */
    await expect(adminPage.getByRole("paragraph").filter({ hasText: "Welcome to the magic!" })).toBeVisible();
    await expect(adminPage.getByText("KRI-XXXXXX")).toBeVisible();
    await expect(adminPage.getByText(/We'd love your help connecting/)).not.toBeVisible();

    await adminPage.getByRole("button", { name: "Generate" }).click();

    /* Wait for invite code display */
    const inviteCodeBox = adminPage.getByText("Invite Code Generated");
    await expect(inviteCodeBox).toBeVisible({ timeout: 10_000 });

    /* Verify the invite code is displayed */
    const codeElement = adminPage.locator("div.font-mono.font-bold");
    const inviteCode = (await codeElement.textContent())!.trim();
    expect(inviteCode).toMatch(/^KRI-/);

    await adminContext.close();
  });

  test("used invite code is rejected", async ({ browser }) => {
    /* First, generate a fresh invite code as admin */
    const adminContext = await browser.newContext({
      storageState: "storage/admin.json",
    });
    const adminPage = await adminContext.newPage();
    await adminPage.goto("/admin/referrers");
    await expect(adminPage.getByRole("heading", { name: "Manage Referrers" })).toBeVisible();

    /* Open the inline generator form */
    await adminPage.getByRole("button", { name: "Invite referrers" }).click();
    await expect(adminPage.getByRole("heading", { name: "Generate Invite Code" })).toBeVisible();

    await adminPage.getByLabel("Family Limit").fill("3");
    await adminPage.getByRole("button", { name: "Generate" }).click();
    const inviteCodeBox = adminPage.getByText("Invite Code Generated");
    await expect(inviteCodeBox).toBeVisible({ timeout: 10_000 });

    const codeElement = adminPage.locator("div.font-mono.font-bold");
    const inviteCode = (await codeElement.textContent())!.trim();

    /* Use the code to register */
    const guestContext1 = await browser.newContext();
    const page1 = await guestContext1.newPage();
    await page1.goto("/register-referrer");
    await page1.getByLabel("Invite Code").fill(inviteCode);
    await page1.getByLabel("Name").fill("First User");
    await page1.getByLabel("Email").fill(`first-user-invite-${SUFFIX}@example.com`);
    await page1.getByLabel("Phone Number").fill("555-000-5001");
    await page1.getByRole("textbox", { name: "Password", exact: true }).fill("Password123!");
    await page1.getByLabel("Confirm Password").fill("Password123!");
    await page1.getByRole("button", { name: "Create account" }).click();

    /* Should succeed — auto-login redirects to main dashboard */
    await expect(page1).toHaveURL(/\/dashboard/, { timeout: 10_000 });
    await guestContext1.close();

    /* Try to reuse the same code */
    const guestContext2 = await browser.newContext();
    const page2 = await guestContext2.newPage();
    await page2.goto("/register-referrer");
    await page2.getByLabel("Invite Code").fill(inviteCode);
    await page2.getByLabel("Name").fill("Second User");
    await page2.getByLabel("Email").fill(`second-user-invite-${SUFFIX}@example.com`);
    await page2.getByLabel("Phone Number").fill("555-000-5002");
    await page2.getByRole("textbox", { name: "Password", exact: true }).fill("Password123!");
    await page2.getByLabel("Confirm Password").fill("Password123!");
    await page2.getByRole("button", { name: "Create account" }).click();

    /* Should show error */
    await expect(page2.getByText("Invalid or already-used invite code")).toBeVisible({
      timeout: 10_000,
    });

    await adminContext.close();
    await guestContext2.close();
  });

  /**
   * Re-arm an expired invite code's expiry, through the Invite Codes page.
   *
   * Revoked on the way in, because nothing in the stack ages a token within a
   * test run: revocation stores the same state as natural expiry (expires_at
   * collapsed to now), so revoke → extend is the observable stand-in for
   * expired → re-armed. It also puts the expiry days apart in both directions,
   * so the displayed change is never hidden by the Expires column's
   * minute-granularity formatting — no real-time wait needed.
   *
   * The code stays unredeemed, so there is nothing to clean up (invite codes
   * have no delete endpoint and lapse on their own).
   */
  test("admin revokes an invite code, then extends it back to life", async ({ browser }) => {
    const adminContext = await browser.newContext({
      storageState: "storage/admin.json",
    });
    const adminPage = await adminContext.newPage();

    /* ── Generate a code (the generator lives on the Referrers page) ── */
    await adminPage.goto("/admin/referrers");
    await expect(adminPage.getByRole("heading", { name: "Manage Referrers" })).toBeVisible();
    await adminPage.getByRole("button", { name: "Invite referrers" }).click();
    await expect(adminPage.getByRole("heading", { name: "Generate Invite Code" })).toBeVisible();
    await adminPage.getByLabel("Family Limit").fill("3");
    await adminPage.getByRole("button", { name: "Generate" }).click();
    await expect(adminPage.getByText("Invite Code Generated")).toBeVisible({ timeout: 10_000 });

    const inviteCode = (await adminPage.locator("div.font-mono.font-bold").textContent())!.trim();
    expect(inviteCode).toMatch(/^KRI-/);

    /* ── Find it on the Invite Codes page (search is debounced ~1s, so the
          assertion waits on the row rather than on the keystroke) ── */
    await adminPage.goto("/admin/invite-codes");
    await expect(adminPage.getByRole("heading", { name: "Invite Codes" })).toBeVisible();
    await adminPage.getByLabel("Search by code or email").fill(inviteCode);

    const row = adminPage.getByRole("row").filter({ hasText: inviteCode });
    await expect(row).toBeVisible({ timeout: 15_000 });

    /* Column order is per-admin, so locate the expiry cell by its header. */
    const headers = await adminPage.getByRole("columnheader").allTextContents();
    const expiresIndex = headers.findIndex((h) => h.trim() === "Expires");
    expect(expiresIndex).toBeGreaterThan(-1);
    const expiryCell = row.getByRole("cell").nth(expiresIndex);

    /* The cell pairs the timestamp with the Expired badge — compare the date
       text alone so each assertion is about the expiry, not the badge. */
    const expiryText = async () => (((await expiryCell.textContent()) ?? "").replace("Expired", "").trim());

    /* A freshly generated code is live: a printed expiry and no Expired badge. */
    const expiryLived = await expiryText();
    expect(expiryLived).not.toBe("");
    expect(expiryLived).not.toBe("—");
    await expect(row.getByText("Expired")).toHaveCount(0);

    /* "Expired only" means unredeemed-and-lapsed, so a live code is not listed */
    const expiredOnly = adminPage.getByLabel("Expired only");
    await expiredOnly.check();
    await expect(adminPage.getByText("No invite codes found.")).toBeVisible();
    await expiredOnly.uncheck();
    await expect(row).toBeVisible();

    /* ── Revoke (the dialog is what makes it a deliberate act) ── */
    await row.getByRole("button", { name: "Revoke" }).click();
    await expect(adminPage.getByText("Revoke this invite code?")).toBeVisible();
    await adminPage.getByRole("button", { name: "Yes, revoke" }).click();

    /* The row badges as expired and its expiry moves to the revoke moment */
    await expect(row.getByText("Expired")).toBeVisible();
    const expiryRevoked = await expiryText();
    await expect(expiryCell).not.toHaveText(expiryLived);

    /* The filter agrees with the badge: revoked, so it is now in the expired set */
    await expiredOnly.check();
    await expect(row).toBeVisible();
    await expiredOnly.uncheck();

    /* ── Extend: same code, re-armed ── */
    await row.getByRole("button", { name: "Extend" }).click();

    /* Success toast names the code (visible effect even with Expires hidden) */
    await expect(adminPage.getByText(`Invite ${inviteCode} extended`)).toBeVisible({ timeout: 10_000 });

    /* Same row, same code — the badge clears and the expiry leaves the revoke
       moment behind (change, not duration: the window is env-configurable) */
    await expect(row).toContainText(inviteCode);
    await expect(row.getByText("Expired")).toHaveCount(0);
    await expect(expiryCell).not.toHaveText(expiryRevoked);

    /* Re-armed, so it leaves the expired set again */
    await expiredOnly.check();
    await expect(adminPage.getByText("No invite codes found.")).toBeVisible();

    await adminContext.close();
  });
});

/**
 * Referrer family invites + sent email log.
 *
 * Uses the CSV-seeded referrer (Sarah Chen, limit 10) end-to-end. The seeded
 * referrer's lifetime invite cap accumulates across runs without a DB wipe, so
 * beforeAll resets it via API (setup only). The admin's UI reset is exercised
 * in the second test and verified through its visible effects (cap cleared,
 * rows kept and marked "reset") rather than the API directly.
 *
 * describe.serial: the two tests share module state (invitee emails, referrer
 * ID) and depend on each other's log rows.
 *
 * Cleanup: nothing to delete. The only records created are SentEmail log rows,
 * which are intentionally permanent (reset, never deleted). Sarah Chen is
 * CSV-seeded and must not be mutated (golden rule).
 */
test.describe.serial("Referrer family invites + sent email log", () => {
  const inviteeEmail = `e2e-invitee-${SUFFIX}@example.com`;
  const secondInviteeEmail = `e2e-invitee-2-${SUFFIX}@example.com`;
  let sarahReferrerId: number | undefined;

  test.beforeAll(async ({ request }) => {
    const authed = await loginViaApi(request);
    const { referrers } = await listReferrersViaApi(authed);
    sarahReferrerId = referrers.find((r) => r.name === "Sarah Chen")?.id;
    expect(sarahReferrerId).toBeDefined();
    /* Clear invite cap + dedup accumulated across runs */
    await resetReferrerSentEmailsViaApi(authed, sarahReferrerId!);
    await authed.dispose();
  });

  test("referrer sends family invite; it appears in Sent Invites and the admin email log", async ({ browser }) => {
    /* ── Referrer side ── */
    const referrerContext = await browser.newContext({
      storageState: "storage/referrer.json",
    });
    const referrerPage = await referrerContext.newPage();
    await referrerPage.goto("/referrer/family-invites");
    await expect(referrerPage.getByRole("heading", { name: "Family Invites" })).toBeVisible();

    /* Cap is clear after the beforeAll reset */
    await expect(referrerPage.getByText("0 of 10 invites used")).toBeVisible();

    /* Send an invite through the dialog (the only form on the page) */
    await referrerPage.getByRole("button", { name: "Send invite" }).click();
    await expect(referrerPage.getByText("Send Family Invite")).toBeVisible();
    const dialogForm = referrerPage.locator("form");
    await dialogForm.getByLabel("Email").fill(inviteeEmail);
    await dialogForm.getByRole("button", { name: "Send invite" }).click();

    /* Row appears in the Sent Invites table with "Sent" status; cap increments */
    const sentRow = referrerPage.getByRole("row").filter({ hasText: inviteeEmail });
    await expect(sentRow).toBeVisible({ timeout: 10_000 });
    await expect(sentRow).toContainText("Sent");
    await expect(referrerPage.getByText("1 of 10 invites used")).toBeVisible();

    await referrerContext.close();

    /* ── Admin side — full log at /admin/emails ── */
    const adminContext = await browser.newContext({
      storageState: "storage/admin.json",
    });
    const adminPage = await adminContext.newPage();
    await adminPage.goto("/admin/emails");
    await expect(adminPage.getByRole("heading", { name: "Sent Emails" })).toBeVisible();

    /* Search narrows the log down to this row (parallel tests add other rows) */
    await adminPage.getByLabel("Search by recipient email").fill(inviteeEmail);
    const adminRow = adminPage.getByRole("row").filter({ hasText: inviteeEmail });
    await expect(adminRow).toBeVisible({ timeout: 10_000 });
    await expect(adminRow).toContainText("Family Invite");
    await expect(adminRow).toContainText("Sent");
    /* Sender is the acting user's display name (CSV: "SARAH THE TESTER") */
    await expect(adminRow).toContainText("SARAH THE TESTER");

    await adminContext.close();
  });

  test("admin UI reset keeps the rows and lets the referrer invite again", async ({ browser }) => {
    /* ── Admin resets via the referrers page kebab menu ── */
    const adminContext = await browser.newContext({
      storageState: "storage/admin.json",
    });
    const adminPage = await adminContext.newPage();
    await adminPage.goto("/admin/referrers");
    await expect(adminPage.getByRole("heading", { name: "Manage Referrers" })).toBeVisible();

    const sarahRow = adminPage.getByRole("row").filter({ hasText: "Sarah Chen" });
    await sarahRow.getByRole("button", { name: "More actions" }).click();
    await adminPage.getByRole("menuitem", { name: "Reset sent emails" }).click();

    await expect(adminPage.getByText("Reset sent emails for referrer")).toBeVisible();
    const resetResponse = adminPage.waitForResponse(
      (r) => r.url().includes("/reset-sent-emails") && r.request().method() === "POST",
    );
    await adminPage.getByRole("button", { name: "Yes, reset" }).click();
    expect((await resetResponse).ok()).toBe(true);

    await adminContext.close();

    /* ── Referrer side — fresh context so data refetches after the reset ── */
    const referrerContext = await browser.newContext({
      storageState: "storage/referrer.json",
    });
    const referrerPage = await referrerContext.newPage();
    await referrerPage.goto("/referrer/family-invites");
    await expect(referrerPage.getByRole("heading", { name: "Family Invites" })).toBeVisible();

    /* Cap cleared, invite button enabled again */
    await expect(referrerPage.getByText("0 of 10 invites used")).toBeVisible();
    await expect(referrerPage.getByRole("button", { name: "Send invite" })).toBeEnabled();

    /* Row is kept in the history, now marked reset (no longer counted) */
    const resetRow = referrerPage.getByRole("row").filter({ hasText: inviteeEmail });
    await expect(resetRow).toContainText("Reset (not counted)");

    /* The referrer can send again after the reset */
    await referrerPage.getByRole("button", { name: "Send invite" }).click();
    await expect(referrerPage.getByText("Send Family Invite")).toBeVisible();
    const dialogForm = referrerPage.locator("form");
    await dialogForm.getByLabel("Email").fill(secondInviteeEmail);
    await dialogForm.getByRole("button", { name: "Send invite" }).click();
    const newSentRow = referrerPage.getByRole("row").filter({ hasText: secondInviteeEmail });
    await expect(newSentRow).toBeVisible({ timeout: 10_000 });
    await expect(newSentRow).toContainText("Sent");
    await expect(referrerPage.getByText("1 of 10 invites used")).toBeVisible();

    await referrerContext.close();

    /* ── Admin log — the reset row stays, marked "reset" ── */
    const adminCtx2 = await browser.newContext({
      storageState: "storage/admin.json",
    });
    const adminPage2 = await adminCtx2.newPage();
    await adminPage2.goto("/admin/emails");
    await expect(adminPage2.getByRole("heading", { name: "Sent Emails" })).toBeVisible();

    await adminPage2.getByLabel("Search by recipient email").fill(inviteeEmail);
    const adminRow = adminPage2.getByRole("row").filter({ hasText: inviteeEmail });
    await expect(adminRow).toBeVisible({ timeout: 10_000 });
    await expect(adminRow).toContainText("Family Invite");
    await expect(adminRow).toContainText("Reset (not counted)");

    await adminCtx2.close();
  });
});
