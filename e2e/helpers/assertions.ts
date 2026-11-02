import type { Page, Locator } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Navigate a paginated table's pages until a row containing the given text
 * is found, or we run out of pages. Returns a Locator to the row if found,
 * or null if not found after exhausting all pages.
 *
 * This is needed because accumulated test data from prior runs can push new
 * records off the first page of paginated admin tables.
 */
export async function findRowInTable(
  page: Page,
  searchText: string,
  opts?: { maxPages?: number; pollMs?: number; timeout?: number },
): Promise<Locator | null> {
  const maxPages = opts?.maxPages ?? 20;
  const pollMs = opts?.pollMs ?? 500;
  const timeout = opts?.timeout ?? 10_000;

  // First, wait for the row to appear (handles React Query invalidation delay)
  // Playwright's toHaveCount/toBeVisible with timeout handles retries
  const row = page.getByRole("row").filter({ hasText: searchText });
  try {
    await row.first().waitFor({ state: "visible", timeout });
    return row;
  } catch {
    // Row didn't appear within timeout — try paginating
  }

  // Fall back to pagination search. After each page turn, wait for the list
  // fetch it triggered to settle before judging the page — a blind sleep
  // skips pages when the fetch is slow (e.g. under parallel e2e load).
  for (let i = 0; i < maxPages; i++) {
    if ((await row.count()) > 0) return row;

    // Click "Next page" — if it doesn't exist or is disabled, we've reached the end
    const nextBtn = page.getByRole("button", { name: "Next page" });
    if ((await nextBtn.count()) === 0) break;
    if (await nextBtn.isDisabled()) break;

    // The page turn fires exactly one list GET — wait for the response to that
    // request specifically so the next iteration's row check never runs against
    // a half-loaded page. "page=" pins the wait to the paginated list request
    // (every list endpoint sends page/page_size; non-list GETs — detail, dropdown —
    // carry no such param, so a coincidental concurrent GET can't resolve the
    // wait early and make the next iteration click past the page holding the
    // row). The startTime filter additionally excludes GETs already in flight
    // (e.g. a window-focus refetch of the current page).
    const clickAt = Date.now();
    const settled = page
      .waitForResponse(
        (r) =>
          r.request().method() === "GET" &&
          r.url().includes("/api/") &&
          r.url().includes("page=") &&
          r.request().timing().startTime >= clickAt,
        { timeout: pollMs * 10 }
      )
      .catch(() => {});
    await nextBtn.click();
    await settled;
  }
  return null;
}

/**
 * Assert that a table on the page contains a row with the given text.
 */
export async function expectTableContains(page: Page, text: string): Promise<void> {
  await expect(page.getByRole("table")).toContainText(text);
}

/**
 * Assert that a table does NOT contain the given text.
 */
export async function expectTableNotContains(page: Page, text: string): Promise<void> {
  await expect(page.getByRole("table")).not.toContainText(text);
}

/**
 * Assert the page navigated to the expected URL path.
 */
export async function expectRedirect(page: Page, expectedPath: string): Promise<void> {
  await expect(page).toHaveURL(new RegExp(`${expectedPath.replace("/", "\\/")}.*`));
}

/**
 * Wait for a specific heading to be visible (handles lazy-loaded pages).
 */
export async function expectHeading(page: Page, text: string): Promise<void> {
  await expect(page.getByRole("heading", { name: text })).toBeVisible();
}

/**
 * Assert an error box / error message is visible with the given text.
 */
export async function expectErrorMessage(page: Page, text: string): Promise<void> {
  /* ErrorBox uses a red background; look for text in a container */
  await expect(page.getByText(text)).toBeVisible();
}

/**
 * Wait for a card (generic container) to contain specific text.
 */
export async function expectCardContains(page: Page, text: string): Promise<void> {
  /* Cards are rounded-xl border elements; use getByText as fallback */
  await expect(page.getByText(text)).toBeVisible();
}

/**
 * Assert that the page shows the login form (used to verify redirects).
 */
export async function expectLoginForm(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
}

/**
 * Click a row in a table by finding the row that contains the given text,
 * then clicking a button within that row.
 */
export async function clickRowButton(
  page: Page,
  rowText: string,
  buttonName: string,
): Promise<void> {
  const row = page.getByRole("row").filter({ hasText: rowText });
  await row.getByRole("button", { name: buttonName }).click();
}

/**
 * Fill a form field by its label text and submit the form.
 */
export async function fillAndSubmit(
  page: Page,
  label: string,
  value: string,
  submitButtonName: string = "Create",
): Promise<void> {
  await page.getByLabel(label).fill(value);
  await page.getByRole("button", { name: submitButtonName }).click();
}

/**
 * Assert that a success/confirmation message is visible.
 */
export async function expectSuccessMessage(page: Page, text: string): Promise<void> {
  await expect(page.getByText(text)).toBeVisible();
}
