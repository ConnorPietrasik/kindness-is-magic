/**
 * Admin cash-only family lock ("already shopping").
 *
 * Admin locks a fully-approved family to cash sponsorships via the edit form;
 * the public wish-list page shows an "(already shopping)" marker, and a
 * donor's claim modal offers cash only (no gifts option).
 *
 * Self-contained: all data is API-created with unique suffixes and cleaned up
 * in afterAll (only records this spec created — never CSV-seeded rows).
 */
import { test, expect } from "@playwright/test";
import {
  createReferrerWithUserAndCredentials,
  createFamilyViaApi,
  createDonorWithUser,
  fullyApproveFamilyViaApi,
  deleteFamilyViaApi,
  deleteReferrerViaApi,
  deleteUserViaApi,
  loginViaApi,
} from "../helpers/api";
import { findRowInTable } from "../helpers/assertions";

const SUFFIX = Math.random().toString(36).slice(2, 8);
const PASSWORD = "Password123!";
const FAMILY_NAME = `Cash Only Family ${SUFFIX}`;
const BIO = `E2E cash-only family ${SUFFIX}`;

const testData: {
  referrerId?: number;
  familyId?: number;
  donorUserId?: number;
  donorEmail: string;
  donorPassword: string;
} = {
  donorEmail: `e2e-cashonly-donor-${SUFFIX}@example.com`,
  donorPassword: PASSWORD,
};

test.describe.serial("Admin cash-only family lock", () => {
  test.beforeAll(async ({ request: req }) => {
    const api = await loginViaApi(req);

    const referrer = await createReferrerWithUserAndCredentials(api, {
      name: `E2E CashOnly Ref ${SUFFIX}`,
      familyLimit: 5,
      phoneNumber: "555-000-8888",
      email: `e2e-cashonly-ref-${SUFFIX}@example.com`,
      password: PASSWORD,
    });
    testData.referrerId = referrer.referrerId;

    const family = await createFamilyViaApi(api, referrer.referrerId, {
      familyName: FAMILY_NAME,
      familyWish: "A warm winter",
      contactName: `CashOnly Contact ${SUFFIX}`,
      phoneNumber: "555-222-3333",
      address: `1 Cash Avenue ${SUFFIX}`,
      bio: BIO,
    });
    testData.familyId = family.familyId;

    /* Donor-visible: fully approved (admin lock) */
    await fullyApproveFamilyViaApi(api, family.familyId);

    const donor = await createDonorWithUser(api, {
      email: testData.donorEmail,
      password: testData.donorPassword,
      displayName: `CashOnly Donor ${SUFFIX}`,
    });
    testData.donorUserId = donor.userId;

    await api.dispose();
  });

  test.afterAll(async ({ request: req }) => {
    const api = await loginViaApi(req);
    if (testData.familyId) await deleteFamilyViaApi(api, testData.familyId);
    /* Deleting the referrer cascade-soft-deletes its linked user account too —
       no separate user delete for the referrer. */
    if (testData.referrerId) await deleteReferrerViaApi(api, testData.referrerId);
    if (testData.donorUserId) await deleteUserViaApi(api, testData.donorUserId);
    await api.dispose();
  });

  test("locking a family cash-only shows '(already shopping)' to donors and hides the gifts option", async ({ browser }) => {
    /* ── Admin: lock the family via the edit form ── */
    const adminContext = await browser.newContext({ storageState: "storage/admin.json" });
    const adminPage = await adminContext.newPage();

    await adminPage.goto("/admin/families");
    await expect(adminPage.getByRole("heading", { name: "Manage Families" })).toBeVisible();

    const row = (await findRowInTable(adminPage, FAMILY_NAME, { maxPages: 20 }))!;

    await row.getByRole("button", { name: "Edit" }).click();
    await expect(adminPage.getByLabel("Cash only")).toBeVisible({ timeout: 10_000 });
    await adminPage.getByLabel("Cash only").check();
    await adminPage.getByRole("button", { name: "Update" }).click();

    // The family is admin-locked (fully approved) — the edit-confirm dialog appears
    await adminPage.getByRole("button", { name: "Yes, update" }).click();
    await expect(adminPage.getByText("Family updated")).toBeVisible({ timeout: 10_000 });

    // The row's cash-only cell shows a checkmark with a "Cash only" tooltip
    const updatedRow = adminPage.getByRole("row").filter({ hasText: FAMILY_NAME });
    await expect(updatedRow.getByTitle("Cash only")).toBeVisible();

    /* ── Public (logged out): the wish-list marker ── */
    const publicContext = await browser.newContext();
    const publicPage = await publicContext.newPage();

    await publicPage.goto(`/families/${testData.familyId}/wish-list`);
    await expect(publicPage.getByText("(already shopping)")).toBeVisible({ timeout: 10_000 });

    await publicContext.close();

    /* ── Donor: the claim modal offers cash only ── */
    const donorContext = await browser.newContext();
    const donorPage = await donorContext.newPage();

    await donorPage.goto("/login");
    await donorPage.getByLabel("Email").fill(testData.donorEmail);
    await donorPage.getByLabel("Password").fill(testData.donorPassword);
    await donorPage.getByRole("button", { name: "Sign in" }).click();
    await donorPage.waitForURL(/\/dashboard/);

    await donorPage.goto(`/families/${testData.familyId}/wish-list`);
    await donorPage.getByRole("button", { name: "Sponsor this family" }).click();

    const modal = donorPage.getByRole("dialog");
    await expect(modal.getByText("This family is already being shopped for — cash sponsorships only.")).toBeVisible();
    // Gifts option is hidden; cash is the only option
    await expect(modal.getByText("I'll purchase the items on their wish list")).not.toBeVisible();
    await expect(modal.getByText("I'll provide monetary support")).toBeVisible();
    // Cash goes through the cart flow, not the gift claim
    await expect(modal.getByRole("button", { name: "Add to cart" })).toBeVisible();

    await donorContext.close();
    await adminContext.close();
  });
});
