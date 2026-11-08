/**
 * Admin email campaigns (batch email) — an admin creates a campaign from a
 * role selection plus manual addresses, watches the paced delivery progress,
 * verifies the sent-email log, and cancels a campaign mid-flight.
 *
 * Self-contained: the campaigns it creates are append-only (no delete
 * endpoint), and their delivery by-products (recipient audit rows, SentEmail
 * log rows) stay — the log is append-only by design. The run's role campaign
 * is canceled in afterAll so its paced deliveries stop at the end of the run;
 * beforeAll cancels any *active* campaigns left over from earlier interrupted
 * runs (no other spec creates campaigns) so this spec's delivery waits are
 * deterministic.
 *
 * Test order matters: the worker delivers campaigns FIFO (oldest active
 * first), so the cancel campaign runs first and reaches a terminal state
 * before the role campaign is created — otherwise the role campaign's
 * deliveries would queue behind it.
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
 *   campaign's consecutive sends are EMAIL_CAMPAIGN_INTERVAL_SECONDS (30s
 *   in the dev stack) apart — but the interval never spans campaigns. When
 *   a campaign settles or is canceled, the worker moves on after at most
 *   one idle poll (~10s) — the minimum gap between two campaigns' sends —
 *   so a campaign created right after another is canceled gets its first
 *   send within one idle poll (~10s) of its own creation: the worker picks
 *   it up at the previous campaign's pacing exit (if still inside it — the
 *   exit is measured from the earlier cancel, so it can't extend this
 *   wait) or on the next idle poll (≤ two idle polls after the cancel,
 *   measured from there). The delivery waits cap at 45s — several times
 *   that worst case: headroom for a slow or contended worker, and a quick
 *   failure when one is actually stuck — with a matching test.setTimeout.
 *   The cancel test waits for the first
 *   delivery, then cancels inside the pacing gap — the rest of the
 *   recipients are deterministically skipped.
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
    // Stop the last attempt's role campaign (the detail tests leave it
    // mid-flight) so nothing keeps sending after the run.
    const { campaigns } = await authed.get("/api/admin/email-campaigns").then((r) => r.json());
    for (const c of campaigns) {
      if (campaignSubject && c.subject === campaignSubject && (c.status === "pending" || c.status === "sending")) {
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
       45s: the first send goes out within one idle poll (~10s) of
       creation — even on a retry where the worker is still exiting the
       previous attempt's campaign (canceled by the retry's beforeAll;
       that pacing exit is measured from the earlier cancel, so it can't
       extend the wait from here). */
    const row = page.getByRole("row").filter({ hasText: CANCEL_SUBJECT });
    await row.click();
    const firstRow = page.getByRole("row").filter({ hasText: CANCEL_A });
    await expect(firstRow).toContainText("Sent", { timeout: 45_000 });

    /* We are now inside the 30s pacing gap before the next send — cancel
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
       within one idle poll (~10s) of creation — the worker picks it up at
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
