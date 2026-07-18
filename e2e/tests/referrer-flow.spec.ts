/**
 * Referrer self-service — dashboard, family detail, people management.
 *
 * Runs in the "referrer" project (pre-authenticated as sarah.chen@example.com).
 * Uses CSV-seeded data: Sarah Chen has The Williams Family and The Rodriguez Family.
 * Uses a unique person name per run so re-runs without DB wipe don't collide.
 */
import { test, expect } from "@playwright/test";
import { deletePersonViaApi } from "../helpers/api";

const TEST_CHILD = `Referrer Test ${Math.random().toString(36).slice(2, 6)}`;
const testData: { personId?: number } = {};

test.describe("Referrer self-service", () => {
  test.afterAll(async ({ request }) => {
    if (testData.personId) await deletePersonViaApi(request, testData.personId);
  });

  test("referrer dashboard loads with CSV-seeded families", async ({ page }) => {
    await page.goto("/referrer/dashboard");
    await expect(page.getByRole("heading", { name: "Referrer Dashboard" })).toBeVisible();

    /* My Profile card should show Sarah Chen's info */
    await expect(page.getByText("Sarah Chen")).toBeVisible();

    /* Families table should show The Williams Family and The Rodriguez Family */
    await expect(page.getByRole("table")).toContainText("The Williams Family", {
      timeout: 10_000,
    });
    await expect(page.getByRole("table")).toContainText("The Rodriguez Family");
  });

  test("referrer views family detail with people", async ({ page }) => {
    await page.goto("/referrer/dashboard");
    await expect(page.getByRole("heading", { name: "Referrer Dashboard" })).toBeVisible();

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
  });

  test("referrer adds a person to a family", async ({ page }) => {
    /* Navigate to The Williams Family detail — find it from the dashboard */
    await page.goto("/referrer/dashboard");
    const williamsRow = page.getByRole("row").filter({ hasText: "The Williams Family" });
    const manageLink = williamsRow.getByRole("link", { name: "Manage" });
    await manageLink.click();

    await expect(page.getByRole("heading", { name: "Family Detail" })).toBeVisible({
      timeout: 10_000,
    });

    /* Click Add Person */
    await page.getByRole("button", { name: "+ Add Person" }).click();

    /* Fill the form */
    await page.getByLabel("Given Name").fill(TEST_CHILD);
    await page.getByLabel("Age").fill("3");
    await page.getByLabel("Practical Wish").fill("Warm socks");
    await page.getByLabel("Fun Wish").fill("Coloring book");

    await page.getByRole("button", { name: "Create" }).click();

    /* Verify the new person appears */
    await expect(page.getByRole("table")).toContainText(TEST_CHILD, {
      timeout: 10_000,
    });

    /* Capture person ID for cleanup */
    const personRow = page.getByRole("row").filter({ hasText: TEST_CHILD });
    const idCell = personRow.getByRole("cell").first();
    const idText = await idCell.textContent();
    if (idText) {
      testData.personId = parseInt(idText.trim(), 10);
    }
  });

  test("referrer cannot access admin routes", async ({ page }) => {
    await page.goto("/admin/referrers");

    /* Role guard should redirect to /dashboard */
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
