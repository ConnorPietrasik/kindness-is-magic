/**
 * Deadlines — deadline banners: referrer_review on the referrer pages,
 * gift_dropoff on the public families page.
 *
 * Each test creates its own deadline row due TODAY via the admin API and
 * hard-deletes only its own record afterwards.
 *
 * The banner shows the *nearest future* dated row per type — a row due today
* beats every later-dated row, so it wins even when the stack carries other
 * rows of the same type from manual testing (which we must not delete). The
 * tests therefore assert the rendered due date (deterministic with a
 * pinned locale/timezone), not the row's label.
 *
 * The banner is the *display* channel only. Enforcement (the gift-claim
 * gate, batch escalation) is covered by backend tests — an enforced row
 * here would race other tests' claims and queues, so it stays out of e2e.
 *
 * Rows are global config, not per-test data: while a test's row is live
 * (until afterAll) it is visible to every role — anonymous included — on
 * every page that renders that type's banner (referrer_review: the referrer
 * pages; gift_dropoff: /families, the wish list, the claim modal, donor
 * claims). Keep rows display-only and suffixed, and keep other specs'
 * assertions on those pages scoped (no whole-page text). A new row added
 * here must use a distinct type or a strictly later due date — two rows of
 * one type due today tie in the nearest-future selection.
 */
import { expect, test, request } from "@playwright/test";
import { getBaseUrl } from "../helpers/env";
import { createDeadlineViaApi, deleteDeadlineViaApi, loginViaApi } from "../helpers/api";

/* Unique label so re-runs without a DB wipe don't collide */
const SUFFIX = Math.random().toString(36).slice(2, 8);
const LABEL = `Wish review deadline ${SUFFIX}`;
/* Due date — today in UTC (the browser is pinned to UTC below) */
const DUE_DATE = new Date().toISOString().slice(0, 10);
/* The component formats the due date with en-US "medium" style (pinned locale) */
const EXPECTED_DUE_TEXT = new Date().toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" });

/* Track the created rows' IDs for cleanup */
let deadlineId: number | undefined;
let giftDeadlineId: number | undefined;

test.describe.serial("Deadline banners", () => {
  test.afterAll(async ({ request: req }) => {
    const authed = await loginViaApi(req);
    if (deadlineId) {
      await deleteDeadlineViaApi(authed, deadlineId);
    }
    if (giftDeadlineId) {
      await deleteDeadlineViaApi(authed, giftDeadlineId);
    }
    await authed.dispose();
  });

  test("shows on the referrer dashboard and the wish-review page", async ({ browser }) => {
    /* ═══════════════════════════════════════════════════════════
     * Setup — deadline row via the admin API
     * ═══════════════════════════════════════════════════════════ */
    const adminApi = await request.newContext({ baseURL: getBaseUrl() });
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

  test("shows the gift_dropoff banner on the public families page", async ({ browser }) => {
    /* ═══════════════════════════════════════════════════════════
     * Setup — deadline row via the admin API
     * ═══════════════════════════════════════════════════════════ */
    const adminApi = await request.newContext({ baseURL: getBaseUrl() });
    await loginViaApi(adminApi);
    giftDeadlineId = await createDeadlineViaApi(adminApi, {
      type: "gift_dropoff",
      label: `Gift drop-off ${SUFFIX}`,
      dueDate: DUE_DATE,
      mode: "display",
    });

    try {
      /* ═══════════════════════════════════════════════════════════
       * Anonymous visitor (the page is public — no storageState)
       * ═══════════════════════════════════════════════════════════ */
      const context = await browser.newContext({
        locale: "en-US",
        timezoneId: "UTC",
      });
      const page = await context.newPage();

      await page.goto("/families");
      /* "due <date>" — the date span holds exactly the formatted due date */
      await expect(page.getByText(EXPECTED_DUE_TEXT, { exact: true })).toBeVisible({ timeout: 10_000 });

      await context.close();
    } finally {
      await adminApi.dispose();
    }
  });
});
