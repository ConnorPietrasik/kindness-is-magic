/**
 * Admin email campaigns (batch email) — an admin creates a campaign from a
 * role selection plus manual addresses, watches the paced delivery progress,
 * verifies the sent-email log, cancels a campaign mid-flight, edits/sends/
 * deletes a draft, and waits out a scheduled campaign's send time.
 *
 * Self-contained: an activated campaign is an immutable audit record (only
 * drafts are deletable), so afterAll cancels any of the run's campaigns
 * still active (a failed attempt may have left one mid-flight) and deletes
 * the run's leftover drafts. beforeAll cancels any *active* campaigns left
 * over from earlier interrupted runs (no other spec creates campaigns) so
 * this spec's delivery waits are deterministic. The delivery by-products
 * (recipient audit rows, SentEmail log rows) stay — the log is append-only
 * by design.
 *
 * Test order matters: the worker is a single sequential loop (earliest-due
 * campaign first; oldest first among un-scheduled ones), so a campaign that
 * is still delivering holds the worker and queues everything else behind it
 * — the cancel campaign runs first and reaches a terminal state before the
 * later tests create theirs.
 *
 * Determinism notes:
 * - The "Admins" role campaign does NOT assert an exact recipient count —
 *   how many admin accounts the stack has varies. The test reads the count
 *   from the preview and asserts against it. The cancel campaign is
 *   manual-only (3 addresses), so its count and delivery order are exact.
 * - Role-resolved recipients are inserted before manual ones and delivery
 *   claims by row id, so the first "role" row in the recipient table is
 *   always the campaign's first delivery.
 * - Delivery is paced per campaign: one email per worker cycle, and a
 *   campaign's consecutive sends are EMAIL_CAMPAIGN_INTERVAL_SECONDS (15s
 *   in the dev stack — .env tunes the default 30s down so these tests stay
 *   fast; it must stay well above the UI's 5s progress refetch, since the
 *   cancel tests detect the first send through the UI) apart — but the
 *   interval never spans campaigns. When a campaign settles or is canceled,
 *   the worker moves on after at most one idle poll (~2s) — the minimum
 *   gap between two campaigns' sends — so a campaign created right after
 *   another is canceled gets its first send within one idle poll (~2s) of
 *   its own creation: the worker picks
 *   it up at the previous campaign's pacing exit (if still inside it — the
 *   exit is measured from the earlier cancel, so it can't extend this
 *   wait) or on the next idle poll (≤ two idle polls after the cancel,
 *   measured from there). The delivery waits cap at 45s — several times
 *   that worst case: headroom for a slow or contended worker, and a quick
 *   failure when one is actually stuck — with a matching test.setTimeout.
 *   The cancel test waits for the first
 *   delivery, then cancels inside the pacing gap — the rest of the
 *   recipients are deterministically skipped.
 * - The draft test runs second (right after the cancel test): its draft's
 *   "Send now" first send lands within one idle poll, because the worker
 *   is idle at that point (the cancel test's campaign is terminal and the
 *   draft sends nothing until activated).
 * - The schedule test's time is minute-precision (the picker), so it
 *   schedules for the next whole minute plus one (60–120s out). The first
 *   send can only land AT or AFTER the time, at most one idle poll later —
 *   so the wait is capped at ~180s (120s + 2s + headroom). Before the
 *   wait, no recipient rows exist yet (a scheduled campaign finalizes its
 *   recipients at send time): an early send (before the time) fails the
 *   test immediately instead of after 180s.
 * - Campaign names are per-attempt (test.info().retry). A serial-group
 *   retry re-runs beforeAll — which cancels every active campaign — and
 *   then re-runs the whole group. Fixed names would re-create same-subject
 *   campaigns: the duplicate list rows break the strict-mode row lookups,
 *   and the detail test would open the previous attempt's campaign that the
 *   retry's beforeAll just canceled — its rows read "Canceled" and can
 *   never turn "Sent", so the retry is doomed by construction. Fresh names
 *   give each attempt its own campaigns (created after the retry's
 *   cleanup), so a retry actually has a chance to pass.
 * - The bootstrap admin's address (.env ADMIN_EMAIL) must be a domain the
 *   mail layer's strict validation accepts: special-use TLDs like .test are
 *   rejected at send time (the row records "Failed — invalid_address" and can
 *   never turn "Sent"), which is why .env.example uses admin@example.com.
 */
import { test, expect } from "@playwright/test";
import type { Locator } from "@playwright/test";
import { loginViaApi } from "../helpers/api";
import { findRowInTable } from "../helpers/assertions";
import { getAdminEmail } from "../helpers/env";

const suffix = Math.random().toString(36).slice(2, 8);
const ADMIN_EMAIL = getAdminEmail();

/** Per-attempt identity: distinguishes this retry from the previous
    attempt's campaigns (the module random distinguishes processes/runs). */
function attemptSuffix(): string {
  return `${suffix}-r${test.info().retry}`;
}

/** The two manual recipient addresses of an attempt (unique — they can't
    belong to an account, so they always resolve as "manual" rows). */
function manualAddresses(s: string): [string, string] {
  return [`e2e-camp-a-${s}@example.com`, `e2e-camp-b-${s}@example.com`];
}

/* Per-attempt state shared by the create/detail tests (module state, not
   test state — describe.serial keeps the group on one worker). */
let campaignSubject = "";
let campaignMessage = "";
let campaignTotal = 0;
let setupAttempt = -1;
let scheduleSubject = "";
// The draft test's campaigns: its send-now campaign is canceled in-test,
// but a failed attempt may leave it active — or the drafts un-deleted.
let draftSubject = "";
let throwawaySubject = "";
let firstRoleEmail: string | undefined;

test.describe.serial("Admin email campaigns", () => {
  test.beforeAll(async ({ request: req }) => {
    const api = await loginViaApi(req);

    // Determinism: cancel active campaigns left over from interrupted runs
    // (only this spec creates campaigns) so delivery isn't queued behind
    // stale work. Also runs on every serial-group retry — it cancels the
    // previous attempt's mid-flight role campaign, which is why the
    // campaigns below are per-attempt (see attemptSuffix).
    const { campaigns } = await api.get("/api/admin/email-campaigns").then((r) => r.json());
    for (const c of campaigns) {
      if (c.status === "pending" || c.status === "sending") await api.post(`/api/admin/email-campaigns/${c.id}/cancel`);
    }
    await api.dispose();
  });

  test.afterAll(async ({ request: req }) => {
    const authed = await loginViaApi(req);
    // Stop the last attempt's still-active campaigns (the detail tests leave
    // the role campaign mid-flight; the schedule and draft tests usually
    // cancel theirs in-test, a failed attempt may not have) so nothing
    // keeps sending after the run, and delete leftover drafts — a draft
    // never sent, so there is no audit record to keep.
    const { campaigns } = await authed.get("/api/admin/email-campaigns").then((r) => r.json());
    const activeSubjects = [campaignSubject, scheduleSubject, draftSubject];
    const draftSubjects = [draftSubject, throwawaySubject];
    for (const c of campaigns) {
      const subject = c.subject as string;
      if (draftSubjects.some((s) => s && subject === s) && c.status === "draft") {
        await authed.delete(`/api/admin/email-campaigns/${c.id}`);
      } else if (activeSubjects.some((s) => s && subject === s) && (c.status === "pending" || c.status === "sending")) {
        await authed.post(`/api/admin/email-campaigns/${c.id}/cancel`);
      }
    }
    await authed.dispose();
  });

  test("canceling a campaign mid-flight skips the un-sent recipients", async ({ browser }) => {
    test.setTimeout(90_000);
    const s = attemptSuffix();
    const CANCEL_SUBJECT = `E2E cancel campaign ${s}`;
    const CANCEL_MESSAGE = `This campaign will be canceled ${s}.`;
    const CANCEL_A = `e2e-cancel-a-${s}@example.com`;
    const CANCEL_B = `e2e-cancel-b-${s}@example.com`;
    const CANCEL_C = `e2e-cancel-c-${s}@example.com`;

    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    /* Create a three-recipient, manual-only campaign (exact count) */
    await page.goto("/admin/emails?tab=campaigns");
    await page.getByRole("button", { name: "+ New campaign" }).click();
    const dialog = page.getByRole("dialog", { name: "New email campaign" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Extra email addresses").fill(`${CANCEL_A}\n${CANCEL_B}\n${CANCEL_C}`);
    await expect(dialog.getByText(/Will send to 3 recipients/)).toBeVisible();
    await dialog.getByLabel("Subject (optional)").fill(CANCEL_SUBJECT);
    await dialog.getByLabel("Message").fill(CANCEL_MESSAGE);
    await dialog.getByRole("button", { name: "Create campaign" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Campaign queued" })).toBeVisible();

    /* Open the detail and wait for the first (and soon only) delivery.
       45s: the first send goes out within one idle poll (~2s)
       of creation — even on a retry where the worker is still exiting the
       previous attempt's campaign (canceled by the retry's beforeAll;
       that pacing exit is measured from the earlier cancel, so it can't
       extend the wait from here). */
    const row = page.getByRole("row").filter({ hasText: CANCEL_SUBJECT });
    await row.click();
    const firstRow = page.getByRole("row").filter({ hasText: CANCEL_A });
    await expect(firstRow).toContainText("Sent", { timeout: 45_000 });

    /* We are now inside the 15s pacing gap before the next send — cancel
       immediately so the remaining recipients are deterministically
       pending and get flipped to canceled. */
    await page.getByRole("button", { name: "Cancel campaign" }).click();

    /* Canceled: badge, counts, and per-recipient statuses (the badge is
       testid-scoped — bare "Canceled" text also matches the counts line,
       the message body, and the canceled recipient cells). */
    await expect(page.getByRole("heading", { name: CANCEL_SUBJECT })).toBeVisible();
    await expect(page.getByTestId("campaign-status-badge")).toHaveText("Canceled");
    await expect(page.getByText("1/3 sent · 2 canceled")).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: CANCEL_B })).toContainText("Canceled");
    await expect(page.getByRole("row").filter({ hasText: CANCEL_C })).toContainText("Canceled");
    /* The first delivery stands */
    await expect(page.getByRole("row").filter({ hasText: CANCEL_A })).toContainText("Sent");
    /* The cancel affordance is gone for a terminal campaign */
    await expect(page.getByRole("button", { name: "Cancel campaign" })).not.toBeVisible();

    await context.close();
  });

  test("drafts can be edited, sent now, and deleted", async ({ browser }) => {
    test.setTimeout(120_000);
    const s = attemptSuffix();
    const DRAFT_SUBJECT = `E2E draft ${s}`;
    const EDITED_SUBJECT = `E2E draft edited ${s}`;
    const DRAFT_A = `e2e-draft-a-${s}@example.com`;
    const DRAFT_B = `e2e-draft-b-${s}@example.com`;
    const THROWAWAY_SUBJECT = `E2E draft throwaway ${s}`;
    const THROWAWAY_A = `e2e-draft-x-${s}@example.com`;

    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/admin/emails?tab=campaigns");

    /* Create a manual-only draft (exact count — two addresses). */
    await page.getByRole("button", { name: "+ New campaign" }).click();
    const dialog = page.getByRole("dialog", { name: "New email campaign" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Extra email addresses").fill(`${DRAFT_A}\n${DRAFT_B}`);
    await expect(dialog.getByText(/Will send to 2 recipients/)).toBeVisible();
    await dialog.getByLabel("Subject (optional)").fill(DRAFT_SUBJECT);
    await dialog.getByLabel("Message").fill(`Draft message ${s}.`);
    await dialog.getByRole("button", { name: "Save as draft" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Draft saved" })).toBeVisible();
    await expect(dialog).not.toBeVisible();
    draftSubject = DRAFT_SUBJECT;

    /* Listed with a Draft badge (the Progress cell says Draft, too). */
    const draftRow = page.getByRole("row").filter({ hasText: DRAFT_SUBJECT });
    await expect(draftRow).toBeVisible();
    await expect(draftRow.getByTestId("campaign-status-badge")).toHaveText("Draft");

    /* Detail: live recipient count + the "no audit yet" note. */
    await draftRow.click();
    await expect(page.getByTestId("campaign-status-badge")).toHaveText("Draft");
    await expect(page.getByText("Will send to 2")).toBeVisible();
    await expect(page.getByText(/Recipients are finalized when the campaign is sent/)).toBeVisible();

    /* Edit: change the subject, save the changes (no send). */
    await page.getByRole("button", { name: "Edit" }).click();
    const editDialog = page.getByRole("dialog", { name: "Edit campaign" });
    await expect(editDialog).toBeVisible();
    const subjectInput = editDialog.getByLabel("Subject");
    await expect(subjectInput).toHaveValue(DRAFT_SUBJECT);
    await subjectInput.fill(EDITED_SUBJECT);
    await editDialog.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Campaign updated" })).toBeVisible();
    await expect(page.getByRole("heading", { name: EDITED_SUBJECT })).toBeVisible();
    draftSubject = EDITED_SUBJECT; // the edit renamed it — track the new subject

    /* Send now: the snapshot freezes at this moment and delivery starts
       right away (the worker is idle here — the cancel test's campaign is
       terminal and a draft sends nothing until activated). */
    await page.getByRole("button", { name: "Send now" }).click();
    const rowA = page.getByRole("row").filter({ hasText: DRAFT_A });
    await expect(rowA).toContainText("Sent", { timeout: 45_000 });

    /* Cancel inside the pacing gap — the second recipient is skipped. */
    await page.getByRole("button", { name: "Cancel campaign" }).click();
    await expect(page.getByTestId("campaign-status-badge")).toHaveText("Canceled");
    await expect(page.getByText("1/2 sent · 1 canceled")).toBeVisible();

    /* A throwaway draft can be deleted (with confirmation). */
    await page.getByRole("button", { name: "← Back" }).click();
    await page.getByRole("button", { name: "+ New campaign" }).click();
    const draft2 = page.getByRole("dialog", { name: "New email campaign" });
    await draft2.getByLabel("Extra email addresses").fill(THROWAWAY_A);
    await draft2.getByLabel("Subject (optional)").fill(THROWAWAY_SUBJECT);
    await draft2.getByLabel("Message").fill(`Throwaway ${s}.`);
    await draft2.getByRole("button", { name: "Save as draft" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Draft saved" })).toBeVisible();
    throwawaySubject = THROWAWAY_SUBJECT;

    const throwawayRow = page.getByRole("row").filter({ hasText: THROWAWAY_SUBJECT });
    await expect(throwawayRow).toBeVisible();
    await throwawayRow.click();
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.getByRole("button", { name: "Yes, delete" }).click();

    /* Back in the list — the draft is gone. */
    await expect(page.getByRole("row").filter({ hasText: THROWAWAY_SUBJECT })).toHaveCount(0);

    await context.close();
  });

  test("scheduled campaigns wait for their send time", async ({ browser }) => {
    test.setTimeout(300_000);
    const s = attemptSuffix();
    const subject = `E2E scheduled ${s}`;
    scheduleSubject = subject;
    const SCHED_A = `e2e-sched-a-${s}@example.com`;
    const SCHED_B = `e2e-sched-b-${s}@example.com`;

    /* Next whole minute plus one: 60–120s out (the picker is
       minute-precision — truncating to the minute can only move the time
       back within the same minute, so the +2 minutes guarantees the
       future). */
    const t = new Date();
    t.setSeconds(0, 0);
    t.setMinutes(t.getMinutes() + 2);
    const pad = (n: number) => String(n).padStart(2, "0");
    const localTime = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`;

    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/admin/emails?tab=campaigns");
    await page.getByRole("button", { name: "+ New campaign" }).click();
    const dialog = page.getByRole("dialog", { name: "New email campaign" });
    await dialog.getByLabel("Extra email addresses").fill(`${SCHED_A}\n${SCHED_B}`);
    await dialog.getByLabel("Subject (optional)").fill(subject);
    await dialog.getByLabel("Message").fill(`Scheduled message ${s}.`);
    await dialog.locator('input[type="datetime-local"]').fill(localTime);

    /* The picked time relabels the primary button. */
    await dialog.getByRole("button", { name: "Schedule campaign" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /Campaign scheduled for/ })).toBeVisible();

    /* Scheduled: the badge, and no recipient rows exist yet (an early
       send before the time fails immediately, not after the wait). */
    const row = page.getByRole("row").filter({ hasText: subject });
    await expect(row.getByTestId("campaign-status-badge")).toHaveText("Scheduled");
    await expect(row).toContainText("At send time");
    await row.click();
    await expect(page.getByTestId("campaign-status-badge")).toHaveText("Scheduled");
    // No recipient audit yet — the list is finalized at send time.
    await expect(page.getByText(/Recipients are finalized when the campaign sends/)).toBeVisible();
    /* The first send lands at or after the time, at most one idle poll
       after it (cap: 119s + 2s + headroom). The recipient rows only exist
       once the worker resolves the selection at that moment. */
    const firstRow = page.getByRole("row").filter({ hasText: SCHED_A });
    await expect(firstRow).toContainText("Sent", { timeout: 180_000 });

    /* Cancel inside the pacing gap — the second recipient is skipped. */
    await page.getByRole("button", { name: "Cancel campaign" }).click();
    await expect(page.getByTestId("campaign-status-badge")).toHaveText("Canceled");

    await context.close();
  });

  test("admin creates a campaign from a role plus manual addresses", async ({ browser }) => {
    const s = attemptSuffix();
    const subject = `E2E campaign ${s}`;
    const message = `This is an e2e campaign message ${s}.`;
    const [manualA, manualB] = manualAddresses(s);

    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/admin/emails?tab=campaigns");
    await expect(page.getByRole("heading", { name: "Emails" })).toBeVisible();

    await page.getByRole("button", { name: "+ New campaign" }).click();
    const dialog = page.getByRole("dialog", { name: "New email campaign" });
    await expect(dialog).toBeVisible();

    /* Select the Admins role + two manual addresses; the debounced preview
       counts every resolved recipient. */
    await dialog.getByRole("checkbox", { name: "Admins" }).check();
    await dialog.getByLabel("Extra email addresses").fill(`${manualA}\n${manualB}`);
    const previewText = (await dialog.getByText(/Will send to \d+ recipients/).textContent()) ?? "";
    const match = previewText.match(/Will send to (\d+) recipients/);
    expect(match, `preview showed: ${previewText}`).not.toBeNull();
    const total = parseInt(match![1], 10);
    expect(total).toBeGreaterThanOrEqual(3); // the 2 manual + at least 1 admin

    /* Subject + message, then create */
    await dialog.getByLabel("Subject (optional)").fill(subject);
    await dialog.getByLabel("Message").fill(message);
    await dialog.getByRole("button", { name: "Create campaign" }).click();

    /* Success toast; dialog closes */
    await expect(page.getByRole("alert").filter({ hasText: "Campaign queued" })).toBeVisible();
    await expect(dialog).not.toBeVisible();

    /* Record this attempt's campaign as soon as the server has committed it
       — afterAll must cancel a leftover even if the assertions below fail.
       (setupAttempt stays last, so a failed create still skips detail/log.) */
    campaignSubject = subject;
    campaignMessage = message;
    campaignTotal = total;

    /* The campaign is listed with its roles and a Queued/Sending status */
    const row = page.getByRole("row").filter({ hasText: subject });
    await expect(row).toBeVisible();
    await expect(row).toContainText("admin");
    await expect(row).toContainText(/Queued|Sending/);
    /* The subject is a button, so the detail is keyboard-reachable */
    await expect(row.getByRole("button", { name: subject })).toBeVisible();

    /* Mark setup complete last, so a failed create leaves setupAttempt stale
       and the detail/log tests skip. */
    setupAttempt = test.info().retry;

    await context.close();
  });

  test("the detail view shows the message and the recipient audit, and delivery progresses", async ({ browser }) => {
    test.setTimeout(90_000);
    test.skip(test.info().retry !== setupAttempt, "setup incomplete");

    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/admin/emails?tab=campaigns");
    const row = page.getByRole("row").filter({ hasText: campaignSubject });
    await expect(row).toBeVisible();
    await row.click();

    /* Detail: subject heading, stored message body (the meta card, not a
       table cell) */
    await expect(page.getByRole("heading", { name: campaignSubject })).toBeVisible();
    await expect(page.getByText(campaignMessage)).toBeVisible();

    /* Recipient audit: the two manual rows (unique addresses that can't
       belong to an account) show as manual, and every resolved admin row
       shows as role — exactly campaignTotal - 2 of them. */
    const [manualA, manualB] = manualAddresses(attemptSuffix());
    await expect(page.getByRole("row").filter({ hasText: manualA })).toContainText("manual");
    await expect(page.getByRole("row").filter({ hasText: manualB })).toContainText("manual");
    const roleRows = page.getByRole("row").filter({ hasText: "role" });
    expect(await roleRows.count()).toBe(campaignTotal - 2);
    /* The bootstrap admin (the smallest-id admin) is the first role row */
    const firstRoleRow = roleRows.first();
    firstRoleEmail = (await firstRoleRow.getByRole("cell").first().textContent()) ?? undefined;
    expect(firstRoleEmail).toBe(ADMIN_EMAIL);

    /* Delivery is paced per campaign: this campaign's first send goes out
       within one idle poll (~2s) of creation — the worker picks it up at
       the previous campaign's pacing exit (if still inside it) or on the
       next idle poll. 45s is headroom for a slow/contended worker. */
    await expect(firstRoleRow).toContainText("Sent", { timeout: 45_000 });

    await context.close();
  });

  test("the campaign email appears in the sent log as kind Email Campaign", async ({ browser }) => {
    // Only meaningful when this attempt's detail test ran and delivered the
    // first role row (a serial-group retry starts fresh: see setupAttempt).
    if (test.info().retry !== setupAttempt || !firstRoleEmail) {
      test.skip(true, "setup incomplete");
      return;
    }

    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/admin/emails");
    await expect(page.getByRole("heading", { name: "Emails" })).toBeVisible();

    /* Narrow to campaign emails so the row is unambiguous */
    await page.getByLabel("Kind filter").selectOption({ label: "Email Campaign" });

    /* Newest-first log: the first match is this run's delivery (earlier
       runs' rows for the same address sort below it). */
    const logRow = (await findRowInTable(page, firstRoleEmail))?.first();
    expect(logRow).not.toBeNull();
    await expect(logRow as Locator).toContainText("Sent");

    await context.close();
  });
});
