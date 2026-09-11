/**
 * Admin Deadlines — settings-page CRUD for event deadline rows.
 *
 * Driven entirely through the UI: create from the "Add deadline" form →
 * inline row edit (mode + due date) → delete. The delete test doubles as
 * cleanup, so a fully passing run leaves no trace; afterAll retries the UI
 * delete as a safety net for partial failure (describe.serial skips the
 * remaining tests after a failure, which would otherwise strand the row).
 *
 * Only `display` and `remind` modes are exercised. `enforced` rows change
 * live app behaviour (claim gates, auto-promotion) and would race other
 * tests' data, so they stay out of e2e — backend tests cover them, and
 * deadlines-banner.spec.ts gives the same reasoning for the banner
 * (display-channel) coverage.
 *
 * Contexts pin locale/timezone to UTC so the Scheduled / Past due status
 * badges are deterministic against the due dates computed here. The label
 * carries a random suffix so re-runs without a DB wipe don't collide with
 * stale rows from prior runs.
 */
import { test, expect, type Page } from "@playwright/test";

const SUFFIX = Math.random().toString(36).slice(2, 8);
const LABEL = `E2E Deadline ${SUFFIX}`;

/** Date-only (YYYY-MM-DD) UTC date N days from today. */
function isoDateDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

const FUTURE_DATE = isoDateDaysFromNow(30);
const PAST_DATE = isoDateDaysFromNow(-1);

const ADMIN_CONTEXT_OPTIONS = {
  storageState: "storage/admin.json",
  locale: "en-US",
  timezoneId: "UTC",
} as const;

/**
 * The row for a deadline label. The label lives only in the row's input
 * value (not visible text), so rows are matched on the input's exact
 * `value` attribute rather than `hasText`.
 */
function deadlineRow(page: Page, label: string) {
  return page.getByRole("row").filter({ has: page.locator(`input[type="text"][value="${label}"]`) });
}

test.describe.serial("Admin Deadlines — settings page", () => {
  test.afterAll(async ({ browser }) => {
    /* Safety-net cleanup via the page's own Delete action (UI, not API). */
    const context = await browser.newContext(ADMIN_CONTEXT_OPTIONS);
    const page = await context.newPage();
    await page.goto("/admin/deadlines");
    /* Wait for the lazy page to render — count() below is not a wait */
    await expect(page.getByRole("heading", { name: "Event Deadlines" })).toBeVisible();
    const row = deadlineRow(page, LABEL);
    if (await row.count()) {
      await row.getByRole("button", { name: "Delete" }).click();
      await page.getByRole("button", { name: "Yes, delete" }).click();
      await expect(row).toHaveCount(0, { timeout: 10_000 });
    }
    await context.close();
  });

  test("admin creates a deadline row from the Add deadline form", async ({ browser }) => {
    const context = await browser.newContext(ADMIN_CONTEXT_OPTIONS);
    const page = await context.newPage();

    await page.goto("/admin/deadlines");
    await expect(page.getByRole("heading", { name: "Event Deadlines" })).toBeVisible();

    /* The create form is the only <form> on the page — scope to it. */
    const form = page.locator("form");
    await expect(page.getByRole("heading", { name: "Add deadline" })).toBeVisible();

    /* Defaults: Family information type with its pre-filled label, Display only mode */
    await expect(form.getByLabel("Type")).toHaveValue("family_info");
    await expect(form.getByLabel("Label")).toHaveValue("Family information");
    await expect(form.getByLabel("Mode")).toHaveValue("display");

    /* Switching type re-fills the label and the enforced-mode hint */
    await form.getByLabel("Type").selectOption("referrer_review");
    await expect(form.getByLabel("Label")).toHaveValue("Referrer review");
    await expect(form.getByText("Enforced auto-promotes submitted families to admin review")).toBeVisible();

    /* Unique label + future due date; mode stays Display only */
    await form.getByLabel("Label").fill(LABEL);
    /* The create form's date picker is a datetime-local input (rows use type="date") */
    await form.locator('input[type="datetime-local"]').fill(`${FUTURE_DATE}T00:00`);

    await form.getByRole("button", { name: "Add deadline" }).click();
    await expect(page.getByText("Deadline added", { exact: true })).toBeVisible();

    const row = deadlineRow(page, LABEL);
    await expect(row).toHaveCount(1, { timeout: 10_000 });
    await expect(row.getByText("Referrer review", { exact: true })).toBeVisible();
    await expect(row.locator('input[type="date"]')).toHaveValue(FUTURE_DATE);
    await expect(row.locator("select")).toHaveValue("display");
    await expect(row.getByText("Scheduled", { exact: true })).toBeVisible();

    await context.close();
  });

  test("admin edits a deadline row inline and saves", async ({ browser }) => {
    const context = await browser.newContext(ADMIN_CONTEXT_OPTIONS);
    const page = await context.newPage();

    await page.goto("/admin/deadlines");

    const row = deadlineRow(page, LABEL);
    await expect(row).toHaveCount(1, { timeout: 10_000 });

    /* Save is inert until the row is dirty */
    const saveButton = row.getByRole("button", { name: "Save" });
    await expect(saveButton).toBeDisabled();

    /* Mode → Reminders (banner-inert), due date → yesterday */
    await row.locator("select").selectOption({ label: "Reminders (no email yet)" });
    await row.locator('input[type="date"]').fill(PAST_DATE);
    await expect(saveButton).toBeEnabled();

    await saveButton.click();
    await expect(page.getByText("Deadline saved", { exact: true })).toBeVisible();

    await expect(row.locator("select")).toHaveValue("remind");
    await expect(row.locator('input[type="date"]')).toHaveValue(PAST_DATE);
    await expect(row.getByText("Past due", { exact: true })).toBeVisible();

    await context.close();
  });

  test("admin deletes a deadline row", async ({ browser }) => {
    const context = await browser.newContext(ADMIN_CONTEXT_OPTIONS);
    const page = await context.newPage();

    await page.goto("/admin/deadlines");

    const row = deadlineRow(page, LABEL);
    await expect(row).toHaveCount(1, { timeout: 10_000 });

    await row.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText(`Delete the "${LABEL}" deadline?`)).toBeVisible();
    await page.getByRole("button", { name: "Yes, delete" }).click();
    await expect(page.getByText("Deadline deleted", { exact: true })).toBeVisible();
    await expect(row).toHaveCount(0, { timeout: 10_000 });

    await context.close();
  });
});
