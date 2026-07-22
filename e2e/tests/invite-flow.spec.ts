/**
 * Invite and self-registration flow.
 *
 * This file needs two contexts: admin (to generate invite) + guest (to register).
 * Tests run as per-test (no shared context) because they need fresh unauthenticated state.
 *
 * Uses a random suffix on emails so re-runs without DB wipe don't collide.
 */
import { test, expect } from "@playwright/test";

/* Unique suffix so re-runs without a DB wipe don't hit "Email already registered" */
const SUFFIX = Math.random().toString(36).slice(2, 8);

test.describe("Invite and self-registration", () => {
  test("admin generates invite code and referrer self-registers", async ({ browser }) => {
    /* ── Step 1: Admin generates invite code ── */
    const adminContext = await browser.newContext({
      storageState: "storage/admin.json",
    });
    const adminPage = await adminContext.newPage();
    await adminPage.goto("/admin/invite-referrer");
    await expect(adminPage.getByRole("heading", { name: "Generate Invite Code" })).toBeVisible();

    /* Fill family limit and generate */
    await adminPage.getByLabel("Family Limit").fill("5");
    await adminPage.getByRole("button", { name: "Generate Invite Code" }).click();

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

    await guestPage.getByRole("button", { name: "Create Account" }).click();

    /* Should auto-login and redirect to main dashboard */
    await expect(guestPage).toHaveURL(/\/dashboard/, { timeout: 10_000 });
    await expect(guestPage.getByRole("heading", { name: "Welcome back!" })).toBeVisible();
    await expect(guestPage.getByText("E2E Invite Referrer")).toBeVisible();

    await adminContext.close();
    await guestContext.close();
  });

  test("admin generates invite with email and sees send confirmation", async ({ browser }) => {
    const adminContext = await browser.newContext({
      storageState: "storage/admin.json",
    });
    const adminPage = await adminContext.newPage();
    await adminPage.goto("/admin/invite-referrer");
    await expect(adminPage.getByRole("heading", { name: "Generate Invite Code" })).toBeVisible();

    /* Fill family limit, email, and generate */
    await adminPage.getByLabel("Family Limit").fill("3");
    await adminPage.getByLabel("Email (optional)").fill(`e2e-email-invite-${SUFFIX}@example.com`);
    await adminPage.getByRole("button", { name: "Generate Invite Code" }).click();

    /* Wait for invite code display */
    const inviteCodeBox = adminPage.getByText("Invite Code Generated");
    await expect(inviteCodeBox).toBeVisible({ timeout: 10_000 });

    /* Verify the invite code is displayed */
    const codeElement = adminPage.locator("div.font-mono.font-bold");
    const inviteCode = (await codeElement.textContent())!.trim();
    expect(inviteCode).toMatch(/^KRI-/);

    /* Verify email sent confirmation is shown (SUPPRESS_SEND=1 in test env) */
    await expect(adminPage.getByText("Email sent successfully.")).toBeVisible({
      timeout: 10_000,
    });

    await adminContext.close();
  });

  test("used invite code is rejected", async ({ browser }) => {
    /* First, generate a fresh invite code as admin */
    const adminContext = await browser.newContext({
      storageState: "storage/admin.json",
    });
    const adminPage = await adminContext.newPage();
    await adminPage.goto("/admin/invite-referrer");
    await expect(adminPage.getByRole("heading", { name: "Generate Invite Code" })).toBeVisible();

    await adminPage.getByLabel("Family Limit").fill("3");
    await adminPage.getByRole("button", { name: "Generate Invite Code" }).click();
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
    await page1.getByRole("button", { name: "Create Account" }).click();

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
    await page2.getByRole("button", { name: "Create Account" }).click();

    /* Should show error */
    await expect(page2.getByText("Invalid or already-used invite code")).toBeVisible({
      timeout: 10_000,
    });

    await adminContext.close();
    await guestContext2.close();
  });
});
