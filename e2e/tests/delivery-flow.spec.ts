/**
 * Delivery Flow — dashboard, packing slips, role isolation.
 *
 * Runs in the "delivery" project (pre-authenticated via storageState).
 * Uses families assigned to the delivery person by global-setup.
 */
import { test, expect } from "@playwright/test";

test.describe("Delivery — Dashboard", () => {
  test("page loads with assigned families", async ({ page }) => {
    await page.goto("/delivery");
    await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
    // global-setup assigns at least one family — family cards should appear
    await expect(page.getByRole("heading", { name: "Assigned Families" })).toBeVisible();
    // Family cards contain display IDs (use .first() to avoid strict mode hit on welcome card)
    const familySection = page.locator("[class*=\"space-y\"]");
    await expect(familySection.locator(".rounded-xl").first()).toContainText(/#\d+/, { timeout: 10_000 });
  });

  test("shows family count in welcome card", async ({ page }) => {
    await page.goto("/delivery");
    await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
    // Welcome card shows assigned family count
    await expect(page.getByText(/family/)).toBeVisible();
  });

  test("has link to packing slips", async ({ page }) => {
    await page.goto("/delivery");
    await expect(page.getByRole("button", { name: "View Packing Slips" })).toBeVisible();
  });
});

test.describe("Delivery — Packing Slips", () => {
  test("page loads with assigned family data", async ({ page }) => {
    await page.goto("/delivery/packing-slips");
    // Packing slip cards show display IDs
    await expect(page.locator(".packing-slip-card").first()).toBeVisible({ timeout: 10_000 });
    // Each card has a display ID heading
    await expect(page.locator(".packing-slip-card h2").first()).toBeVisible();
  });

  test("shows people and wishes in packing slips", async ({ page }) => {
    await page.goto("/delivery/packing-slips");
    await expect(page.locator(".packing-slip-card").first()).toBeVisible({ timeout: 10_000 });
    // Packing slip table should be visible
    await expect(page.locator(".packing-slip-table").first()).toBeVisible();
    // Table headers
    await expect(page.getByRole("columnheader", { name: "Name" }).first()).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Age" }).first()).toBeVisible();
  });

  test("does not expose family PII on packing slips", async ({ page }) => {
    await page.goto("/delivery/packing-slips");
    await expect(page.locator(".packing-slip-card").first()).toBeVisible({ timeout: 10_000 });
    // Packing slips should NOT contain family names or contact names
    // (backend deliberately excludes these fields)
    const cards = page.locator(".packing-slip-card");
    const count = await cards.count();
    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);
      // The card should not contain family names (PII fields)
      await expect(card).not.toContainText("The Williams Family");
      await expect(card).not.toContainText("The Rodriguez Family");
    }
  });

  test("has print button", async ({ page }) => {
    await page.goto("/delivery/packing-slips");
    await expect(page.getByRole("button", { name: "Print" })).toBeVisible();
  });
});

test.describe("Delivery — Role Isolation", () => {
  test("cannot access admin routes", async ({ page }) => {
    await page.goto("/admin/families");
    // ProtectedRoute redirects wrong-role users to /dashboard
    await page.waitForURL(/\/dashboard/, { timeout: 10_000 });
  });

  test("cannot access referrer routes", async ({ page }) => {
    await page.goto("/referrer/dashboard");
    await page.waitForURL(/\/dashboard/, { timeout: 10_000 });
  });

  test("cannot access family routes", async ({ page }) => {
    await page.goto("/family/dashboard");
    await page.waitForURL(/\/dashboard/, { timeout: 10_000 });
  });

  test("cannot access purchaser routes", async ({ page }) => {
    await page.goto("/purchaser/assigned-gifts");
    await page.waitForURL(/\/dashboard/, { timeout: 10_000 });
  });
});
