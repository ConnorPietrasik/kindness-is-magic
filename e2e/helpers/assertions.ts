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

  // Fall back to pagination search
  for (let i = 0; i < maxPages; i++) {
    if ((await row.count()) > 0) return row;

    // Click "Next page" — if it doesn't exist or is disabled, we've reached the end
    const nextBtn = page.getByRole("button", { name: "Next page" });
    if ((await nextBtn.count()) === 0) break;
    if (await nextBtn.isDisabled()) break;
    await nextBtn.click();
    await page.waitForTimeout(pollMs);
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
