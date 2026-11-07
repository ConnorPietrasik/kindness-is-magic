/**
 * Admin email campaigns (batch email) — an admin creates a campaign from a
 * role selection plus manual addresses, watches the paced delivery progress,
 * verifies the Sent Emails log, and cancels a campaign mid-flight.
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
 * - Delivery is paced (EMAIL_CAMPAIGN_INTERVAL_SECONDS, 30s in the dev
 *   stack): the first email goes out within ~one idle-poll of creation;
 *   the second, 30s after the first. The cancel test waits for the first
 *   delivery, then cancels inside the pacing gap — the rest of the
 *   recipients are deterministically skipped.
 */
import { test, expect } from "@playwright/test";
import type { Locator } from "@playwright/test";
import { loginViaApi } from "../helpers/api";
import { findRowInTable } from "../helpers/assertions";
import { getAdminEmail } from "../helpers/env";

const suffix = Math.random().toString(36).slice(2, 8);
const ADMIN_EMAIL = getAdminEmail();

const CAMPAIGN_SUBJECT = `E2E campaign ${suffix}`;
const CAMPAIGN_MESSAGE = `This is an e2e campaign message ${suffix}.`;
const MANUAL_A = `e2e-camp-a-${suffix}@example.com`;
const MANUAL_B = `e2e-camp-b-${suffix}@example.com`;

const CANCEL_SUBJECT = `E2E cancel campaign ${suffix}`;
const CANCEL_MESSAGE = `This campaign will be canceled ${suffix}.`;
const CANCEL_A = `e2e-cancel-a-${suffix}@example.com`;
const CANCEL_B = `e2e-cancel-b-${suffix}@example.com`;
const CANCEL_C = `e2e-cancel-c-${suffix}@example.com`;

let campaignTotal = 0;
let firstRoleEmail: string | undefined;

test.describe.serial("Admin email campaigns", () => {
  test.beforeAll(async ({ request: req }) => {
    const api = await loginViaApi(req);

    // Determinism: cancel active campaigns left over from interrupted runs
    // (only this spec creates campaigns) so delivery isn't queued behind
    // stale work.
    const { campaigns } = await api.get("/api/admin/email-campaigns").then((r) => r.json());
    for (const c of campaigns) {
      if (c.status === "pending" || c.status === "sending") await api.post(`/api/admin/email-campaigns/${c.id}/cancel`);
    }
    await api.dispose();
  });

  test.afterAll(async ({ request: req }) => {
    const authed = await loginViaApi(req);
    // Stop the role campaign's paced deliveries (the detail tests leave it
    // mid-flight) so nothing keeps sending after the run.
    const { campaigns } = await authed.get("/api/admin/email-campaigns").then((r) => r.json());
    for (const c of campaigns) {
      if (c.subject === CAMPAIGN_SUBJECT && (c.status === "pending" || c.status === "sending")) {
        await authed.post(`/api/admin/email-campaigns/${c.id}/cancel`);
      }
    }
    await authed.dispose();
  });

  test("canceling a campaign mid-flight skips the un-sent recipients", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    /* Create a three-recipient, manual-only campaign (exact count) */
    await page.goto("/admin/email-campaigns");
    await page.getByRole("button", { name: "+ New campaign" }).click();
    const dialog = page.getByRole("dialog", { name: "New email campaign" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Extra email addresses").fill(`${CANCEL_A}\n${CANCEL_B}\n${CANCEL_C}`);
    await expect(dialog.getByText(/Will send to 3 recipients/)).toBeVisible();
    await dialog.getByLabel("Subject (optional)").fill(CANCEL_SUBJECT);
    await dialog.getByLabel("Message").fill(CANCEL_MESSAGE);
    await dialog.getByRole("button", { name: "Create campaign" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Campaign queued" })).toBeVisible();

    /* Open the detail and wait for the first (and soon only) delivery */
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
    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/admin/email-campaigns");
    await expect(page.getByRole("heading", { name: "Email Campaigns" })).toBeVisible();

    await page.getByRole("button", { name: "+ New campaign" }).click();
    const dialog = page.getByRole("dialog", { name: "New email campaign" });
    await expect(dialog).toBeVisible();

    /* Select the Admins role + two manual addresses; the debounced preview
       counts every resolved recipient. */
    await dialog.getByRole("checkbox", { name: "Admins" }).check();
    await dialog.getByLabel("Extra email addresses").fill(`${MANUAL_A}\n${MANUAL_B}`);
    const previewText = (await dialog.getByText(/Will send to \d+ recipients/).textContent()) ?? "";
    const match = previewText.match(/Will send to (\d+) recipients/);
    expect(match, `preview showed: ${previewText}`).not.toBeNull();
    campaignTotal = parseInt(match![1], 10);
    expect(campaignTotal).toBeGreaterThanOrEqual(3); // the 2 manual + at least 1 admin

    /* Subject + message, then create */
    await dialog.getByLabel("Subject (optional)").fill(CAMPAIGN_SUBJECT);
    await dialog.getByLabel("Message").fill(CAMPAIGN_MESSAGE);
    await dialog.getByRole("button", { name: "Create campaign" }).click();

    /* Success toast; dialog closes */
    await expect(page.getByRole("alert").filter({ hasText: "Campaign queued" })).toBeVisible();
    await expect(dialog).not.toBeVisible();

    /* The campaign is listed with its roles and a Queued/Sending status */
    const row = page.getByRole("row").filter({ hasText: CAMPAIGN_SUBJECT });
    await expect(row).toBeVisible();
    await expect(row).toContainText("admin");
    await expect(row).toContainText(/Queued|Sending/);
    /* The subject is a button, so the detail is keyboard-reachable */
    await expect(row.getByRole("button", { name: CAMPAIGN_SUBJECT })).toBeVisible();

    await context.close();
  });

  test("the detail view shows the message and the recipient audit, and delivery progresses", async ({ browser }) => {
    test.skip(campaignTotal === 0, "setup incomplete");

    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/admin/email-campaigns");
    const row = page.getByRole("row").filter({ hasText: CAMPAIGN_SUBJECT });
    await expect(row).toBeVisible();
    await row.click();

    /* Detail: subject heading, stored message body (the meta card, not a
       table cell) */
    await expect(page.getByRole("heading", { name: CAMPAIGN_SUBJECT })).toBeVisible();
    await expect(page.getByText(CAMPAIGN_MESSAGE)).toBeVisible();

    /* Recipient audit: the two manual rows + every resolved admin row */
    await expect(page.getByRole("row").filter({ hasText: MANUAL_A })).toContainText("manual");
    await expect(page.getByRole("row").filter({ hasText: MANUAL_B })).toContainText("manual");
    const roleRows = page.getByRole("row").filter({ hasText: "role" });
    expect(await roleRows.count()).toBe(campaignTotal - 2);
    /* The bootstrap admin (the smallest-id admin) is the first role row */
    const firstRoleRow = roleRows.first();
    firstRoleEmail = (await firstRoleRow.getByRole("cell").first().textContent()) ?? undefined;
    expect(firstRoleEmail).toBe(ADMIN_EMAIL);

    /* Delivery is paced: the first recipient flips to Sent within one
       idle-poll of creation (or was already delivered while the previous
       test ran). */
    await expect(firstRoleRow).toContainText("Sent", { timeout: 45_000 });

    await context.close();
  });

  test("the campaign email appears in the Sent Emails log as kind Email Campaign", async ({ browser }) => {
    if (!firstRoleEmail) {
      test.skip(true, "setup incomplete");
      return;
    }

    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/admin/emails");
    await expect(page.getByRole("heading", { name: "Sent Emails" })).toBeVisible();

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
