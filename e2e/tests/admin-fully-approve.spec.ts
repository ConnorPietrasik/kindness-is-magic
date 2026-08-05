/**
 * Admin "Fully Approve" flow — skip the review queue and make a family donor-visible.
 *
 * Runs in the "admin" project (pre-authenticated).
 * Uses a CSV-seeded family that starts at lock=family.
 */
import { test, expect, request as playwrightRequest } from "@playwright/test";
import { listFamiliesViaApi, resetFamilyWishState } from "../helpers/api";

/** Open the kebab-menu dropdown and click a menu item by label. */
async function clickAction(row: ReturnType<import("@playwright/test").Locator>, actionLabel: string) {
  await row.getByRole("button", { name: "More actions" }).click();
  await row.getByRole("menuitem", { name: actionLabel }).click();
}

// Use "The Rodriguez Family" — not touched by other e2e tests
const FAMILY_NAME = "The Rodriguez Family";
let familyId: number | undefined;

test.describe("Admin Fully Approve", () => {
  test.afterAll(async ({ request }) => {
    // Reset wish state so subsequent runs start clean
    if (familyId) await resetFamilyWishState(request, familyId);
  });

  test("admin fully approves a family at lock=family via UI", async ({ page, request }) => {
    // Ensure clean baseline (CSV re-import does NOT reset lock level on existing rows)
    const families = await listFamiliesViaApi(request);
    const target = families.families.find((f) => f.family_name === FAMILY_NAME);
    if (!target) {
      test.skip(`${FAMILY_NAME} not found in seeded data`);
      return;
    }
    familyId = target.id;
    await resetFamilyWishState(request, familyId);

    // Navigate to admin families page
    await page.goto("/admin/families");
    await expect(page.getByRole("heading", { name: "Manage Families" })).toBeVisible();

    // Find the family row
    const row = page.getByRole("row").filter({ hasText: FAMILY_NAME });
    await expect(row).toBeVisible();

    // Verify "Fully Approve" is in the kebab menu
    await row.getByRole("button", { name: "More actions" }).click();
    await expect(row.getByRole("menuitem", { name: "Fully Approve" })).toBeVisible();
    // Close the menu
    await page.keyboard.press("Escape");

    // Click "Fully Approve"
    await clickAction(row, "Fully Approve");

    // Confirm in the dialog
    await expect(page.getByText("Fully approve family")).toBeVisible();
    await expect(page.getByText("skipping referrer review")).toBeVisible();
    await page.getByRole("button", { name: "Yes, fully approve" }).click();

    // Verify success toast
    await expect(page.getByText("Family fully approved and visible to donors")).toBeVisible({
      timeout: 10_000,
    });

    // Verify row turns green (bg-emerald-50 class)
    const approvedRow = page.getByRole("row").filter({ hasText: FAMILY_NAME });
    await expect(approvedRow).toHaveAttribute("class", /bg-emerald-50/);

    // Verify "Fully Approve" is no longer in the menu (already at admin lock)
    await approvedRow.getByRole("button", { name: "More actions" }).click();
    await expect(approvedRow.getByRole("menuitem", { name: "Fully Approve" })).not.toBeVisible();
    // "Reset Lock" should appear instead (lock !== family)
    await expect(approvedRow.getByRole("menuitem", { name: "Reset Lock" })).toBeVisible();
    await page.keyboard.press("Escape");

    // Verify the family appears in packing slips (API check — UI is same data)
    const slipsResp = await request.get("/api/admin/families/packing-slips");
    const slips = (await slipsResp.json()) as Array<{ id: number }>;
    expect(slips.some((s) => s.id === familyId)).toBe(true);
  });
});
