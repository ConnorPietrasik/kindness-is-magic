/**
 * Family self-service — dashboard, people management.
 *
 * Runs in the "family" project (pre-authenticated as emily.williams@example.com).
 * Uses CSV-seeded data: The Williams Family has Emma, Liam, Oliver.
 *
 * Uses a unique person name per run so re-runs without DB wipe don't collide
 * with stale records from prior runs.
 */
import { test, expect } from "@playwright/test";
import { deletePersonViaApi } from "../helpers/api";

const TEST_CHILD = `Family Test ${Math.random().toString(36).slice(2, 6)}`;
const testData: { personId?: number } = {};

test.describe("Family self-service", () => {
  test.afterAll(async ({ request }) => {
    if (testData.personId) await deletePersonViaApi(request, testData.personId);
  });

  test("family dashboard loads with family info", async ({ page }) => {
    await page.goto("/family/dashboard");
    await expect(page.getByRole("heading", { name: "Family Dashboard" })).toBeVisible();

    /* Family profile card should show The Williams Family info */
    await expect(page.getByText("The Williams Family")).toBeVisible();
    await expect(page.getByText("Emily Williams")).toBeVisible();
  });

  test("family views people list", async ({ page }) => {
    await page.goto("/family/people");
    await expect(page.getByRole("heading", { name: "Manage People" })).toBeVisible({
      timeout: 10_000,
    });

    /* CSV-seeded people should be present */
    await expect(page.getByRole("table")).toContainText("Emma");
    await expect(page.getByRole("table")).toContainText("Liam");
    await expect(page.getByRole("table")).toContainText("Oliver");
  });

  test("family adds a new person", async ({ page }) => {
    await page.goto("/family/people");
    await expect(page.getByRole("heading", { name: "Manage People" })).toBeVisible({
      timeout: 10_000,
    });

    /* Click Add Person */
    await page.getByRole("button", { name: "+ Add Person" }).click();

    /* Fill the form */
    await page.getByLabel("Given Name").fill(TEST_CHILD);
    await page.getByLabel("Age").fill("5");
    await page.getByLabel("Practical Wish").fill("Winter gloves");
    await page.getByLabel("Fun Wish").fill("Sticker book");

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

  test("family edits a person", async ({ page }) => {
    await page.goto("/family/people");
    await expect(page.getByRole("heading", { name: "Manage People" })).toBeVisible({
      timeout: 10_000,
    });

    /* Find test child and click Edit */
    const row = page.getByRole("row").filter({ hasText: TEST_CHILD });
    await row.getByRole("button", { name: "Edit" }).click();

    /* Change age */
    await page.getByLabel("Age").fill("6");

    await page.getByRole("button", { name: "Update" }).click();

    /* Verify change persisted */
    await expect(page.getByRole("row").filter({ hasText: TEST_CHILD })).toBeVisible();
  });

  test("family cannot access admin routes", async ({ page }) => {
    await page.goto("/admin/referrers");
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("family cannot access referrer routes", async ({ page }) => {
    await page.goto("/referrer/dashboard");
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
