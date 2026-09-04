/**
 * Minimal HS256 JWT signing via Web Crypto (no external JWT dependency).
 *
 * Used to forge a valid-but-EXPIRED access token, simulating the browser
 * state after the 30-minute access-token window has elapsed while the
 * refresh token is still valid.
 */
import { webcrypto } from "node:crypto";

function base64urlEncode(data: string | Uint8Array): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return Buffer.from(bytes).toString("base64url");
}

/** Sign an arbitrary payload as an HS256 JWT. */
export async function signJwtHS256(secret: string, payload: Record<string, unknown>): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const signingInput = `${base64urlEncode(JSON.stringify(header))}.${base64urlEncode(JSON.stringify(payload))}`;
  const key = await webcrypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await webcrypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64urlEncode(new Uint8Array(signature))}`;
}

/**
 * Access token with the backend's claim shape (sub, role) but already
 * expired — what the browser holds after the access-token window lapses.
 */
export async function makeExpiredAccessToken(secret: string, userId: number, role: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return signJwtHS256(secret, { sub: String(userId), role, iat: now - 3600, exp: now - 60 });
}
