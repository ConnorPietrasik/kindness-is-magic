import type { APIRequestContext } from "@playwright/test";
import { request as playwrightRequest } from "@playwright/test";
import fs from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getAdminEmail, getAdminPassword } from "./env";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Read the demo CSV file that ships at the project root.
 */
export function readDemoCsv(): string {
  return fs.readFileSync(resolve(__dirname, "../../demo_import.csv"), "utf-8");
}

/**
 * Seed the database by calling the CSV import API directly.
 * This runs in globalSetup so data exists before any test, even with --grep.
 *
 * Returns the import summary.
 */
export async function seedDatabaseViaApi(request: APIRequestContext): Promise<void> {
  // 1. Login as admin to get auth cookies
  await request.post("/api/auth/login", {
    data: {
      email: getAdminEmail(),
      password: getAdminPassword(),
    },
  });

  // 2. Upload the demo CSV
  const csvContent = readDemoCsv();
  const response = await request.post("/api/admin/import-csv", {
    data: csvContent,
    headers: { "Content-Type": "text/csv" },
  });

  if (!response.ok()) {
    const body = await response.text();
    throw new Error(`CSV seed failed (${response.status()}): ${body}`);
  }

  const summary = (await response.json()) as { summary: Record<string, { created: number; skipped: number }> };
  console.log(
    `[globalSetup] CSV seed — referrers: +${summary.summary.referrers.created}/=${summary.summary.referrers.skipped}, ` +
      `families: +${summary.summary.families.created}/=${summary.summary.families.skipped}, ` +
      `people: +${summary.summary.people.created}/=${summary.summary.people.skipped}, ` +
      `users: +${summary.summary.users.created}/=${summary.summary.users.skipped}`,
  );
}

/**
 * Delete a person by ID (admin API).
 */
export async function deletePersonViaApi(
  request: APIRequestContext,
  personId: number,
): Promise<void> {
  const resp = await request.delete(`/api/admin/people/${personId}`);
  if (!resp.ok()) {
    console.warn(`[api] deletePersonViaApi(${personId}) returned ${resp.status()}`);
  }
}

/**
 * Delete a family by ID (admin API).
 */
export async function deleteFamilyViaApi(
  request: APIRequestContext,
  familyId: number,
): Promise<void> {
  const resp = await request.delete(`/api/admin/families/${familyId}`);
  if (!resp.ok()) {
    console.warn(`[api] deleteFamilyViaApi(${familyId}) returned ${resp.status()}`);
  }
}

/**
 * Delete a referrer by ID (admin API).
 */
export async function deleteReferrerViaApi(
  request: APIRequestContext,
  referrerId: number,
): Promise<void> {
  const resp = await request.delete(`/api/admin/referrers/${referrerId}`);
  if (!resp.ok()) {
    console.warn(`[api] deleteReferrerViaApi(${referrerId}) returned ${resp.status()}`);
  }
}

/**
 * Delete a user by ID (admin API).
 */
export async function deleteUserViaApi(
  request: APIRequestContext,
  userId: number,
): Promise<void> {
  const resp = await request.delete(`/api/admin/users/${userId}`);
  if (!resp.ok()) {
    console.warn(`[api] deleteUserViaApi(${userId}) returned ${resp.status()}`);
  }
}

/**
 * List families (admin API) — used to find CSV-seeded family IDs.
 */
export async function listFamiliesViaApi(
  request: APIRequestContext,
): Promise<{ families: Array<{ id: number; family_name: string; delivery_user_id: number | null }>; total: number }> {
  const resp = await request.get("/api/admin/families");
  if (!resp.ok()) {
    throw new Error(`listFamiliesViaApi failed: ${resp.status()}`);
  }
  return resp.json() as Promise<{ families: Array<{ id: number; family_name: string; delivery_user_id: number | null }>; total: number }>;
}

/**
 * Reset a family's wish state to initial (family lock, no review).
 * Used by tests that mutate wish state and need to clean up.
 */
export async function resetFamilyWishState(
  request: APIRequestContext,
  familyId: number,
): Promise<void> {
  const resp = await request.post(`/api/admin/families/${familyId}/reset-wish-state`, {
    data: {},
  });
  if (!resp.ok()) {
    const body = await resp.text();
    throw new Error(`resetFamilyWishState(${familyId}) failed (${resp.status()}): ${body}`);
  }
}

/**
 * Reset a referrer's sent family invite emails (admin API).
 *
 * Marks their "sent" invite rows as "reset": clears the lifetime invite cap
 * and the 7-day per-recipient dedup. The rows stay in the email log.
 */
export async function resetReferrerSentEmailsViaApi(
  request: APIRequestContext,
  referrerId: number,
): Promise<void> {
  const resp = await request.post(`/api/admin/referrers/${referrerId}/reset-sent-emails`);
  if (!resp.ok()) {
    const body = await resp.text();
    throw new Error(`resetReferrerSentEmailsViaApi(${referrerId}) failed (${resp.status()}): ${body}`);
  }
}

/**
 * List referrers (admin API).
 */
export async function listReferrersViaApi(
  request: APIRequestContext,
): Promise<{ referrers: Array<{ id: number; name: string }>; total: number }> {
  const resp = await request.get("/api/admin/referrers");
  if (!resp.ok()) {
    throw new Error(`listReferrersViaApi failed: ${resp.status()}`);
  }
  return resp.json() as Promise<{ referrers: Array<{ id: number; name: string }>; total: number }>;
}

/**
 * List users (admin API) with optional role filter.
 */
export async function listUsersViaApi(
  request: APIRequestContext,
  role?: string,
): Promise<{ users: Array<{ id: number; email: string; role: string }>; total: number }> {
  const params = new URLSearchParams();
  if (role) params.set("role", role);
  const resp = await request.get(`/api/admin/users?${params.toString()}`);
  if (!resp.ok()) {
    throw new Error(`listUsersViaApi failed: ${resp.status()}`);
  }
  return resp.json() as Promise<{ users: Array<{ id: number; email: string; role: string }>; total: number }>;
}

/**
 * List wishes (admin API) with optional filters.
 * Use assignedToId=0 for unassigned wishes (clear-FK sentinel).
 * Use purchased="false" for unpurchased wishes.
 * Use familyId to scope to a specific family (avoids race conditions in parallel tests).
 */
export async function listWishesViaApi(
  request: APIRequestContext,
  opts?: { assignedToId?: number; purchased?: string; familyId?: number },
): Promise<{ wishes: Array<{ id: number; assigned_to_id: number | null; purchased_at: string | null }>; total: number }> {
  const params = new URLSearchParams();
  if (opts?.assignedToId !== undefined) params.set("assigned_to_id", String(opts.assignedToId));
  if (opts?.purchased) params.set("purchased", opts.purchased);
  if (opts?.familyId !== undefined) params.set("family_id", String(opts.familyId));
  const resp = await request.get(`/api/admin/wishes?${params.toString()}`);
  if (!resp.ok()) {
    throw new Error(`listWishesViaApi failed: ${resp.status()}`);
  }
  return resp.json() as Promise<{ wishes: Array<{ id: number; assigned_to_id: number | null; purchased_at: string | null }>; total: number }>;
}

/**
 * Batch-assign wishes to a user (admin API).
 */
export async function batchAssignWishesViaApi(
  request: APIRequestContext,
  wishIds: number[],
  assignedToId: number,
): Promise<void> {
  const resp = await request.post("/api/admin/wishes/batch-assign", {
    data: { wish_ids: wishIds, assigned_to_id: assignedToId },
  });
  if (!resp.ok()) {
    const body = await resp.text();
    throw new Error(`batchAssignWishesViaApi failed (${resp.status()}): ${body}`);
  }
}

/**
 * Assign families to a delivery person (admin API — PATCH each family).
 */
export async function assignFamiliesToDeliveryViaApi(
  request: APIRequestContext,
  familyIds: number[],
  deliveryUserId: number,
): Promise<void> {
  for (const familyId of familyIds) {
    const resp = await request.patch(`/api/admin/families/${familyId}`, {
      data: { delivery_user_id: deliveryUserId },
    });
    if (!resp.ok()) {
      const body = await resp.text();
      throw new Error(`assignFamiliesToDeliveryViaApi(${familyId}) failed (${resp.status()}): ${body}`);
    }
  }
}

// ─── New helpers for self-contained scenarios ────────────────────────────────

/**
 * Create a referrer profile + user via API. The referrer is auto-approved
 * (admin-created referrers skip the invite flow).
 *
 * Returns { referrerId, userId, email, password }.
 */
export async function createReferrerWithUser(
  request: APIRequestContext,
  data: { name: string; familyLimit: number; phoneNumber: string; email: string; password: string; displayName?: string },
): Promise<{ referrerId: number; userId: number; email: string; password: string }> {
  // Create the referrer profile
  const referrerResp = await request.post("/api/admin/referrers", {
    data: {
      name: data.name,
      family_limit: data.familyLimit,
      phone_number: data.phoneNumber,
    },
  });
  if (!referrerResp.ok()) {
    const body = await referrerResp.text();
    throw new Error(`createReferrerWithUser: referrer creation failed (${referrerResp.status()}): ${body}`);
  }
  const referrerData = (await referrerResp.json()) as { id: number };
  const referrerId = referrerData.id;

  // Create the user linked to the referrer
  const userResp = await request.post("/api/admin/users", {
    data: {
      email: data.email,
      password: data.password,
      role: "referrer",
      referrer_id: referrerId,
      display_name: data.displayName,
    },
  });
  if (!userResp.ok()) {
    const body = await userResp.text();
    throw new Error(`createReferrerWithUser: user creation failed (${userResp.status()}): ${body}`);
  }
  const userData = (await userResp.json()) as { id: number };

  return { referrerId, userId: userData.id, email: data.email, password: data.password };
}

/**
 * Create a family under a referrer via API.
 *
 * Returns { familyId }.
 */
export async function createFamilyViaApi(
  request: APIRequestContext,
  referrerId: number,
  data: {
    familyName: string;
    familyWish: string;
    contactName: string;
    phoneNumber: string;
    address: string;
    bio?: string;
  },
): Promise<{ familyId: number }> {
  const resp = await request.post("/api/admin/families", {
    data: {
      referrer_id: referrerId,
      family_name: data.familyName,
      family_wish: data.familyWish,
      contact_name: data.contactName,
      phone_number: data.phoneNumber,
      bio: data.bio,
      address: data.address,
    },
  });
  if (!resp.ok()) {
    const body = await resp.text();
    throw new Error(`createFamilyViaApi failed (${resp.status()}): ${body}`);
  }
  const result = (await resp.json()) as { id: number };
  return { familyId: result.id };
}

/**
 * Create a person with wishes under a family via API.
 *
 * Returns { personId }.
 */
export async function createPersonViaApi(
  request: APIRequestContext,
  familyId: number,
  personData: {
    givenName: string;
    role: string;
    age: number;
    wish?: string;
    size?: string;
    funWish?: string;
    note?: string;
  },
): Promise<{ personId: number }> {
  /* Build wishes array from shorthand fields */
  const wishes: Array<{ type: string; description: string; size?: string | null }> = [];
  if (personData.wish) {
    wishes.push({ type: "practical", description: personData.wish, size: personData.size ?? null });
  }
  if (personData.funWish) {
    wishes.push({ type: "fun", description: personData.funWish });
  }

  const resp = await request.post("/api/admin/people", {
    data: {
      family_id: familyId,
      given_name: personData.givenName,
      role: personData.role,
      age: personData.age,
      wishes,
      note: personData.note ?? null,
    },
  });
  if (!resp.ok()) {
    const body = await resp.text();
    throw new Error(`createPersonViaApi failed (${resp.status()}): ${body}`);
  }
  const result = (await resp.json()) as { id: number };
  return { personId: result.id };
}

/**
 * Walk the full approval chain for a family:
 *   family → referrer (referrer approves) → admin (admin approves).
 *
 * This makes the family's wishes publicly visible (wish_lock_level = "admin").
 * Uses the CSV-seeded referrer (sarah.chen) for the referrer approval step.
 */
export async function approveWishChain(
  request: APIRequestContext,
  familyId: number,
  referrerEmail?: string,
  referrerPassword?: string,
): Promise<void> {
  // 1. Referrer approves (family → referrer lock)
  const referrerApi = await playwrightRequest.newContext({ baseURL: "http://localhost" });
  await referrerApi.post("/api/auth/login", {
    data: {
      email: referrerEmail ?? "sarah.chen@example.com",
      password: referrerPassword ?? "Password123!",
    },
  });
  const referrerResp = await referrerApi.post(`/api/referrer/families/${familyId}/approve-wishes`, {
    data: {},
  });
  if (!referrerResp.ok()) {
    const body = await referrerResp.text();
    await referrerApi.dispose();
    throw new Error(`approveWishChain: referrer approve failed (${referrerResp.status()}): ${body}`);
  }
  await referrerApi.dispose();

  // 2. Admin approves (referrer → admin lock)
  // The passed-in request context should already be admin-authenticated
  const adminResp = await request.post(`/api/admin/families/${familyId}/approve-wishes`, {
    data: {},
  });
  if (!adminResp.ok()) {
    const body = await adminResp.text();
    throw new Error(`approveWishChain: admin approve failed (${adminResp.status()}): ${body}`);
  }
}

/**
 * Fully approve a family via the admin API (skip referrer review).
 * Equivalent to the "Fully Approve" action in the admin UI.
 */
export async function fullyApproveFamilyViaApi(
  request: APIRequestContext,
  familyId: number,
): Promise<void> {
  // Direct admin approval skips referrer step
  const adminResp = await request.post(`/api/admin/families/${familyId}/approve-wishes`, {
    data: {},
  });
  if (!adminResp.ok()) {
    const body = await adminResp.text();
    throw new Error(`fullyApproveFamilyViaApi failed (${adminResp.status()}): ${body}`);
  }
}

/**
 * Login via API and return an authenticated request context.
 */
export async function loginViaApi(
  baseRequest: APIRequestContext,
  email?: string,
  password?: string,
): Promise<APIRequestContext> {
  await baseRequest.post("/api/auth/login", {
    data: {
      email: email ?? getAdminEmail(),
      password: password ?? getAdminPassword(),
    },
  });
  return baseRequest;
}

/**
 * Create a referrer + referrer-user pair via API and return credentials.
 * Unlike createReferrerWithUser (which creates an admin-linked user),
 * this creates a referrer user that can log in and approve families.
 *
 * Returns { referrerId, userId, email, password }.
 */
export async function createReferrerWithUserAndCredentials(
  request: APIRequestContext,
  data: {
    name: string;
    familyLimit: number;
    phoneNumber: string;
    email: string;
    password: string;
    displayName?: string;
  },
): Promise<{ referrerId: number; userId: number; email: string; password: string }> {
  // Create the referrer profile
  const referrerResp = await request.post("/api/admin/referrers", {
    data: {
      name: data.name,
      family_limit: data.familyLimit,
      phone_number: data.phoneNumber,
    },
  });
  if (!referrerResp.ok()) {
    const body = await referrerResp.text();
    throw new Error(`createReferrerWithUserAndCredentials: referrer creation failed (${referrerResp.status()}): ${body}`);
  }
  const referrerData = (await referrerResp.json()) as { id: number };
  const referrerId = referrerData.id;

  // Create the user linked to the referrer (role=referrer so they can log in)
  const userResp = await request.post("/api/admin/users", {
    data: {
      email: data.email,
      password: data.password,
      role: "referrer",
      referrer_id: referrerId,
      display_name: data.displayName,
    },
  });
  if (!userResp.ok()) {
    const body = await userResp.text();
    throw new Error(`createReferrerWithUserAndCredentials: user creation failed (${userResp.status()}): ${body}`);
  }
  const userData = (await userResp.json()) as { id: number };

  return { referrerId, userId: userData.id, email: data.email, password: data.password };
}

/**
 * Create a donor user via the admin API.
 *
 * Returns { userId, email, password }.
 */
export async function createDonorWithUser(
  request: APIRequestContext,
  data: {
    email: string;
    password: string;
    displayName?: string;
  },
): Promise<{ userId: number; email: string; password: string }> {
  const userResp = await request.post("/api/admin/users", {
    data: {
      email: data.email,
      password: data.password,
      role: "donor",
      display_name: data.displayName,
    },
  });
  if (!userResp.ok()) {
    const body = await userResp.text();
    throw new Error(`createDonorWithUser: user creation failed (${userResp.status()}): ${body}`);
  }
  const userData = (await userResp.json()) as { id: number };

  return { userId: userData.id, email: data.email, password: data.password };
}

/**
 * Create a complete isolated test scenario: referrer → family → person with wishes.
 * All entities use unique names so parallel test workers don't collide.
 *
 * Returns all created IDs for cleanup.
 */
export async function createIsolatedFamilyScenario(
  request: APIRequestContext,
  suffix: string,
  opts?: {
    familyWish?: string;
    familyAddress?: string;
    personName?: string;
    personRole?: string;
    personAge?: number;
    personWish?: string;
    personSize?: string;
    personFunWish?: string;
  },
): Promise<{
  referrerId: number;
  referrerEmail: string;
  referrerPassword: string;
  familyId: number;
  familyName: string;
  personId: number;
  personName: string;
}> {
  const referrer = await createReferrerWithUserAndCredentials(request, {
    name: `E2E Ref ${suffix}`,
    familyLimit: 5,
    phoneNumber: "555-000-9999",
    email: `e2e-ref-${suffix}@example.com`,
    password: "Password123!",
  });

  const familyName = `E2E Family ${suffix}`;
  const family = await createFamilyViaApi(request, referrer.referrerId, {
    familyName,
    familyWish: opts?.familyWish ?? "A warm blanket for everyone",
    contactName: `Contact ${suffix}`,
    phoneNumber: "555-111-2222",
    address: opts?.familyAddress ?? "none",
  });

  const personName = opts?.personName ?? `Child ${suffix}`;
  const person = await createPersonViaApi(request, family.familyId, {
    givenName: personName,
    role: opts?.personRole ?? "son",
    age: opts?.personAge ?? 7,
    wish: opts?.personWish ?? "Warm winter coat",
    size: opts?.personSize ?? "7",
    funWish: opts?.personFunWish ?? "LEGO set",
  });

  return {
    referrerId: referrer.referrerId,
    referrerEmail: referrer.email,
    referrerPassword: referrer.password,
    familyId: family.familyId,
    familyName,
    personId: person.personId,
    personName,
  };
}
