/**
 * Help page screenshots — capture script (NOT part of the normal e2e suite).
 *
 * Run from e2e/ with the dev stack up (standard .env values; the Zeffy mock
 * must be wired for the donor cart capture):
 *   npx playwright test --config=playwright.screenshots.config.ts
 *
 * Captures every screen the per-role help guides reference into
 * frontend/src/assets/help/ (committed; the Vite import hashes them), plus
 * the README's public-wish-list.png (the README's dashboard shot reuses
 * admin-dashboard.png as-is). All at the standard 1440x1000 frame, so the
 * two README shots render at identical sizes in its table. Re-runs
 * overwrite the same files, so the script is idempotent.
 *
 * Data: the demo-CSV seed (via the standard globalSetup) provides the rich
 * families/people/wishes; this script adds a little scenario state so the
 * otherwise-empty pages look real:
 *   - a queue family (family-lock, review requested, then referrer-approved)
 *     for the referrer wish-review + admin wish-approval pages
 *   - a pending-verification family (invite registration) for the referrer's
 *     "Families to Verify" section
 *   - three referrer invite codes for the admin invite-codes page: one
 *     email-locked and redeemed (via self-registration), one email-locked,
 *     one unlocked
 *   - purchaser + delivery + admin assignments (wishes / families)
 *   - two display-mode deadlines for the admin deadlines page
 *   - a donor gift claim + a donor pending cash claim (cart)
 *   - one unmatched payment in the Zeffy mock for the admin Zeffy-payments
 *     page — the capture clicks "Sync with Zeffy" to pull it into the local
 *     mirror (the mirror is append-only, and the hourly sync has been
 *     collecting other runs' mock payments, so the table is filtered to this
 *     run's row, like the sponsorships shot)
 *   - one demo email campaign (partially delivered, then canceled) for the
 *     admin email-campaigns page
 * Everything the script creates is cleaned up in afterAll (the golden rule)
 * — except the demo campaign: campaigns are append-only (no delete
 * endpoint), so it is left canceled and the capture filters to this run's
 * row.
 * Two seeded rows are touched reversibly: the seeded purchaser/delivery/admin
 * assignments are reset to unassigned before the script's own assignments go
 * in (restoring "no assignment" afterwards), and the referrer review queue is
 * left exactly as found (the queue family is deleted, its wish state reset
 * first). Run with the normal suite idle so concurrent tests don't pollute
 * shared lists (e.g. the admin sponsorships page; the Zeffy mirror collects
 * whatever the mock holds when its capture syncs).
 *
 * Clean captures: run on a freshly-wiped stack (`./run-compose.sh clear`, then
 * your normal `up`) — the email log and sponsorships lists accumulate
 * dev/e2e history, and the pages' "Showing X of N" footers still count it.
 * The scenario accounts use fixed emails, so a re-run without a wipe fails
 * loudly (409) rather than silently duplicating: wipe and re-run.
 *
 * Determinism: fresh browser contexts (no localStorage, so default tiles and
 * column order), fixed 1440x1000 viewport, locale en-US,
 * timezone
 * America/Los_Angeles, deadline banners hidden before every capture. A
 * preflight guarantees every character the UI renders has a glyph (Linux
 * auto-installs Noto Color Emoji + Noto Sans Symbols 2 user-locally if not —
 * the emoji icons and the copy-sign render as tofu boxes without them).
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, request as playwrightRequest, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import {
  assignFamiliesToDeliveryViaApi,
  batchAssignWishesViaApi,
  createFamilyUserViaApi,
  createFamilyViaApi,
  createPersonViaApi,
  deleteClaimViaApi,
  deleteDeadlineViaApi,
  deleteFamilyViaApi,
  deletePersonViaApi,
  deleteReferrerViaApi,
  deleteUserViaApi,
  listFamiliesViaApi,
  listReferrersViaApi,
  listUsersViaApi,
  listWishesViaApi,
  loginViaApi,
  registerFamilyViaInvite,
  resetFamilyWishState,
} from "../helpers/api";
import { getAdminEmail, getBaseUrl } from "../helpers/env";
import { mockReset, mockSeedPayments, zeffyMockGate } from "../helpers/zeffy-mock";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_DIR = path.resolve(__dirname, "../../frontend/src/assets/help");

const PASSWORD = "Password123!";
/** The demo-CSV donor account (seeded, no storageState file). */
const DONOR_EMAIL = "olivia.reynolds@example.com";
const REFERRER_EMAIL = "sarah.chen@example.com";
/** Demo campaign for the admin email-campaigns capture (fixed subject so the
 * shot is recognizable; manual-only so its recipient set is exact). */
const DEMO_CAMPAIGN_SUBJECT = "Thank you for your support";

/** Data created by the setup phase, used for cleanup in afterAll. */
const d: {
  adminApi: APIRequestContext | null;
  queueFamilyId?: number;
  queuePersonId?: number;
  queueUserId?: number;
  queueFamilyEmail: string;
  pendingFamilyId?: number;
  pendingUserId?: number;
  purchaserUserId?: number;
  deliveryUserId?: number;
  adminUserId?: number;
  purchaserWishIds: number[];
  adminWishId?: number;
  deliveryFamilyIds: number[];
  deadlineIds: number[];
  donorGiftClaimId?: number;
  donorCashClaimId?: number;
  donorCashClaimFamilyId?: number;
  inviteTokenIds: number[];
  inviteCodes: string[];
  inviteRedeemedTokenId?: number;
  inviteReferrerId?: number;
  demoCampaignId?: number;
  zeffyGate: string | null;
} = {
  adminApi: null,
  queueFamilyEmail: "queue.contact@example.com",
  purchaserWishIds: [],
  deliveryFamilyIds: [],
  deadlineIds: [],
  inviteTokenIds: [],
  inviteCodes: [],
  zeffyGate: null,
};

test.describe.serial("help page screenshots", () => {
  test("setup: create screenshot scenario data", async () => {
    ensureFontCoverage();
    const api = await playwrightRequest.newContext({ baseURL: getBaseUrl() });
    await loginViaApi(api);
    d.adminApi = api;

    /* ── Queue family: enters the referrer review queue (and the admin
         approval queue once the referrer approves, in the admin phase) ── */
    const referrers = await listReferrersViaApi(api);
    const sarah = referrers.referrers.find((r) => r.name === "Sarah Chen");
    expect(sarah, "CSV-seeded referrer 'Sarah Chen' not found").toBeTruthy();
    const family = await createFamilyViaApi(api, sarah!.id, {
      familyName: "The Morgan Family",
      familyWish: "A warm fleece blanket",
      contactName: "Queue Contact",
      phoneNumber: "555-222-3333",
      address: "1 Screenshot Lane",
    });
    d.queueFamilyId = family.familyId;
    const person = await createPersonViaApi(api, family.familyId, {
      givenName: "Jordan",
      role: "son",
      age: 9,
      wish: "A soccer ball",
      funWish: "A puzzle set",
    });
    d.queuePersonId = person.personId;
    const famUser = await createFamilyUserViaApi(api, {
      email: d.queueFamilyEmail,
      password: PASSWORD,
      familyId: family.familyId,
      displayName: "Queue Contact",
    });
    d.queueUserId = famUser.userId;
    const famApi = await playwrightRequest.newContext({ baseURL: getBaseUrl() });
    await famApi.post("/api/auth/login", { data: { email: d.queueFamilyEmail, password: PASSWORD } });
    const req = await famApi.post("/api/family/me/request-review", { data: {} });
    expect(req.ok(), `request-review failed (${req.status()}): ${await req.text()}`).toBeTruthy();
    await famApi.dispose();

    /* ── Assignments: reset any stale script-owned state, then assign ── */
    const purchasers = await listUsersViaApi(api, "purchaser", "purchaser.e2e");
    expect(purchasers.users.length, "seeded purchaser user not found").toBeGreaterThan(0);
    d.purchaserUserId = purchasers.users[0].id;
    const deliveries = await listUsersViaApi(api, "delivery", "mike.torres");
    expect(deliveries.users.length, "seeded delivery user not found").toBeGreaterThan(0);
    d.deliveryUserId = deliveries.users[0].id;
    const admins = await listUsersViaApi(api, "admin", getAdminEmail());
    expect(admins.users.length, "bootstrap admin user not found").toBeGreaterThan(0);
    d.adminUserId = admins.users[0].id;

    const families = await listFamiliesViaApi(api);
    const byName = (name: string) => {
      const f = families.families.find((x) => x.family_name === name);
      expect(f, `CSV-seeded family '${name}' not found`).toBeTruthy();
      return f!;
    };
    const martinez = byName("The Martinez Family");
    const thompson = byName("The Thompson Family");
    const washington = byName("The Washington Family");
    const williams = byName("The Williams Family");

    /* Reset stale assignments from a crashed previous run (only rows this
       script could have created in the past) */
    const stalePurchaser = await listWishesViaApi(api, { assignedToId: d.purchaserUserId });
    if (stalePurchaser.wishes.length > 0) await batchAssignWishesViaApi(api, stalePurchaser.wishes.map((w) => w.id), 0);
    const staleAdmin = await listWishesViaApi(api, { assignedToId: d.adminUserId });
    if (staleAdmin.wishes.length > 0) await batchAssignWishesViaApi(api, staleAdmin.wishes.map((w) => w.id), 0);
    for (const f of families.families) {
      if (f.delivery_user_id === d.deliveryUserId) {
        await api.patch(`/api/admin/families/${f.id}`, { data: { delivery_user_id: 0 } });
      }
    }

    const martinezWishes = await listWishesViaApi(api, { familyId: martinez.id });
    expect(martinezWishes.wishes.length, "Martinez family has no wishes in the demo seed").toBeGreaterThanOrEqual(2);
    d.purchaserWishIds = martinezWishes.wishes.slice(0, 2).map((w) => w.id);
    await batchAssignWishesViaApi(api, d.purchaserWishIds, d.purchaserUserId);

    const washingtonWishes = await listWishesViaApi(api, { familyId: washington.id });
    expect(washingtonWishes.wishes.length, "Washington family has no wishes in the demo seed").toBeGreaterThan(0);
    d.adminWishId = washingtonWishes.wishes[0].id;
    await batchAssignWishesViaApi(api, [d.adminWishId], d.adminUserId);

    d.deliveryFamilyIds = [williams.id, thompson.id];
    await assignFamiliesToDeliveryViaApi(api, d.deliveryFamilyIds, d.deliveryUserId);

    /* ── Deadlines: two display-mode rows (banners only, never armed) ── */
    const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    d.deadlineIds.push(await createDeadlineFor("family_info", `Family info deadline`, in30Days));
    d.deadlineIds.push(await createDeadlineFor("gift_dropoff", `Gift dropoff deadline`, in30Days));

    /* ── Donor: gift claim (Martinez) + pending cash claim (Thompson cart) ── */
    const donorApi = await playwrightRequest.newContext({ baseURL: getBaseUrl() });
    await donorApi.post("/api/auth/login", { data: { email: DONOR_EMAIL, password: PASSWORD } });
    /* Release any of the seeded donor's stale unpaid claims (the script owns
       her cart state for the captures; the suite never uses this account) */
    const stale = await donorApi.get("/api/donor/claims");
    expect(stale.ok()).toBeTruthy();
    for (const claim of (await stale.json()) as Array<{ id: number }>) {
      await deleteClaimViaApi(donorApi, claim.id);
    }
    const claim = await donorApi.post(`/api/families/${martinez.id}/claim`, { data: { commitment_type: "gifts" } });
    expect(claim.status(), `gift claim failed (${claim.status()}): ${await claim.text()}`).toBe(201);
    d.donorGiftClaimId = ((await claim.json()) as { id: number }).id;

    d.zeffyGate = await zeffyMockGate();
    if (d.zeffyGate === null) {
      /* One unmatched payment for the admin Zeffy page (tag-scoped; reset in
         afterAll so the mock stays as found) */
      /* Stable id: the local mirror is append-only (no delete), so re-runs
         must upsert the same row instead of accumulating one per run */
      await mockSeedPayments("help-screenshots", [
        { id: "00000000-1111-4222-8333-0000000000f1", email: "help-zeffy@example.com", name: "Help Donor", amountUsd: 500 },
      ]);
      const checkout = await donorApi.post("/api/donor/cart/checkout", {
        data: { items: [{ family_id: thompson.id, includes_groceries: false }] },
      });
      expect(checkout.ok(), `cart checkout failed (${checkout.status()}): ${await checkout.text()}`).toBeTruthy();
      const cart = await donorApi.get("/api/donor/cart");
      expect(cart.ok()).toBeTruthy();
      const items = ((await cart.json()) as { items: Array<{ claim_id: number }> }).items;
      expect(items.length, "cart has no pending cash claim after checkout").toBeGreaterThan(0);
      d.donorCashClaimId = items[items.length - 1].claim_id;
      d.donorCashClaimFamilyId = thompson.id;
    } else {
      console.log(`[help-screenshots] Skipping the donor cart capture: ${d.zeffyGate}`);
    }
    await donorApi.dispose();

    /* ── Referrer "Families to Verify": one pending family via invite ── */
    const sarahApi = await playwrightRequest.newContext({ baseURL: getBaseUrl() });
    await sarahApi.post("/api/auth/login", { data: { email: REFERRER_EMAIL, password: PASSWORD } });
    const me = await sarahApi.get("/api/referrer/me");
    expect(me.ok(), "referrer /me failed").toBeTruthy();
    const inviteCode = ((await me.json()) as { family_invite_code: string }).family_invite_code;
    const pending = await registerFamilyViaInvite(sarahApi, {
      code: inviteCode,
      familyName: "The Holt Family",
      familyWish: "A set of towels",
      contactName: "Pending Contact",
      email: "pending.family@example.com",
      password: PASSWORD,
      address: "2 Screenshot Lane",
      phoneNumber: "555-444-5555",
    });
    d.pendingFamilyId = pending.familyId;
    d.pendingUserId = pending.userId;
    /* The invite flow derives the display name from the email local-part; give
       the family user a clean name (it shows as the SENDER in the email log) */
    const rename = await api.patch(`/api/admin/users/${pending.userId}`, { data: { display_name: "Pending Contact" } });
    expect(rename.ok(), `pending display-name patch failed (${rename.status()})`).toBeTruthy();
    await sarahApi.dispose();

    /* ── Invite codes: three rows covering the page's states — a redeemed
         email-locked code (shows redemption + auto-approval), an unredeemed
         email-locked code, and an unlocked code (Extend/Revoke actions) ── */
    const grantInvite = await createInviteCodeFor({ familyLimit: 3, email: "alexis.grant@example.com" });
    const nguyenInvite = await createInviteCodeFor({ familyLimit: 5, email: "tara.nguyen@example.com" });
    const openInvite = await createInviteCodeFor({ familyLimit: 10 });
    d.inviteTokenIds.push(grantInvite.id, nguyenInvite.id, openInvite.id);
    d.inviteCodes.push(grantInvite.code, nguyenInvite.code, openInvite.code);
    d.inviteRedeemedTokenId = grantInvite.id;
    /* Dedicated context: /register-referrer is a self-registration endpoint that
       sets session cookies in its response — hitting it with the admin context
       would overwrite the admin's token with the new referrer's */
    const grantCtx = await playwrightRequest.newContext({ baseURL: getBaseUrl() });
    const grantReg = await grantCtx.post("/api/auth/register-referrer", {
      data: {
        code: grantInvite.code,
        name: "Alexis Grant",
        email: "alexis.grant@example.com",
        phone_number: "555-333-4444",
        password: PASSWORD,
      },
    });
    expect(grantReg.ok(), `redeemed-invite registration failed (${grantReg.status()})`).toBeTruthy();
    d.inviteReferrerId = ((await grantReg.json()) as { referrer: { id: number } }).referrer.id;
    await grantCtx.dispose();

    /* ── Email campaigns: one demo campaign, partially delivered then
         canceled — the shot shows the progress bar and a Canceled row with
         mixed recipient outcomes. Deterministic: the cancel flips every
         still-pending recipient the instant the first delivery lands ── */
    const campaignsResp = await api.get("/api/admin/email-campaigns");
    const { campaigns } = (await campaignsResp.json()) as { campaigns: Array<{ id: number; subject: string; status: string }> };
    for (const c of campaigns) {
      if (c.subject === DEMO_CAMPAIGN_SUBJECT && (c.status === "pending" || c.status === "sending")) {
        await api.post(`/api/admin/email-campaigns/${c.id}/cancel`);
      }
    }
    const demoCampaign = await api.post("/api/admin/email-campaigns", {
      data: {
        subject: DEMO_CAMPAIGN_SUBJECT,
        message: "A short note from the organizers, captured for the admin help guide.",
        extra_emails: ["campaign.demo-1@example.com", "campaign.demo-2@example.com", "campaign.demo-3@example.com"],
      },
    });
    expect(demoCampaign.status(), `demo campaign create failed (${demoCampaign.status()})`).toBe(201);
    d.demoCampaignId = ((await demoCampaign.json()) as { id: number }).id;
    /* Wait for the first paced delivery (the worker sends one recipient per
       cycle; the first goes out within one idle poll), then cancel inside
       the pacing gap so the remaining recipients are deterministically
       skipped. */
    let demoSent = 0;
    for (let i = 0; i < 30; i++) {
      const detail = await api.get(`/api/admin/email-campaigns/${d.demoCampaignId}`);
      demoSent = ((await detail.json()) as { campaign: { sent_count: number } }).campaign.sent_count;
      if (demoSent > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    expect(demoSent, "demo campaign's first delivery never landed (worker not running?)").toBeGreaterThan(0);
    const demoCancel = await api.post(`/api/admin/email-campaigns/${d.demoCampaignId}/cancel`);
    expect(demoCancel.ok(), `demo campaign cancel failed (${demoCancel.status()})`).toBeTruthy();

    console.log("[help-screenshots] Scenario data ready.");
  });

  test("referrer: capture dashboard, invites, families, detail, wish review", async ({ browser }) => {
    const context = await newRoleContext(browser, "referrer");
    const page = await context.newPage();

    await capture(page, "referrer-dashboard", "/dashboard", { heading: "Welcome back!" });
    await capture(page, "referrer-family-invites", "/referrer/family-invites", {
      heading: "Family Invites",
      /* The sent-invites history is stack-local email log noise (and long); the
         guide documents it in prose, so hide the heading + its table */
      onSettled: async (p) => {
        await p.locator("h3", { hasText: "Sent Invites" }).first().evaluate((el) => {
          el.style.display = "none";
          if (el.nextElementSibling) (el.nextElementSibling as HTMLElement).style.display = "none";
        });
      },
    });
    await capture(page, "referrer-families", "/referrer/families", { heading: "My Families" });

    const williams = await familyIdByName("The Williams Family");
    await capture(page, "referrer-family-detail", `/referrer/families/${williams}`, { heading: "Family Detail" });

    await capture(page, "referrer-wish-review", "/referrer/wish-review", { heading: "Wish Review Queue" });
    await context.close();
  });

  test("admin: referrer approves the queue family", async () => {
    expect(d.queueFamilyId, "queue family missing").toBeTruthy();
    const api = await playwrightRequest.newContext({ baseURL: getBaseUrl() });
    await api.post("/api/auth/login", { data: { email: REFERRER_EMAIL, password: PASSWORD } });
    const resp = await api.post(`/api/referrer/families/${d.queueFamilyId}/approve-wishes`, { data: {} });
    expect(resp.ok(), `referrer approve failed (${resp.status()}): ${await resp.text()}`).toBeTruthy();
    await api.dispose();
  });

  test("admin: capture dashboard and all admin pages", async ({ browser }) => {
    const context = await newRoleContext(browser, "admin");
    const page = await context.newPage();

    const shots: Array<[string, string, { heading?: string | RegExp; selector?: string; prep?: (page: Page) => Promise<void>; onSettled?: (page: Page) => Promise<void> }]> = [
      ["admin-dashboard", "/dashboard", { heading: "Welcome back!" }],
      ["admin-wish-review", "/admin/wish-review", { heading: "Wish Approval Queue" }],
      ["admin-users", "/admin/users", { heading: "Manage Users" }],
      ["admin-referrers", "/admin/referrers", { heading: "Manage Referrers" }],
      ["admin-invite-codes", "/admin/invite-codes", { heading: "Invite Codes",
        /* Nine columns don't fit the default 960px table width — the page
           scrolls horizontally and the Status + action columns would be
           clipped out of the frame; widen it the way the gear menu does */
        prep: async (p) => {
          await p.evaluate(() => window.localStorage.setItem("kim:tableWidth:adminInvites", "full"));
          await p.reload({ waitUntil: "load" });
        },
        onSettled: async (p) => {
        /* Keep only this run's codes: a re-run without a wipe leaves last
           run's rows (the redeemed one is permanent — it cannot be revoked) */
        await p.locator("table tbody tr").evaluateAll(
          (rows, codes) => {
            for (const row of rows) {
              if (!codes.some((code) => (row.textContent ?? "").includes(code))) row.style.display = "none";
            }
          },
          d.inviteCodes,
        );
      } }],
      ["admin-families", "/admin/families", { heading: "Manage Families" }],
      ["admin-people", "/admin/people", { heading: "Manage People" }],
      ["admin-csv-upload", "/admin/csv-upload", { heading: "CSV Import" }],
      ["admin-deadlines", "/admin/deadlines", { heading: "Event Deadlines" }],
      ["admin-wishes", "/admin/wishes", { heading: "Manage Wishes", prep: async (p) => {
        /* Same clipping as the invite-codes page — widen via the gear menu's
           width preference */
        await p.evaluate(() => window.localStorage.setItem("kim:tableWidth:adminWishes", "full"));
        await p.reload({ waitUntil: "load" });
      } }],
      ["admin-assigned-gifts", "/admin/assigned-gifts", { heading: "My Assigned Gifts", prep: async (p) => {
        /* Same clipping as the invite-codes page — widen via the gear menu's
           width preference */
        await p.evaluate(() => window.localStorage.setItem("kim:tableWidth:adminAssignedGifts", "full"));
        await p.reload({ waitUntil: "load" });
      } }],
      ["admin-packing-slips", "/admin/packing-slips", { selector: ".packing-slip-card" }],
      ["admin-delivery-slips", "/admin/delivery-slips", { selector: ".delivery-slip-card" }],
      ["admin-wish-cards", "/admin/wish-cards", { heading: "Blank Wish Cards" }],
      ["admin-emails", "/admin/emails", { heading: "Emails" }],
      ["admin-email-campaigns", "/admin/emails?tab=campaigns", { heading: "Emails", onSettled: async (p) => {
        /* Keep only this run's demo campaign: campaigns are append-only
           (no delete endpoint), so a crashed earlier run's canceled row
           would otherwise share the frame */
        await p.locator("table tbody tr").evaluateAll(
          (rows, subject) => {
            for (const row of rows) {
              if (!(row.textContent ?? "").includes(subject)) row.style.display = "none";
            }
          },
          DEMO_CAMPAIGN_SUBJECT,
        );
      } }],
      ["admin-email-unsubscribes", "/admin/emails?tab=unsubscribes", { heading: "Emails" }],
      ["admin-zeffy-payments", "/admin/zeffy-payments", { heading: "Zeffy Payments", onSettled: async (p) => {
        /* The page reads the local mirror (append-only) — the hourly sync
           has been filling it with every e2e run's mock payments. Pull this
           run's seeded payment in now and keep only its row, the way the
           sponsorships shot filters to its own scenario rows */
        if (d.zeffyGate === null) {
          await p.getByRole("button", { name: "Sync with Zeffy" }).click();
          /* Wait for the toast first (it renders before the list refetch
             lands the row) so a mirror that was already up to date still
             gets a clean frame */
          await p.getByRole("alert").filter({ hasText: /new payment|Up to date/ }).first().waitFor({ state: "visible", timeout: 10_000 });
          await p.locator("tr", { hasText: "help-zeffy@example.com" }).first().waitFor({ state: "visible", timeout: 15_000 });
          /* Let the sync toast auto-dismiss so it doesn't share the frame */
          await expect(p.locator('[role="alert"]')).toHaveCount(0, { timeout: 10_000 });
        }
        await p.locator("table tbody tr").evaluateAll((rows) => {
          for (const row of rows) {
            if (!(row.textContent ?? "").includes("help-zeffy@example.com")) row.style.display = "none";
          }
        });
      } }],
      ["admin-sponsorships", "/admin/sponsorships", { heading: "Sponsorships", onSettled: async (p) => {
        /* Keep only this run's active sponsorships (the seeded donor's);
           the page also lists cancelled history from earlier runs */
        await p.locator("table tbody tr").evaluateAll(
          (rows, donorEmail) => {
            for (const row of rows) {
              const text = row.textContent ?? "";
              const keep = text.includes(donorEmail) && !text.includes("Cancelled");
              if (!keep) row.style.display = "none";
            }
          },
          DONOR_EMAIL,
        );
      } }],
    ];
    for (const [slug, url, wait] of shots) {
      await capture(page, slug, url, wait);
    }

    await context.close();
  });

  test("family: capture dashboard and people", async ({ browser }) => {
    const context = await newRoleContext(browser, "family");
    const page = await context.newPage();

    await capture(page, "family-dashboard", "/family/dashboard", { heading: "Family Dashboard" });
    await capture(page, "family-people", "/family/people", { heading: "Manage People" });
    await context.close();
  });

  test("purchaser: capture assigned gifts", async ({ browser }) => {
    const context = await newRoleContext(browser, "purchaser");
    const page = await context.newPage();

    await capture(page, "purchaser-gifts", "/purchaser/assigned-gifts", { heading: "Assigned Gifts" });
    await context.close();
  });

  test("delivery: capture dashboard, packing slips, delivery slips", async ({ browser }) => {
    const context = await newRoleContext(browser, "delivery");
    const page = await context.newPage();

    await capture(page, "delivery-dashboard", "/delivery", { heading: /Welcome, / });
    await capture(page, "delivery-packing-slips", "/delivery/packing-slips", { selector: ".packing-slip-card" });
    await capture(page, "delivery-slips", "/delivery/delivery-slips", { selector: ".delivery-slip-card" });
    await context.close();
  });

  test("donor: capture browse, claims, claim detail, cart, public wish list, registration", async ({ browser }) => {
    /* No donor storageState file exists (the suite creates donors per-test) —
       log in as the seeded donor via the UI, then reuse the context. */
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/login");
    await page.getByLabel("Email").fill(DONOR_EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/dashboard/);

    await capture(page, "donor-browse", "/families", { heading: "Families Needing Gifts" });
    await capture(page, "donor-claims", "/donor/claims", { heading: "My Sponsorships" });

    if (d.donorGiftClaimId != null) {
      await capture(page, "donor-claim-detail", `/donor/claims/${d.donorGiftClaimId}`, { heading: "Sponsorship Details" });
    } else {
      console.log("[help-screenshots] No gift claim; skipping donor-claim-detail.");
    }
    if (d.donorCashClaimId != null) {
      await capture(page, "donor-cart", "/donor/cart", { heading: "Sponsorship Cart" });
    } else {
      console.log("[help-screenshots] No pending cash claim; skipping donor-cart.");
    }

    const guest = await browser.newContext();
    const gpage = await guest.newPage();
    await capture(gpage, "donor-register", "/register-donor", { heading: "Donor Registration" });

    /* README product shot: a fully-approved demo family's public wish list
       in its unsponsored state (Garcia is never claimed by this script's
       scenario), at the standard 1440x1000 help framing — the same
       dimensions as admin-dashboard.png, which the README reuses, so the
       two render at identical sizes in its table. The page's sticky footer
       (mt-auto inside its min-h-screen flex column) ends a short page
       exactly at the frame's bottom edge, so the image naturally ends on
       the footer; the assert enforces that frame contract and fails
       loudly if the page ever outgrows the frame */
    const wlPage = await guest.newPage();
    const garcia = await familyIdByName("The Garcia Family");
    await capture(wlPage, "public-wish-list", `/families/${garcia}/wish-list`, {
      heading: "Family Members",
      assert: async (p) => {
        const [footerTop, footerBottom] = await p.evaluate(() => {
          const r = document.querySelector("footer")!.getBoundingClientRect();
          return [Math.round(r.top), Math.round(r.bottom)];
        });
        expect(footerTop, "footer must be visible inside the 1440x1000 frame").toBeLessThan(995);
        expect(footerBottom, "no page background may sit below the footer in the frame").toBeGreaterThanOrEqual(995);
        expect(footerBottom, "no page background may sit below the footer in the frame").toBeLessThanOrEqual(1000);
      },
    });
    await guest.close();

    await context.close();
  });

  test.afterAll(async () => {
    const api = d.adminApi ?? ((await loginViaApi(await playwrightRequest.newContext({ baseURL: getBaseUrl() }))) as APIRequestContext);
    try {
      /* Donor claims */
      if (d.donorGiftClaimId != null || d.donorCashClaimId != null) {
        const donorApi = await playwrightRequest.newContext({ baseURL: getBaseUrl() });
        await donorApi.post("/api/auth/login", { data: { email: DONOR_EMAIL, password: PASSWORD } });
        if (d.donorCashClaimId != null) await deleteClaimViaApi(donorApi, d.donorCashClaimId);
        if (d.donorGiftClaimId != null) await deleteClaimViaApi(donorApi, d.donorGiftClaimId);
        await donorApi.dispose();
      }
      /* Pending-verification family */
      if (d.pendingFamilyId != null) await deleteFamilyViaApi(api, d.pendingFamilyId);
      if (d.pendingUserId != null) await deleteUserViaApi(api, d.pendingUserId);
      /* Invite codes: the redeemed row is permanent (a redeemed code can
         never be re-armed); revoke the rest so no live code lingers, and
         delete the redeemed referrer (cascades to its user account) */
      for (const id of d.inviteTokenIds) {
        if (id === d.inviteRedeemedTokenId) continue;
        const revoke = await api.post(`/api/admin/invites/${id}/revoke`);
        if (!revoke.ok()) console.warn(`[help-screenshots] invite revoke (${id}) returned ${revoke.status()}`);
      }
      if (d.inviteReferrerId != null) await deleteReferrerViaApi(api, d.inviteReferrerId);
      /* Queue family */
      if (d.queueFamilyId != null) {
        await resetFamilyWishState(api, d.queueFamilyId);
        await deleteFamilyViaApi(api, d.queueFamilyId);
      }
      if (d.queuePersonId != null) await deletePersonViaApi(api, d.queuePersonId);
      if (d.queueUserId != null) await deleteUserViaApi(api, d.queueUserId);
      /* Assignments back to unassigned */
      if (d.purchaserWishIds.length > 0) await batchAssignWishesViaApi(api, d.purchaserWishIds, 0);
      if (d.adminWishId != null) await batchAssignWishesViaApi(api, [d.adminWishId], 0);
      for (const familyId of d.deliveryFamilyIds) {
        await api.patch(`/api/admin/families/${familyId}`, { data: { delivery_user_id: 0 } });
      }
      /* Deadlines (hard delete) */
      for (const id of d.deadlineIds) await deleteDeadlineViaApi(api, id);
      /* Demo campaign — append-only (no delete endpoint); cancel is
         idempotent, a no-op once the setup already canceled it */
      if (d.demoCampaignId != null) {
        const cancel = await api.post(`/api/admin/email-campaigns/${d.demoCampaignId}/cancel`);
        if (!cancel.ok()) console.warn(`[help-screenshots] demo campaign cancel returned ${cancel.status()}`);
      }
      /* Seeded mock payment (tag-scoped reset) */
      if (d.zeffyGate === null) await mockReset("help-screenshots");
      console.log("[help-screenshots] Cleanup complete.");
    } catch (err) {
      console.warn(`[help-screenshots] Cleanup incomplete: ${String(err).split("\n")[0]}`);
    } finally {
      await api.dispose();
    }
  });
});

/* ---------------------------------------------------------------------- */
/* Helpers                                                                 */
/* ---------------------------------------------------------------------- */

/**
 * Preflight: ensure the capture browser can render every non-Latin character
 * the app's UI uses. macOS and Windows ship emoji and symbol fonts; a bare
 * Linux container often has neither, and the app's emoji icons and the
 * copy-sign (U+1F5D0 — a text symbol, NOT an emoji: no emoji font covers it)
 * would render as tofu boxes in the captures. On Linux, install the missing
 * Noto fonts user-locally — no root, no system mutation beyond the user font
 * dir. Idempotent: a no-op when fontconfig already resolves every required
 * character to some installed font. Fails loudly with the manual one-liner
 * if the auto-install download fails.
 */
function ensureFontCoverage(): void {
  if (process.platform !== "linux") return;

  /* fontconfig is both the probe and the browser's fallback mechanism */
  try {
    execSync("fc-list --version", { stdio: "ignore" });
  } catch {
    throw new Error("fc-list not found — the capture preflight needs fontconfig (install fontconfig-tools).");
  }

  const userFontDir = path.join(os.homedir(), ".local", "share", "fonts");
  const installs = [
    {
      name: "NotoColorEmoji.ttf",
      label: "Noto Color Emoji",
      url: "https://raw.githubusercontent.com/google/fonts/main/ofl/notocoloremoji/NotoColorEmoji-Regular.ttf",
    },
    {
      name: "NotoSansSymbols2-Regular.ttf",
      label: "Noto Sans Symbols 2",
      url: "https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssymbols2/NotoSansSymbols2-Regular.ttf",
    },
  ];

  let missing = uncoveredCodePoints();
  for (const { name, label, url } of installs) {
    if (missing.size === 0) break;
    const dest = path.join(userFontDir, name);
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(userFontDir, { recursive: true });
      try {
        execSync(`curl -sSLf --max-time 300 -o "${dest}" ${url}`, { stdio: "pipe" });
      } catch {
        throw new Error(
          `Auto-install of ${label} failed. Install manually (no root needed):\n` +
            `  mkdir -p ~/.local/share/fonts && curl -sSL -o ~/.local/share/fonts/${name} ${url} && fc-cache -f`,
        );
      }
      console.log(`[help-screenshots] Missing glyphs — installed ${label} to ${dest}.`);
    }
    /* (Re)build the fontconfig cache, then re-probe what the font system resolves */
    try {
      execSync("fc-cache -f", { stdio: "pipe" });
    } catch {
      /* no fc-cache — the re-probe below still fails loudly if unresolved */
    }
    missing = uncoveredCodePoints();
  }
  if (missing.size > 0) {
    throw new Error(
      `No installed font covers ${[...missing]
        .sort((a, b) => a - b)
        .map((cp) => "U+" + cp.toString(16).toUpperCase())
        .join(", ")} — the captures would show tofu boxes. ` +
        "Add a font that covers them (and run fc-cache -f) and re-run.",
    );
  }
}

/**
 * The code points a capture can render that fontconfig cannot resolve to a
 * glyph — these would be tofu boxes. The required set is every character
 * >= U+2000 in a non-test frontend source file (the pages the captures
 * render), so a newly added icon is caught here instead of in a screenshot.
 * ZWJ and VS16 are format-only characters with no glyph of their own.
 */
function uncoveredCodePoints(): Set<number> {
  const srcDir = path.resolve(__dirname, "../../frontend/src");
  const required = new Set<number>();
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "test") walk(p); /* vitest-only, never rendered */
      } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.includes(".test.")) {
        for (const ch of fs.readFileSync(p, "utf8")) {
          const cp = ch.codePointAt(0);
          if (cp !== undefined && cp >= 0x2000 && cp !== 0x200d && cp !== 0xfe0f) required.add(cp);
        }
      }
    }
  };
  walk(srcDir);

  const missing = new Set<number>();
  for (const cp of required) {
    try {
      const out = execSync(`fc-list :charset=${cp.toString(16).toUpperCase()} file`, {
        stdio: ["ignore", "pipe", "ignore"],
      });
      if (out.length === 0) missing.add(cp);
    } catch {
      missing.add(cp);
    }
  }
  return missing;
}

/**
 * Create a referrer invite code the way the Referrers page's generator does,
 * then resolve its row id (the create response carries none) via the invite
 * list's code search.
 */
async function createInviteCodeFor(data: { familyLimit: number; email?: string }): Promise<{ id: number; code: string }> {
  const api = requireAdminApi();
  const create = await api.post("/api/auth/invite-referrer", {
    data: { family_limit: data.familyLimit, email: data.email ?? null, email_message: null },
  });
  if (!create.ok()) throw new Error(`createInviteCodeFor failed (${create.status()}): ${await create.text()}`);
  const created = (await create.json()) as { code: string };
  const list = await api.get("/api/admin/invites", { params: { search: created.code } });
  if (!list.ok()) throw new Error(`invite lookup failed (${list.status()}): ${await list.text()}`);
  const rows = ((await list.json()) as { invites: Array<{ id: number; code: string }> }).invites;
  const row = rows.find((r) => r.code === created.code);
  if (!row) throw new Error(`invite ${created.code} not found in the list after create`);
  return { id: row.id, code: created.code };
}

async function createDeadlineFor(type: string, label: string, dueDate: string): Promise<number> {
  const api = requireAdminApi();
  const resp = await api.post("/api/admin/deadlines", { data: { type, label, due_date: dueDate, mode: "display" } });
  if (!resp.ok()) throw new Error(`createDeadlineFor(${type}) failed (${resp.status()}): ${await resp.text()}`);
  return ((await resp.json()) as { id: number }).id;
}

function requireAdminApi(): APIRequestContext {
  expect(d.adminApi, "admin API context not set up yet").toBeTruthy();
  return d.adminApi!;
}

async function familyIdByName(name: string): Promise<number> {
  const { families } = await listFamiliesViaApi(requireAdminApi());
  const f = families.find((x) => x.family_name === name);
  expect(f, `family '${name}' not found`).toBeTruthy();
  return f!.id;
}

/** A logged-in context for one of the five storageState roles. */
async function newRoleContext(browser: Browser, role: "admin" | "referrer" | "family" | "purchaser" | "delivery"): Promise<BrowserContext> {
  return browser.newContext({ storageState: `storage/${role}.json` });
}

/**
 * Navigate to `url`, wait for the page to settle, hide volatile UI, and
 * write a viewport screenshot to frontend/src/assets/help/<slug>.png.
 * `wait.heading` (role=heading text) or `wait.selector` (CSS) anchors the
 * wait; omit both for pages where a landmark is not worth the coupling
 * (falls back to the page's main h2 or the table header).
 */
async function capture(
  page: Page,
  slug: string,
  url: string,
  wait?: {
    heading?: string | RegExp;
    selector?: string;
    prep?: (page: Page) => Promise<void>;
    onSettled?: (page: Page) => Promise<void>;
    assert?: (page: Page) => Promise<void>;
  },
): Promise<void> {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  await page.goto(url, { waitUntil: "load" });

  /* Page-specific setup that must land before the page settles (e.g. a
     localStorage table-width mode, which the page reads on mount) */
  if (wait?.prep) {
    await wait.prep(page);
  }

  /* Headless Chromium reserves a 15px classic-scrollbar gutter when the page
     overflows, which leaves a flat background-colored strip right of the
     full-bleed header/footer in the screenshot (real browsers use overlay
     scrollbars and don't reserve it). Hide it so the layout — and the shot
     — use the full frame width. Must come after prep: its reload() wipes
     the document and any earlier style injection with it. */
  await page.addStyleTag({
    content: "html{scrollbar-width:none !important}::-webkit-scrollbar{display:none !important}",
  });

  if (wait?.heading) {
    await page.getByRole("heading", { name: wait.heading }).first().waitFor({ state: "visible", timeout: 15_000 });
  } else if (wait?.selector) {
    await page.locator(wait.selector).first().waitFor({ state: "visible", timeout: 15_000 });
  } else {
    await page.locator("main h2, table thead").first().waitFor({ state: "visible", timeout: 15_000 });
  }
  /* Let React Query fetches and animations settle */
  await page.waitForTimeout(400);

  /* Hide the deadline banners (stack state, not part of the guides) */
  await page.locator('[data-testid="deadline-banner"]').evaluateAll((els) => els.forEach((el) => (el.style.display = "none")));

  /* Page-specific adjustments (e.g. hiding stack-local noise sections) */
  if (wait?.onSettled) {
    await wait.onSettled(page);
    await page.waitForTimeout(150);
  }

  /* Frame contract (fail loudly if the page outgrew the standard frame
     instead of shipping a mis-framed capture) */
  if (wait?.assert) {
    await wait.assert(page);
  }

  const out = path.join(OUTPUT_DIR, `${slug}.png`);
  await page.screenshot({ path: out });
  console.log(`[help-screenshots] ${slug}.png`);
}
