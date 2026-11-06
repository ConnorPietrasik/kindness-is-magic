import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Admin dashboard tile show/hide and drag-to-reorder — the choices are
 * per-browser preferences (localStorage), so the ephemeral test context
 * needs no cleanup.
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

/**
 * Tile order tests. The gear Reset normalizes BOTH visibility and order
 * (the storageState file may carry a customized layout), so each test
 * starts from the known default grid.
 *
 * The grid reflows live while dragging (the tile being dragged moves to its
 * would-be slot and the others slide out of the way; the Vitest component
 * tests cover that preview deterministically). Drags here are driven with
 * explicit stepped mouse moves, and the tests assert the OUTCOME of the
 * release: headless Chromium delivers native drag events non-deterministically
 * (incrementally, or in a burst at gesture end), so mid-drag rendering
 * can't be asserted — but every delivery mode converges on the same
 * committed order.
 *
 * Default visible tile order (CSV Import and Sponsorships hidden by
 * default): Manage Users, Manage Referrers, Manage Families, Manage
 * People, Invite Codes, Wish Approval, Deadlines, Manage Wishes, My
 * Assigned Gifts, Packing Slips, Delivery Slips, Blank Wish Cards, Sent
 * Emails, Unsubscribed Emails, Zeffy Payments, Browse Families.
 */
test.describe("Admin dashboard tile order", () => {
  const tileGrid = (page: Page) => page.locator("div.grid").first().locator("a");

  const openTileMenu = async (page: Page) => {
    await page.getByRole("button", { name: "Toggle dashboard tiles" }).click();
  };

  /** Reset visibility AND order via the gear, then close the popover (it overlaps the grid). */
  const resetTilesViaGear = async (page: Page) => {
    await openTileMenu(page);
    await page.getByRole("button", { name: "Reset" }).click();
    await openTileMenu(page);
  };

  /** Press on the center of `from`, starting a native drag (scrolled into view first — an off-viewport center would never start a drag). */
  const beginDrag = async (page: Page, from: Locator) => {
    await from.scrollIntoViewIfNeeded();
    const src = (await from.boundingBox())!;
    await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
    await page.mouse.down();
  };

  /**
   * Move the held cursor to the top-left of `to` (its "before" half) in
   * several steps, as during a real drag.
   */
  const stepDragTo = async (page: Page, to: Locator) => {
    await to.scrollIntoViewIfNeeded();
    const dst = (await to.boundingBox())!;
    await page.mouse.move(dst.x + 4, dst.y + 8, { steps: 8 });
  };

  test("drag reorders tiles, order persists across reload, reset restores default", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/dashboard");
    await expect(tileGrid(page).first()).toBeVisible({ timeout: 10_000 });
    await resetTilesViaGear(page);

    await expect(tileGrid(page).nth(0)).toContainText("Manage Users");
    await expect(tileGrid(page).nth(5)).toContainText("Wish Approval");

    // Drag "Wish Approval" to the top-left of "Manage Users" (its "before" half).
    await beginDrag(page, page.getByRole("link", { name: /Wish Approval/ }));
    await stepDragTo(page, page.getByRole("link", { name: /Manage Users/ }));
    await page.mouse.up();

    await expect(tileGrid(page).nth(0)).toContainText("Wish Approval");
    await expect(tileGrid(page).nth(1)).toContainText("Manage Users");
    await expect(tileGrid(page).nth(2)).toContainText("Manage Referrers");

    // The custom order survives a reload (persisted in localStorage).
    await page.reload();
    await expect(tileGrid(page).nth(0)).toContainText("Wish Approval");
    await expect(tileGrid(page).nth(1)).toContainText("Manage Users");

    // "Reset" (gear) restores the default order and default-visible set.
    await openTileMenu(page);
    await page.getByRole("button", { name: "Reset" }).click();
    await openTileMenu(page); // close the popover
    await expect(tileGrid(page).nth(0)).toContainText("Manage Users");

    await context.close();
  });

  test("reordering across a hidden tile: re-showing it returns it to its saved slot", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/dashboard");
    await expect(tileGrid(page).first()).toBeVisible({ timeout: 10_000 });
    await resetTilesViaGear(page);

    // Hide "Deadlines" (between "Wish Approval" and "Manage Wishes").
    await openTileMenu(page);
    await page.getByRole("checkbox", { name: "Deadlines" }).uncheck();
    await expect(page.getByRole("link", { name: /Deadlines/ })).toHaveCount(0);
    await openTileMenu(page); // close the popover

    // Drag "Manage Wishes" to the top-left of "Invite Codes" — the move
    // spans the hidden tile's slot (and "Wish Approval's").
    await beginDrag(page, page.getByRole("link", { name: /Manage Wishes/ }));
    await stepDragTo(page, page.getByRole("link", { name: /Invite Codes/ }));
    await page.mouse.up();

    await expect(tileGrid(page).nth(4)).toContainText("Manage Wishes");
    await expect(tileGrid(page).nth(5)).toContainText("Invite Codes");
    await expect(tileGrid(page).nth(6)).toContainText("Wish Approval");

    // Re-show "Deadlines" — it must return to its saved slot (between
    // "Wish Approval" and "My Assigned Gifts"), with the dragged neighbors
    // exactly where the drop left them.
    await openTileMenu(page);
    await page.getByRole("checkbox", { name: "Deadlines" }).check();
    await expect(page.getByRole("link", { name: /Deadlines/ })).toBeVisible();

    await expect(tileGrid(page).nth(4)).toContainText("Manage Wishes");
    await expect(tileGrid(page).nth(5)).toContainText("Invite Codes");
    await expect(tileGrid(page).nth(6)).toContainText("Wish Approval");
    await expect(tileGrid(page).nth(7)).toContainText("Deadlines");
    await expect(tileGrid(page).nth(8)).toContainText("My Assigned Gifts");

    await context.close();
  });
});
