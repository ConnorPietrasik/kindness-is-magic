import { defineConfig } from "@playwright/test";
import { getBaseUrl } from "./helpers/env";

/**
 * Playwright configuration for the help-page screenshot capture script
 * (scripts/help-screenshots.spec.ts). Deliberately separate from the main
 * config so the capture never runs as part of the normal e2e suite (CI runs
 * the whole suite; regenerating committed guide images there is worthless
 * and adds flake surface).
 *
 * Run from e2e/ (dev stack must be up):
 *   npx playwright test --config=playwright.screenshots.config.ts
 *
 * Determinism: one worker (sequential, no contention on shared demo rows),
 * fixed viewport/timezone/locale, and the script itself hides volatile UI
 * (deadline banners) before capturing. globalSetup is the standard one: it
 * seeds the demo CSV and generates the five storageState files.
 */
export default defineConfig({
  testDir: "./scripts",
  globalSetup: "./helpers/global-setup",
  fullyParallel: false,
  workers: 1,
  retries: 0,

  /* Multi-step setup + many page loads; 3 min keeps headroom under load */
  timeout: 180_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: getBaseUrl(),
    viewport: { width: 1440, height: 1000 },
    locale: "en-US",
    timezoneId: "America/Los_Angeles",
    trace: "off",
    screenshot: "off",
    video: "off",
  },

  /* Single project — the script manages its own contexts. No device spread:
     it would override the fixed viewport above. */
  projects: [{ name: "chromium" }],

  /* No HTML report — the output is the PNGs, not test results */
  reporter: [["list"]],
});
