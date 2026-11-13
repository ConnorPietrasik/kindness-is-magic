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
  opts?: { maxPages?: number; timeout?: number },
): Promise<Locator | null> {
  return findInPaginated(page, page.getByRole("row").filter({ hasText: searchText }), opts);
}

/** 1-based offset of the first item on the current page ("Showing X–Y of Z"). */
async function listPageStart(page: Page): Promise<number | null> {
  // The text is absent on single-page lists (they show "N total" instead of a range) — keep it bounded.
  const text = await page
    .getByText(/Showing \d+\D+\d+ of \d+/)
    .first()
    .textContent({ timeout: 500 })
    .catch(() => null);
  const m = text?.match(/Showing (\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

/** Wait for the list container to be rendered (a full-page refetch spinner unmounts it). */
async function waitListVisible(page: Page): Promise<void> {
  await expect(page.locator("table, div.grid").first()).toBeVisible({ timeout: 10_000 }).catch(() => {});
}

/**
 * Settle on the page a page turn just landed on: the list re-renders in a
 * single commit, so the container being visible AND the "Showing X–Y of Z"
 * offset having moved from `beforeStart` means the new page's rows are
 * readable. Without this, a render delayed under parallel e2e load leaves
 * the walk reading the previous page's DOM and clicking through pages it
 * never actually reads.
 */
async function waitPageRendered(page: Page, beforeStart: number | null): Promise<void> {
  await waitListVisible(page);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const now = await listPageStart(page);
    // Offset moved (new page rendered) or the range text vanished (list
    // shrank to a single page, which shows "N total" instead) — either way
    // the current page is settled.
    if (now == null || (beforeStart != null && now !== beforeStart)) return;
    await page.waitForTimeout(100);
  }
}

/**
 * Turn a paginated list's pages (table rows, grid cards, …) until the given
 * item locator matches, or we run out of pages. Returns the Locator if an
 * item is found, or null after exhausting all pages. The item locator must
 * be scoped to the current page (e.g. a `filter({ hasText })` on the row or
 * card element).
 *
 * The list must start on page 1 and paginate with a "Next page" button.
 *
 * Two hazards on the shared e2e stack, both handled here:
 *  - every list refetch renders a FULL-PAGE spinner (rows + pagination
 *    unmounted until the data lands), so the pagination is only read after
 *    the list container is visible — an absent "Next page" button during a
 *    spinner is NOT the end of the list;
 *  - renders can be delayed under parallel load, so after each turn the
 *    walk waits for the new page to actually render (offset moved) before
 *    judging it.
 */
export async function findInPaginated(
  page: Page,
  item: Locator,
  opts?: { maxPages?: number; timeout?: number },
): Promise<Locator | null> {
  const maxPages = opts?.maxPages ?? 20;
  const timeout = opts?.timeout ?? 10_000;

  // First, wait for the item to appear (handles React Query invalidation delay)
  try {
    await item.first().waitFor({ state: "visible", timeout });
    return item;
  } catch {
    // Item didn't appear within timeout — try paginating
  }

  let pageNum = 1; // page the list is on before the first turn
  for (let i = 0; i < maxPages; i++) {
    if ((await item.count()) > 0) return item;

    // Settle before reading pagination: a refetch spinner unmounts the
    // buttons and would be misread as "single-page list".
    await waitListVisible(page);

    // Click "Next page" — if it doesn't exist or is disabled, we've reached the end.
    // The click is time-boxed and re-checked: a concurrent refetch can
    // re-render the list between the disabled-check and the click, and an
    // unbounded click would then hang on the now-disabled element until the
    // test timeout.
    const nextBtn = page.getByRole("button", { name: "Next page" });
    if ((await nextBtn.count()) === 0) break;

    const beforeStart = await listPageStart(page);
    let clicked = false;
    for (let attempt = 0; attempt < 3 && !clicked; attempt++) {
      if (await nextBtn.isDisabled()) break;
      const targetPage = pageNum + 1;
      const settled = page
        .waitForResponse(
          (r) =>
            r.request().method() === "GET" &&
            r.url().includes("/api/") &&
            r.url().includes(`page=${targetPage}&page_size=`),
          { timeout: 15_000 }
        )
        .catch(() => {});
      try {
        await nextBtn.click({ timeout: 3000 });
        clicked = true;
        pageNum = targetPage;
        await settled;
      } catch {
        // State changed under us — re-check
      }
    }
    if (!clicked) break;

    // Wait for the new page to actually render before judging it (see above).
    await waitPageRendered(page, beforeStart);
  }

  // The walk ended without finding the item. On a single-page list it broke
  // out immediately — while the list's own fetch (invalidated by the
  // mutation, possibly slow under parallel e2e load) may still be in flight:
  // the one-shot wait above already consumed its full budget. Give the
  // current page's pending fetch the same budget again before giving up.
  const finalDeadline = Date.now() + timeout;
  while ((await item.count()) === 0 && Date.now() < finalDeadline) {
    await page.waitForTimeout(100);
  }
  return (await item.count()) > 0 ? item : null;
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
