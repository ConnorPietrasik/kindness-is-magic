import fs from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Parse a simple .env file (KEY=VALUE, one per line).
 * Handles quoted values and comments.
 */
function parseEnv(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    map.set(key, value);
  }
  return map;
}

/**
 * Read the project root .env file and return parsed values.
 */
function readProjectEnv(): Map<string, string> {
  const envPath = resolve(__dirname, "../../.env");
  const content = fs.readFileSync(envPath, "utf-8");
  return parseEnv(content);
}

/**
 * Get the admin password from the project .env file.
 * This avoids hardcoding a real password in the repo.
 */
export function getAdminPassword(): string {
  const env = readProjectEnv();
  const password = env.get("ADMIN_PASSWORD");
  if (!password) {
    throw new Error(
      "ADMIN_PASSWORD not found in .env. " +
        "Copy .env.example to .env and set it.",
    );
  }
  return password;
}

/**
 * Get the admin email from the project .env file (fallback to default).
 */
export function getAdminEmail(): string {
  const env = readProjectEnv();
  return env.get("ADMIN_EMAIL") ?? "connor@kindnessismagic.love";
}
