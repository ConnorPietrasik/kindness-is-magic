/**
 * Admin unsubscribe blocklist — an admin sees recipients who clicked an
 * unsubscribe link and re-subscribes them from the Unsubscribed Emails page.
 *
 * Self-contained: seeds the blocklist through the REAL public unsubscribe
 * path (a forged-but-validly-signed unsubscribe token POSTed to
 * /api/auth/unsubscribe/confirm — the same endpoint the footer link's
 * confirmation page calls) and removes the record via a best-effort API
 * re-subscribe in afterAll (the UI re-subscribe is the path under test).
 *
 * The seeded address is unique per run and belongs to no account — the
 * blocklist is keyed by address, not by user.
 */
import { test, expect } from "@playwright/test";
import type { APIRequestContext, Locator } from "@playwright/test";
import { getBaseUrl, getSecretKey } from "../helpers/env";
import { signJwtHS256 } from "../helpers/jwt";
import { loginViaApi } from "../helpers/api";
import { findRowInTable } from "../helpers/assertions";

const STORAGE_ADMIN = "storage/admin.json";

const suffix = Math.random().toString(36).slice(2, 8);
const EMAIL = `e2e-unsub-${suffix}@example.com`;

/**
 * Unsubscribe the seeded address via the public two-step endpoint (the
 * confirm POST is the half that writes the record).
 */
async function unsubscribeViaPublicApi(request: APIRequestContext): Promise<void> {
  const token = await signJwtHS256(getSecretKey(), {
    email: EMAIL,
    type: "unsubscribe",
    exp: Math.floor(Date.now() / 1000) + 86400,
  });
  const resp = await request.post(`${getBaseUrl()}/api/auth/unsubscribe/confirm?token=${encodeURIComponent(token)}`);
  if (!resp.ok()) {
    throw new Error(`unsubscribe seed failed (${resp.status()})`);
  }
}

test.describe.serial("Admin email unsubscribes", () => {
  test.beforeAll(async ({ request }) => {
    await unsubscribeViaPublicApi(request);

    // Verify the seed took effect (fail fast with the address if not)
    const api = await loginViaApi(request);
    const listResp = await api.get("/api/admin/emails/unsubscribes", { params: { search: EMAIL, page_size: 100 } });
    const body = await listResp.json();
    if (!listResp.ok() || body.preferences?.some((p) => p.email === EMAIL) !== true) {
      throw new Error(`seed verification failed: status=${listResp.status()} body=${JSON.stringify(body).slice(0, 300)}`);
    }
    await api.dispose();
  });

  test.afterAll(async ({ request: req }) => {
    // Best effort: the UI re-subscribe usually already removed the record.
    const api = await loginViaApi(req);
    const resp = await api.post("/api/admin/emails/unsubscribes/resubscribe", { data: { email: EMAIL } });
    if (resp.status() !== 204 && resp.status() !== 404) {
      console.log(`cleanup resubscribe: ${resp.status()}`);
    }
    await api.dispose();
  });

  test("an unsubscribed recipient appears on the Unsubscribed Emails page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: STORAGE_ADMIN });
    const page = await context.newPage();

    await page.goto("/admin/email-unsubscribes");
    await expect(page.getByRole("heading", { name: "Unsubscribed Emails" })).toBeVisible();

    const row = await findRowInTable(page, EMAIL);
    expect(row).not.toBeNull();
    await expect(row as Locator).toBeVisible();
    // The row carries the action to restore emails
    await expect((row as Locator).getByRole("button", { name: "Re-subscribe" })).toBeVisible();

    await context.close();
  });

  test("re-subscribing from the page removes the record", async ({ browser }) => {
    const context = await browser.newContext({ storageState: STORAGE_ADMIN });
    const page = await context.newPage();

    await page.goto("/admin/email-unsubscribes");
    const row = await findRowInTable(page, EMAIL);
    expect(row).not.toBeNull();

    // Row button — the dialog's confirm button carries the same label, so scope to the row
    await (row as Locator).getByRole("button", { name: "Re-subscribe" }).click();

    // Confirmation dialog names the recipient
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(EMAIL);

    await dialog.getByRole("button", { name: "Re-subscribe" }).click();

    // Success toast, dialog closed, row gone after the refetch
    await expect(page.getByRole("alert").filter({ hasText: `Re-subscribed ${EMAIL}` })).toBeVisible();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: EMAIL })).toHaveCount(0, { timeout: 10_000 });

    await context.close();
  });

  test("unsubscribing again puts the recipient back on the list", async ({ browser, request }) => {
    // Re-seed through the real public path
    await unsubscribeViaPublicApi(request);

    const context = await browser.newContext({ storageState: STORAGE_ADMIN });
    const page = await context.newPage();

    await page.goto("/admin/email-unsubscribes");
    const row = await findRowInTable(page, EMAIL);
    expect(row).not.toBeNull();

    await context.close();
  });
});
