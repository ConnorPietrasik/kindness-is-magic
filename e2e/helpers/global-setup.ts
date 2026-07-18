/**
 * Global setup — runs once before all tests.
 *
 * 1. Poll the backend until it is healthy.
 * 2. Seed the database via the CSV import API.
 * 3. Generate storageState files for admin, referrer, and family roles.
 */
import type { FullConfig } from "@playwright/test";
import { chromium, request } from "@playwright/test";
import { seedDatabaseViaApi } from "./api";

async function globalSetup(_config: FullConfig): Promise<void> {
  const browser = await chromium.launch();
  const apiContext = await request.newContext({ baseURL: "http://localhost" });

  try {
    /* 1. Wait for the backend to be ready */
    console.log("[globalSetup] Waiting for backend to be healthy…");
    for (let i = 0; i < 30; i++) {
      try {
        const resp = await apiContext.get("http://localhost/api/auth/me", {
          maxRedirects: 0,
          maxRetries: 0,
        });
        /* 401 means the backend is up (we just aren't authenticated) */
        if (resp.status() === 401 || resp.status() === 403) {
          console.log("[globalSetup] Backend is healthy.");
          break;
        }
      } catch {
        /* Connection refused — backend not ready yet */
      }
      await new Promise((r) => setTimeout(r, 2000));
    }

    /* 2. Seed the database via CSV import API */
    await seedDatabaseViaApi(apiContext);

    /* 3. Generate storageState files for each role */
    await saveStorageState(browser, "admin", {
      email: "connor@kindnessismagic.love",
      password: "NoHaxPlz69420",
    });
    await saveStorageState(browser, "referrer", {
      email: "sarah.chen@example.com",
      password: "Password123!",
    });
    await saveStorageState(browser, "family", {
      email: "emily.williams@example.com",
      password: "Password123!",
    });

    console.log("[globalSetup] Setup complete.");
  } finally {
    await browser.close();
    await apiContext.dispose();
  }
}

/**
 * Login via the UI and save the resulting browser state to a storageState JSON file.
 * This captures cookies, localStorage, and sessionStorage in one go.
 */
async function saveStorageState(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  role: string,
  creds: { email: string; password: string },
): Promise<void> {
  const context = await browser.newContext();
  const page = await context.newPage();

  /* Navigate to login page */
  await page.goto("http://localhost/login");

  /* Fill credentials and submit */
  await page.getByLabel("Email").fill(creds.email);
  await page.getByLabel("Password").fill(creds.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  /* Wait for the role-specific dashboard to load */
  await page.waitForURL(/\/(dashboard|referrer\/dashboard|family\/dashboard)/);
  await page.waitForTimeout(1000);

  /* Save the storage state */
  const storagePath = `storage/${role}.json`;
  await context.storageState({ path: storagePath });
  console.log(`[globalSetup] Saved storage state for ${role} → ${storagePath}`);

  await context.close();
}

export default globalSetup;
