/**
 * Deadlines — the referrer_review deadline banner.
 *
 * Setup (API): the admin creates a referrer_review deadline row due TODAY.
 * Flow (UI): the CSV-seeded referrer sees the banner on the referrer
 * dashboard (next to the wish-review queue alert) and on the wish-review
 * queue page.
 * Teardown (API): the row is hard-deleted (only this test's record).
 *
 * The banner shows the *nearest future* dated row per type — a row due today
* beats every later-dated row, so it wins even when the stack carries other
 * referrer_review rows from manual testing (which we must not delete). The
 * test therefore asserts the rendered due date (deterministic with a
 * pinned locale/timezone), not the row's label.
 *
 * The banner is the *display* channel only. Enforcement (the gift-claim
 * gate, batch escalation) is covered by backend tests — an enforced row
 * here would race other tests' claims and queues, so it stays out of e2e.
 */
import { expect, test, request } from "@playwright/test";
import { createDeadlineViaApi, deleteDeadlineViaApi, loginViaApi } from "../helpers/api";

/* Unique label so re-runs without a DB wipe don't collide */
const SUFFIX = Math.random().toString(36).slice(2, 8);
const LABEL = `Wish review deadline ${SUFFIX}`;
/* Due date — today in UTC (the browser is pinned to UTC below) */
const DUE_DATE = new Date().toISOString().slice(0, 10);
/* The component formats the due date with en-US "medium" style (pinned locale) */
const EXPECTED_DUE_TEXT = new Date().toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" });

/* Track the created row's ID for cleanup */
let deadlineId: number | undefined;

test.describe("Referrer review deadline banner", () => {
  test.afterAll(async ({ request: req }) => {
    const authed = await loginViaApi(req);
    if (deadlineId) {
      await deleteDeadlineViaApi(authed, deadlineId);
    }
    await authed.dispose();
  });

  test("shows on the referrer dashboard and the wish-review page", async ({ browser }) => {
    /* ═══════════════════════════════════════════════════════════
     * Setup — deadline row via the admin API
     * ═══════════════════════════════════════════════════════════ */
    const adminApi = await request.newContext({ baseURL: "http://localhost" });
    await loginViaApi(adminApi);
    deadlineId = await createDeadlineViaApi(adminApi, {
      type: "referrer_review",
      label: LABEL,
      dueDate: DUE_DATE,
      mode: "display",
    });

    try {
      /* ═══════════════════════════════════════════════════════════
       * Step 1 — Referrer dashboard shows the banner
       * ═══════════════════════════════════════════════════════════ */
      const context = await browser.newContext({
        storageState: "storage/referrer.json",
        locale: "en-US",
        timezoneId: "UTC",
      });
      const page = await context.newPage();

      await page.goto("/dashboard");
      /* "due <date>" — the date span holds exactly the formatted due date */
      await expect(page.getByText(EXPECTED_DUE_TEXT, { exact: true })).toBeVisible({ timeout: 10_000 });

      /* ═══════════════════════════════════════════════════════════
       * Step 2 — Wish-review page shows the same banner
       * ═══════════════════════════════════════════════════════════ */
      await page.goto("/referrer/wish-review");
      await expect(page.getByText(EXPECTED_DUE_TEXT, { exact: true })).toBeVisible({ timeout: 10_000 });

      await context.close();
    } finally {
      await adminApi.dispose();
    }
  });
});
