/**
 * Zeffy mock — control + gate helpers for the e2e suite.
 *
 * The dev/e2e stack runs a `zeffy-mock` compose service (e2e/mock/zeffy_mock.py)
 * and the stack's .env points ZEFFY_API_BASE at it, so the full
 * cash-sponsorship flow (checkout → confirm → admin reconciliation) runs
 * end to end without a single call to the real, org-rate-limited Zeffy API.
 *
 * The backend talks to the mock by compose service name (unreachable from
 * here); the tests reach the same server through its published port on the
 * stack host (port 8931) to seed payments via the control endpoints.
 */
import { request as playwrightRequest } from "@playwright/test";
import { getBaseUrl, getEnvValue } from "./env";

/** Port the zeffy-mock service publishes on the stack host (docker-compose.yml). */
export const ZEFFY_MOCK_PORT = 8931;

/**
 * Host-reachable base URL of the mock (control endpoints + form page):
 * ZEFFY_MOCK_URL (env or .env) or the stack host from E2E_BASE_URL + the
 * published port.
 */
export function getZeffyMockUrl(): string {
  const explicit = getEnvValue("ZEFFY_MOCK_URL");
  if (explicit) return explicit.replace(/\/$/, "");
  return `http://${new URL(getBaseUrl()).host}:${ZEFFY_MOCK_PORT}`;
}

/** The configured ZEFFY_FORM_URL (the mock's /form page in dev/e2e). */
export function getZeffyFormUrl(): string {
  const url = getEnvValue("ZEFFY_FORM_URL");
  if (!url) throw new Error("ZEFFY_FORM_URL is not set in .env — see e2e/AGENTS.md");
  return url;
}

/** The configured ZEFFY_CAMPAIGN_ID (mock campaign UUID in dev/e2e). */
export function getZeffyCampaignId(): string {
  const id = getEnvValue("ZEFFY_CAMPAIGN_ID");
  if (!id) throw new Error("ZEFFY_CAMPAIGN_ID is not set in .env — see e2e/AGENTS.md");
  return id;
}

/**
 * Gate for the full-flow tests: null when the mock is usable, otherwise the
 * reason to skip. Checks the .env the stack's backend loads (ZEFFY_API_BASE
 * must point at the mock — that is what keeps these tests away from the real
 * Zeffy API) plus a live probe of the mock's control endpoint.
 */
export async function zeffyMockGate(): Promise<string | null> {
  const apiBase = getEnvValue("ZEFFY_API_BASE") ?? "";
  if (!apiBase.includes("zeffy-mock")) {
    return `ZEFFY_API_BASE in .env must point at the mock (http://zeffy-mock:${ZEFFY_MOCK_PORT})`;
  }
  if (!getEnvValue("ZEFFY_API_KEY") || !getEnvValue("ZEFFY_CAMPAIGN_ID") || !getEnvValue("ZEFFY_FORM_URL")) {
    return "ZEFFY_API_KEY / ZEFFY_CAMPAIGN_ID / ZEFFY_FORM_URL are not set in .env";
  }
  try {
    const ctx = await playwrightRequest.newContext({ baseURL: getZeffyMockUrl() });
    try {
      const resp = await ctx.get("/", { maxRetries: 0 });
      if (resp.status() !== 200) return `mock answered ${resp.status()} at ${getZeffyMockUrl()}`;
    } finally {
      await ctx.dispose();
    }
  } catch (err) {
    return `mock not reachable at ${getZeffyMockUrl()} — is the zeffy-mock compose service running? (${String(err).split("\n")[0]})`;
  }
  return null;
}

/** One mock payment (subset of the real API shape; the mock fills defaults). */
export interface MockPayment {
  /** Stable id (uuid) — omit for a generated one. */
  id?: string;
  /** Buyer email — the reconciliation key. Omit for a buyer-less payment. */
  email?: string;
  /** Amount in dollars (converted to cents for the mock). */
  amountUsd?: number;
  /** Buyer name for display (mock splits into first/last). */
  name?: string;
  status?: "succeeded" | "failed" | "pending";
  currency?: string;
  /** Campaign uuid — defaults to the configured one. */
  campaignId?: string;
  /** Shift `created` by this many seconds (negative = older payment). */
  createdOffsetSeconds?: number;
}

async function mockRequest(method: "GET" | "POST", path: string, data?: unknown) {
  const ctx = await playwrightRequest.newContext({ baseURL: getZeffyMockUrl() });
  try {
    const resp = method === "GET" ? await ctx.get(path, { maxRetries: 0 }) : await ctx.post(path, { data, maxRetries: 0 });
    if (!resp.ok()) throw new Error(`mock answered ${resp.status()}: ${await resp.text()}`);
    return resp;
  } catch (err) {
    throw new Error(`zeffy-mock ${method} ${path} failed: ${String(err).split("\n")[0]}`);
  } finally {
    await ctx.dispose();
  }
}

/**
 * Clear this spec's mock payments. The suite runs fully parallel against one
 * shared mock, so control calls are scoped by the spec's tag — never reset
 * without a tag while other specs may be seeding.
 */
export async function mockReset(tag: string): Promise<void> {
  await mockRequest("POST", `/__control/reset?tag=${encodeURIComponent(tag)}`);
}

/** Seed mock payments tagged with this spec (upsert by id; generated when omitted). */
export async function mockSeedPayments(tag: string, payments: MockPayment[]): Promise<void> {
  const body = (await toMockPayload(payments)).map((p) => ({ ...p, tag }));
  await mockRequest("POST", "/__control/payments", body);
}

/** This spec's mock payment list (control endpoint, tag-scoped). */
export async function mockListPayments(tag: string): Promise<unknown[]> {
  const resp = await mockRequest("GET", `/__control/payments?tag=${encodeURIComponent(tag)}`);
  const body = (await resp.json()) as { payments: unknown[] };
  return body.payments;
}

/**
 * Translate MockPayment objects to the mock's payload. Fresh payments omit
 * `created` so the mock stamps its own (host) clock — no VM/host clock skew
 * against the backend's payment-window anchor. Offset payments use the
 * mock's clock as the base (read from its health endpoint).
 */
async function toMockPayload(payments: MockPayment[]): Promise<object[]> {
  let baseNow: number | null = null;
  if (payments.some((p) => p.createdOffsetSeconds)) {
    const ctx = await playwrightRequest.newContext({ baseURL: getZeffyMockUrl() });
    try {
      const resp = await ctx.get("/", { maxRetries: 0 });
      baseNow = ((await resp.json()) as { now: number }).now;
    } finally {
      await ctx.dispose();
    }
  }
  return payments.map((p) => {
    const name = p.name ?? "E2E Donor";
    return {
      ...(p.id ? { id: p.id } : {}),
      amount: Math.round((p.amountUsd ?? 500) * 100),
      status: p.status ?? "succeeded",
      ...(p.currency ? { currency: p.currency } : {}),
      ...(p.campaignId ? { campaign_id: p.campaignId } : {}),
      ...(p.createdOffsetSeconds && baseNow != null ? { created: baseNow + p.createdOffsetSeconds } : {}),
      ...(p.email
        ? {
            buyer: {
              email: p.email,
              first_name: name.split(" ")[0],
              last_name: name.split(" ").slice(1).join(" ") || null,
              is_corporate: false,
              company_name: null,
            },
          }
        : {}),
    };
  });
}
