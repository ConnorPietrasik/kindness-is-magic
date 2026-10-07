/**
 * Admin custom emails — an admin sends a freeform ("custom") email from a
 * family's detail page and verifies the attempt in the Sent Emails log.
 *
 * Self-contained: creates its own referrer, family, and family contact user
 * via API in setup (the contact user supplies the "Send email" recipient
 * prefill) and deletes all of them in afterAll. The SentEmail log row is a
 * natural by-product of the flow and stays (the log is append-only).
 */
import { test, expect } from "@playwright/test";
import type { Locator } from "@playwright/test";
import {
  createFamilyUserViaApi,
  createFamilyViaApi,
  createReferrerWithUser,
  deleteFamilyViaApi,
  deleteReferrerViaApi,
  deleteUserViaApi,
  loginViaApi,
} from "../helpers/api";
import { findRowInTable } from "../helpers/assertions";

const suffix = Math.random().toString(36).slice(2, 8);
const FAMILY_NAME = `E2E Mail Family ${suffix}`;
const FAMILY_USER_EMAIL = `e2e-mail-${suffix}@example.com`;
const SUBJECT = `E2E subject ${suffix}`;
const MESSAGE = `This is an e2e custom message ${suffix}.`;

let referrerId: number | undefined;
let referrerUserId: number | undefined;
let familyId: number | undefined;
let familyUserId: number | undefined;

test.describe.serial("Admin custom emails", () => {
  test.beforeAll(async ({ request: req }) => {
    const api = await loginViaApi(req);

    // Own referrer so the family (and its display position) is isolated from
    // every other spec's data.
    const referrer = await createReferrerWithUser(api, {
      name: `E2E Mail Ref ${suffix}`,
      familyLimit: 5,
      phoneNumber: "555-000-9999",
      email: `e2e-mail-ref-${suffix}@example.com`,
      password: "Password123!",
    });
    referrerId = referrer.referrerId;
    referrerUserId = referrer.userId;

    const family = await createFamilyViaApi(api, referrer.referrerId, {
      familyName: FAMILY_NAME,
      familyWish: "A warm blanket for everyone",
      contactName: `Contact ${suffix}`,
      phoneNumber: "555-111-2222",
      address: "123 E2E Lane",
    });
    familyId = family.familyId;

    // The family contact user is what the "Send email" recipient prefill reads.
    const user = await createFamilyUserViaApi(api, {
      email: FAMILY_USER_EMAIL,
      password: "Password123!",
      familyId,
    });
    familyUserId = user.userId;

    await api.dispose();
  });

  test.afterAll(async ({ request: req }) => {
    const authed = await loginViaApi(req);
    if (familyId) await deleteFamilyViaApi(authed, familyId);
    if (familyUserId) await deleteUserViaApi(authed, familyUserId);
    if (referrerUserId) await deleteUserViaApi(authed, referrerUserId);
    if (referrerId) await deleteReferrerViaApi(authed, referrerId);
    await authed.dispose();
  });

  test("admin sends a custom email from the family detail page", async ({ browser }) => {
    test.skip(!familyId || !familyUserId, "setup incomplete");

    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto(`/admin/families/${familyId}/people`);
    await expect(page.getByRole("heading", { name: "Family & People" })).toBeVisible();

    /* Open the composer from the header toolbar */
    await page.getByRole("button", { name: "Send email" }).click();
    await expect(page.getByRole("heading", { name: "Send email" })).toBeVisible();

    /* Recipient is prefilled from the family contact user's email */
    await expect(page.getByLabel("Recipient")).toHaveValue(FAMILY_USER_EMAIL);

    /* Fill subject + message and check the live preview mirrors them */
    await page.getByLabel("Subject (optional)").fill(SUBJECT);
    await page.getByLabel("Message").fill(MESSAGE);
    await expect(page.getByText(`To: ${FAMILY_USER_EMAIL}`)).toBeVisible();
    /* getByRole("paragraph") — getByText would also match the Message textarea */
    await expect(page.getByRole("paragraph").filter({ hasText: MESSAGE })).toBeVisible();

    /* exact: true — the header "Send email" button also matches /Send/ */
    await page.getByRole("button", { name: "Send", exact: true }).click();

    /* Success toast, dialog closes */
    await expect(page.getByRole("alert").filter({ hasText: "Email sent" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Send email" })).not.toBeVisible();

    await context.close();
  });

  test("the custom email is logged on the Sent Emails page", async ({ browser }) => {
    test.skip(!familyId, "setup incomplete");

    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/admin/emails");
    await expect(page.getByRole("heading", { name: "Sent Emails" })).toBeVisible();

    /* Narrow to custom messages so the row is unambiguous */
    await page.getByLabel("Kind filter").selectOption({ label: "Custom Message" });

    const row = await findRowInTable(page, FAMILY_USER_EMAIL);
    expect(row).not.toBeNull();
    await expect(row as Locator).toContainText("Custom Message");
    await expect(row as Locator).toContainText("Sent");

    await context.close();
  });
});
