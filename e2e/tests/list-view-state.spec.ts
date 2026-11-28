/**
 * Persisted list view state e2e coverage.
 *
 * List pages save their view (page/page size, tab, sort, filters, search) to
 * localStorage so the view survives navigating away and back by any path.
 * These specs verify the core guarantees:
 *
 * - Admin /admin/families: search + sort + page number + page size survive
 *   (a) the header back button from a family's people page, (b) leaving via
 *   the dashboard and returning, and (c) a reload; "Clear filters" then
 *   restores the default view. A persisted page past the last page (the list
 *   shrank since it was saved) clamps back to the last page instead of
 *   rendering an empty list.
 * - Donor /donor/claims: the status filter survives a round trip to a
 *   sponsorship detail via the header back link.
 *
 * Data:
 * - Admin test: no data is created — the seeded families provide rows, and
 *   the assertions are on the filter/sort controls (which render regardless
 *   of whether a filter leaves rows). Sort/page size are set before the
 *   back-button round trip because neither empties the list; the search text
 *   (a unique, no-match string) is set afterwards so it can be asserted on
 *   its own round trip. The storageState context may carry a saved view, so
 *   the test normalizes it via "Clear filters" first (same pattern as
 *   column-order.spec.ts's gear reset).
 * - Donor test: isolated family scenario (same pattern as
 *   column-order.spec.ts), sponsored through the UI so the claim list has a
 *   row; cleaned up in afterAll.
 */
import { expect, test } from "@playwright/test";
import {
  approveWishChain,
  createDonorWithUser,
  createIsolatedFamilyScenario,
  deleteFamilyViaApi,
  deleteReferrerViaApi,
  deleteUserViaApi,
  loginViaApi,
} from "../helpers/api";

const STORAGE_ADMIN = "storage/admin.json";

test.describe("Admin families — persisted view state", () => {
  test("search + sort + page number + page size survive back button, another route and reload; Clear filters resets", async ({ browser }) => {
    const context = await browser.newContext({ storageState: STORAGE_ADMIN });
    const page = await context.newPage();
    await page.goto("/admin/families");
    await page.waitForLoadState("networkidle");

    // Normalize any saved view the storageState carries (see file header).
    const clearBtn = page.getByRole("button", { name: "Clear filters" });
    if (await clearBtn.isVisible()) {
      await clearBtn.click();
      await page.waitForLoadState("networkidle");
    }
    await expect(clearBtn).not.toBeVisible();

    const manage = page.getByRole("link", { name: "Manage" });
    await expect(manage.first()).toBeVisible();

    // --- Set a non-default view (controls that can't empty the list) ---
    // Sort: "Newest first" (always in the filter row — unlike the Person
    // Count header sort, it doesn't depend on column visibility)
    const newestBtn = page.getByRole("button", { name: "Newest first" });
    await newestBtn.click();
    await expect(newestBtn).toHaveAttribute("aria-pressed", "true");

    // Smaller page size (persists alongside the page number)
    const pageSize = page.getByLabel("Items per page");
    await pageSize.selectOption("10");

    // The non-default view makes the clear affordance visible
    await expect(clearBtn).toBeVisible();

    // Page number: navigate to page 2 — the value persisted alongside sort
    // and page size (the spurious StrictMode reset that used to clobber it
    // back to page 1 has a unit-level regression test in
    // frontend/src/hooks/useDebouncedState.test.ts). Capture only the range,
    // not the total: the total is a live global count that parallel specs
    // mutate while this test runs (fullyParallel suite, and many specs
    // create/soft-delete families), so an exact full-text match would flake.
    await page.getByRole("button", { name: "Next page" }).click();
    await page.waitForLoadState("networkidle");
    const rawRange = await page.getByText(/Showing \d+–\d+ of \d+/).first().innerText();
    const rangeMatch = /Showing (\d+–\d+) of \d+/.exec(rawRange);
    if (!rangeMatch) throw new Error(`pagination bar not in range form: ${rawRange}`);
    const page2Range = rangeMatch[1]; // e.g. "11–20"

    // --- (a) Round trip via the header back button ---
    await manage.first().click();
    await page.waitForURL(/\/admin\/families\/\d+\/people/);
    await page.getByRole("link", { name: "← Back" }).click();
    await page.waitForURL("/admin/families");
    await page.waitForLoadState("networkidle");

    // The exact prior view is back
    await expect(newestBtn).toHaveAttribute("aria-pressed", "true");
    await expect(pageSize).toHaveValue("10");
    await expect(page.getByText(/Showing \d+–\d+ of \d+/).first()).toHaveText(
      new RegExp(`Showing ${page2Range} of \\d+`)
    );

    // --- (b) Leave via a different path (dashboard) and return ---
    await page.getByLabel("Home").click();
    await page.waitForURL("/dashboard");
    await page.goto("/admin/families");
    await page.waitForLoadState("networkidle");

    await expect(newestBtn).toHaveAttribute("aria-pressed", "true");
    await expect(pageSize).toHaveValue("10");
    await expect(page.getByText(/Showing \d+–\d+ of \d+/).first()).toHaveText(
      new RegExp(`Showing ${page2Range} of \\d+`)
    );

    // --- Search text: set it, then prove it survives its own round trip ---
    // (Unique string — the list empties, but the persisted input rehydrates.)
    const search = page.getByLabel("Search all fields");
    await search.fill("e2e-views-no-match");

    await page.getByLabel("Home").click();
    await page.waitForURL("/dashboard");
    await page.goto("/admin/families");
    await page.waitForLoadState("networkidle");

    // (The no-match search empties the list, so the Pagination bar — and
    // its "Items per page" selector — is hidden here; search + sort are the
    // assertions that matter for this round trip.)
    await expect(search).toHaveValue("e2e-views-no-match");
    await expect(newestBtn).toHaveAttribute("aria-pressed", "true");

    // --- (c) A plain reload also restores the view ---
    await page.reload({ waitUntil: "networkidle" });
    await expect(search).toHaveValue("e2e-views-no-match");
    await expect(newestBtn).toHaveAttribute("aria-pressed", "true");

    // --- Clear filters restores the default view ---
    await clearBtn.click();
    await page.waitForLoadState("networkidle");

    await expect(search).toHaveValue("");
    await expect(newestBtn).toHaveAttribute("aria-pressed", "false");
    await expect(pageSize).toHaveValue("20");
    await expect(clearBtn).not.toBeVisible();

    await context.close();
  });

  test("a persisted page past the last page clamps back instead of showing an empty list", async ({ browser }) => {
    const context = await browser.newContext({ storageState: STORAGE_ADMIN });
    const page = await context.newPage();
    await page.goto("/admin/families");
    await page.waitForLoadState("networkidle");

    // Simulate a saved page from when the list was larger (rows deleted,
    // or the page saved on another machine with different data).
    await page.evaluate(() => {
      localStorage.setItem("kim:listView:adminFamilies:page", JSON.stringify({ page: 9999, pageSize: 20 }));
    });
    await page.reload({ waitUntil: "networkidle" });

    // The clamp refetches the last valid page: rows are visible instead of
    // the "No families yet." empty state…
    await expect(page.getByText("No families yet.")).toHaveCount(0);
    await expect(page.locator("tbody tr[data-id]")).not.toHaveCount(0);

    // …and the pagination bar lands on the clamped last page, not page 1.
    // Asserting the range *ends* at the total instead would flake: ~20
    // parallel specs create/soft-delete families, so the live total can cross
    // a page-size boundary mid-assertion, and the clamp only ever moves the
    // page down — a clamped page 3 stops being the last page once the total
    // passes 60. "Not page 1" + a well-formed range catches a broken clamp
    // without tracking the total.
    await expect
      .poll(async () => {
        const raw = await page.getByText(/Showing \d+–\d+ of \d+|\d+ total/).first().innerText().catch(() => "");
        const range = raw.match(/Showing (\d+)–(\d+) of (\d+)/);
        if (!range) return /^\d+ total$/.test(raw); // single page — the clamped page *is* page 1
        const start = Number(range[1]);
        const end = Number(range[2]);
        const total = Number(range[3]);
        return start > 1 && start <= end && end <= total;
      })
      .toBe(true);

    await context.close();
  });
});

test.describe("Donor claims — persisted view state", () => {
  const SUFFIX = Math.random().toString(36).slice(2, 8);

  const scenarioData: {
    donor?: { userId: number; email: string; password: string };
    scenario?: {
      referrerId: number;
      referrerUserId: number;
      referrerEmail: string;
      referrerPassword: string;
      familyId: number;
      familyName: string;
      personId: number;
      personName: string;
    };
  } = {};

  test.beforeAll(async ({ request }) => {
    const api = await loginViaApi(request);

    const donor = await createDonorWithUser(api, {
      email: `e2e-views-donor-${SUFFIX}@example.com`,
      password: "Password123!",
      displayName: `View Donor ${SUFFIX}`,
    });
    const scenario = await createIsolatedFamilyScenario(api, SUFFIX);
    // Fully approve the family so it shows up for claiming
    await approveWishChain(api, scenario.familyId, scenario.referrerEmail, scenario.referrerPassword);

    scenarioData.donor = donor;
    scenarioData.scenario = scenario;

    await api.dispose();
  });

  test.afterAll(async ({ request }) => {
    const authed = await loginViaApi(request);
    const { scenario, donor } = scenarioData;
    if (scenario?.familyId) await deleteFamilyViaApi(authed, scenario.familyId);
    if (scenario?.referrerUserId) await deleteUserViaApi(authed, scenario.referrerUserId);
    if (scenario?.referrerId) await deleteReferrerViaApi(authed, scenario.referrerId);
    if (donor?.userId) await deleteUserViaApi(authed, donor.userId);
    await authed.dispose();
  });

  test("status filter survives a round trip to the sponsorship detail", async ({ browser }) => {
    const { donor, scenario } = scenarioData;
    if (!donor || !scenario) {
      test.skip(true, "scenario setup failed in beforeAll");
      return;
    }

    // Fresh context — empty localStorage (no storageState for donors).
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/login");
    await page.getByLabel("Email").fill(donor.email);
    await page.getByLabel("Password").fill(donor.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/dashboard/);

    // Claim the isolated family through the donor UI (same flow as
    // column-order.spec.ts) so the claim list has one row.
    await page.goto(`/families/${scenario.familyId}/wish-list`);
    await expect(page.getByText("Family Members")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Sponsor this family" }).click();
    await expect(page.getByRole("heading", { name: "Sponsor This Family" })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Sponsor family" }).click();
    await expect(page.getByRole("heading", { name: /You made Family .*'s Christmas magical/ })).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole("button", { name: "View your sponsorship" }).click();
    await page.waitForURL(/\/donor\/claims\/\d+/);
    await expect(page.getByText("Family Members & Wishes")).toBeVisible({ timeout: 10_000 });

    // Back to the claim list and set a non-default status filter.
    await page.getByRole("link", { name: "← My Sponsorships" }).click();
    await page.waitForURL("/donor/claims");
    await page.waitForLoadState("networkidle");

    const statusFilter = page.getByLabel("Sponsorship status filter");
    await statusFilter.selectOption("active");
    await expect(page.getByRole("button", { name: "Clear filters" })).toBeVisible();

    // Open the claim detail (the row's View link — the family cell is a
    // second link on the same row) and return via the header back link.
    await page.locator("tr[data-id]").first().getByRole("link", { name: "View" }).click();
    await page.waitForURL(/\/donor\/claims\/\d+/);
    await page.getByRole("link", { name: "← My Sponsorships" }).click();
    await page.waitForURL("/donor/claims");
    await page.waitForLoadState("networkidle");

    // The filter survived the round trip
    await expect(statusFilter).toHaveValue("active");

    // Clear filters restores the default
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(statusFilter).toHaveValue("");
    await expect(page.getByRole("button", { name: "Clear filters" })).not.toBeVisible();

    await context.close();
  });
});
