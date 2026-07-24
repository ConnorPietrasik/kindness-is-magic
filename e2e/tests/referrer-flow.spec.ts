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
const TEST_DISPLAY_NAME = `Sarah Display ${Math.random().toString(36).slice(2, 6)}`;
const testData: { personId?: number } = {};

test.describe("Referrer self-service", () => {
  test.afterAll(async ({ request }) => {
    if (testData.personId) await deletePersonViaApi(request, testData.personId);
  });

  test("referrer families page loads with CSV-seeded families", async ({ page }) => {
    await page.goto("/referrer/families");
    await expect(page.getByRole("heading", { name: "My Families" })).toBeVisible();

    /* Families table should show The Williams Family and The Rodriguez Family */
    await expect(page.getByRole("table")).toContainText("The Williams Family", {
      timeout: 10_000,
    });
    await expect(page.getByRole("table")).toContainText("The Rodriguez Family");
  });

  test("referrer views family detail with people", async ({ page }) => {
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
  });

  test("referrer adds a person to a family", async ({ page }) => {
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

  test("referrer sees seeded display name on dashboard", async ({ page }) => {
    /* demo_import.csv seeds sarah.chen with display_name "SARAH THE TESTER" */
    await page.goto("/dashboard");

    /* Wait for the welcome heading (handles lazy-loaded routes) */
    await expect(page.getByRole("heading", { name: "Welcome back!" })).toBeVisible();

    /* Assert the display name is rendered in the welcome card */
    await expect(page.getByText("SARAH THE TESTER", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
  });

  test("referrer changes display name and it persists after refresh", async ({
    page,
  }) => {
    await page.goto("/dashboard");

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

    /* Reset display name back to the seeded value for idempotent re-runs */
    await page.getByTitle("Edit display name").click();
    await page.getByPlaceholder("e.g. John Smith").fill("SARAH THE TESTER");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("SARAH THE TESTER")).toBeVisible({
      timeout: 10_000,
    });
  });
});
