/**
 * Family Wish List — public page tests.
 *
 * Runs in the "guest" project (no pre-authenticated state).
 * Validates the public wish-list page renders correctly and handles 404.
 *
 * This project runs last (after admin, referrer, family), so it is safe to
 * mutate the seed family's wish_lock_level for these tests without breaking
 * earlier projects that need the family at lock_level="family".
 */
import fs from "node:fs";
import { test, expect, request } from "@playwright/test";
import { getAdminEmail, getAdminPassword } from "../helpers/env";

/**
 * Read the seeded family ID saved by global-setup.
 */
function getSeedFamilyId(): number {
  const raw = fs.readFileSync("storage/seed-family-id.json", "utf-8");
  return JSON.parse(raw).id as number;
}

/**
 * Approve the seeded family's wishes so the public wish-list page is accessible.
 *
 * CSV-seeded families start at wish_lock_level="family". The public wish list
 * endpoint requires wish_lock_level="admin". This walks the full approval chain:
 *   family → referrer (referrer approves) → admin (admin approves).
 *
 * We do this in the guest project because it runs last — earlier projects
 * (referrer, family) need the family at lock_level="family" to modify it.
 */
async function approveSeedFamily(apiContext: Awaited<ReturnType<typeof request.newContext>>): Promise<void> {
  const familyId = getSeedFamilyId();

  // 1. Referrer approves (family → referrer lock)
  await apiContext.post("/api/auth/login", {
    data: { email: "sarah.chen@example.com", password: "Password123!" },
  });
  const referrerResp = await apiContext.post(`/api/referrer/families/${familyId}/approve-wishes`, {
    data: {},
  });
  if (!referrerResp.ok()) {
    const body = await referrerResp.text();
    throw new Error(`Referrer approve failed (${referrerResp.status()}): ${body}`);
  }

  // 2. Admin approves (referrer → admin lock)
  await apiContext.post("/api/auth/login", {
    data: { email: getAdminEmail(), password: getAdminPassword() },
  });
  const adminResp = await apiContext.post(`/api/admin/families/${familyId}/approve-wishes`, {
    data: {},
  });
  if (!adminResp.ok()) {
    const body = await adminResp.text();
    throw new Error(`Admin approve failed (${adminResp.status()}): ${body}`);
  }
}

test.describe("Family Wish List (public)", () => {
  test("guest can view a family wish list", async ({ page }) => {
    /* Approve the seeded family so its wish list is publicly visible */
    const apiContext = await request.newContext({ baseURL: "http://localhost" });
    await approveSeedFamily(apiContext);
    await apiContext.dispose();

    const familyId = getSeedFamilyId();
    await page.goto(`/families/${familyId}/wish-list`);

    /* Page heading shows the display ID (e.g. "1" or "2-3") — family name is excluded for privacy */
    await expect(page.getByRole("heading", { name: /^\d+(?:-\d+)*$/ })).toBeVisible({
      timeout: 10_000,
    });

    /* Family wish card is visible */
    await expect(page.getByText("A fleece throw blanket set")).toBeVisible();

    /* People table shows seeded members */
    await expect(page.getByRole("table")).toContainText("Emma");
    await expect(page.getByRole("table")).toContainText("Liam");
    await expect(page.getByRole("table")).toContainText("Oliver");

    /* Practical and fun wishes are visible */
    await expect(page.getByRole("table")).toContainText("A navy blue puffer coat");
    await expect(page.getByRole("table")).toContainText("Barbie Dreamhouse doll");
  });

  test("guest sees 404 for non-existent family", async ({ page }) => {
    await page.goto("/families/99999/wish-list");

    await expect(page.getByRole("heading", { name: "Family Not Found" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("This wish list doesn't exist or has been removed.")).toBeVisible();
  });
});
