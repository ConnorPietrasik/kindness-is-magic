/**
 * Admin user management — error display on validation failure.
 *
 * Runs in the "admin" project (pre-authenticated).
 * Creates a user via API, then verifies an error appears when duplicating.
 */
import { test, expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import { getAdminEmail, getAdminPassword } from "../helpers/env";

const SUFFIX = Math.random().toString(36).slice(2, 6);
const TEST_EMAIL = `e2etestuser${SUFFIX}@example.com`;

let createdUserId: number | undefined;

test.describe("Admin Users", () => {
  test.afterAll(async ({ request }) => {
    if (createdUserId) {
      const authed = await loginViaApi(request);
      const resp = await authed.delete(`/api/admin/users/${createdUserId}`);
      if (!resp.ok()) console.warn(`[cleanup] delete user ${createdUserId} returned ${resp.status()}`);
    }
  });

  test("error appears when creating a user with duplicate email", async ({ page, request }) => {
    /* Seed a user via API so we have something to duplicate against */
    const authed = await loginViaApi(request);
    const createResp = await authed.post("/api/admin/users", {
      data: {
        email: TEST_EMAIL,
        password: "Password123!",
        role: "admin",
        display_name: `E2E User ${SUFFIX}`,
      },
    });
    expect(createResp.status()).toBe(201);
    const created = (await createResp.json()) as { id: number };
    createdUserId = created.id;

    /* Open the admin users page and the create form */
    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { name: "Manage Users" })).toBeVisible();

    await page.getByRole("button", { name: "+ Add User" }).click();
    await expect(page.getByRole("heading", { name: "Add User" })).toBeVisible();

    /* Fill in the SAME email to trigger duplicate error */
    await page.getByLabel("Email").fill(TEST_EMAIL);
    await page.getByLabel("Display Name").fill(`Duplicate ${SUFFIX}`);
    await page.getByLabel("Password", { exact: true }).fill("Password123!");
    await page.getByLabel("Confirm Password").fill("Password123!");

    /* Select admin role (first option in the role dropdown inside the form) */
    await page.locator("form select").first().selectOption({ index: 0 });

    /* Submit — should fail with "Email already in use" */
    await page.getByRole("button", { name: "Create" }).click();

    /* Form should still be visible (not dismissed on error) */
    await expect(page.getByRole("heading", { name: "Add User" })).toBeVisible();

    /* Error should appear on the page (inline in form and/or bottom MutationErrors) */
    await expect(page.getByText("Email already in use").first()).toBeVisible({ timeout: 10_000 });
  });
});

async function loginViaApi(baseRequest: APIRequestContext): Promise<APIRequestContext> {
  await baseRequest.post("/api/auth/login", {
    data: { email: getAdminEmail(), password: getAdminPassword() },
  });
  return baseRequest;
}
