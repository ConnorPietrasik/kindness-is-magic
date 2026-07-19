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
