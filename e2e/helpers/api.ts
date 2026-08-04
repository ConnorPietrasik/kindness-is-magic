import type { APIRequestContext } from "@playwright/test";
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
 * List families (admin API) — used to find CSV-seeded family IDs.
 */
export async function listFamiliesViaApi(
  request: APIRequestContext,
): Promise<{ families: Array<{ id: number; family_name: string }>; total: number }> {
  const resp = await request.get("/api/admin/families");
  if (!resp.ok()) {
    throw new Error(`listFamiliesViaApi failed: ${resp.status()}`);
  }
  return resp.json() as Promise<{ families: Array<{ id: number; family_name: string }>; total: number }>;
}

/**
 * Reset a family's wish state to initial (family lock, no review).
 * Used by global-setup to ensure clean state after re-seeding.
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
 */
export async function listWishesViaApi(
  request: APIRequestContext,
  opts?: { assignedToId?: number; purchased?: string },
): Promise<{ wishes: Array<{ id: number; assigned_to_id: number | null; purchased_at: string | null }>; total: number }> {
  const params = new URLSearchParams();
  if (opts?.assignedToId !== undefined) params.set("assigned_to_id", String(opts.assignedToId));
  if (opts?.purchased) params.set("purchased", opts.purchased);
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
