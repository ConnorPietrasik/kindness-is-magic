import { expect, test } from "@playwright/test";

/**
 * Admin dashboard tile show/hide — the choice is a per-browser preference
 * (localStorage), so the ephemeral test context needs no cleanup.
 */
test.describe("Admin dashboard tiles", () => {
  test("hiding a tile persists across reloads; Reset restores the default set", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/dashboard");
    const gear = page.getByRole("button", { name: "Toggle dashboard tiles" });
    const emailsTile = page.getByRole("link", { name: /Sent Emails/ });
    const csvTile = page.getByRole("link", { name: /CSV Import/ });
    await expect(emailsTile).toBeVisible({ timeout: 10_000 });

    // CSV Import is hidden by default (mostly used for demo and testing)
    await expect(csvTile).toHaveCount(0);

    // Hide a tile from the popover
    await gear.click();
    await page.getByRole("checkbox", { name: "Sent Emails" }).uncheck();
    await expect(emailsTile).toHaveCount(0);

    // Preference survives a reload
    await page.reload();
    await expect(emailsTile).toHaveCount(0);

    // Reset restores the default set — Sent Emails back, CSV Import still hidden
    await gear.click();
    await page.getByRole("button", { name: "Reset" }).click();
    await expect(emailsTile).toBeVisible();
    await expect(csvTile).toHaveCount(0);

    await context.close();
  });
});
