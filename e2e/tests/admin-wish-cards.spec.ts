/**
 * Blank Wish Cards — admin print page.
 *
 *  - The admin dashboard's "Blank Wish Cards" tile links to the page.
 *  - Defaults render 4 cards (3 person + 1 family); person cards carry the
 *    field labels (Name/Age/Wish type/Wish/Size/Color) + the printed "#"
 *    ID line (no ruled lines); the family card shows the "Family Wish"
 *    heading and no Name/Age labels.
 *  - The count inputs re-render the card set.
 *  - Print media mirrors the public wish-cards sheet: 2-column grid,
 *    unsplit cards, hidden screen chrome, @page margin 0.
 *
 * Self-contained: the page is static (no API, no data), so this spec uses
 * only the admin storageState — no setup or teardown.
 */
import { test, expect } from "@playwright/test";

test.describe("Admin Blank Wish Cards", () => {
  test("dashboard tile links to the blank wish cards page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/dashboard");
    await page.getByRole("link", { name: /Blank Wish Cards/ }).click();

    await expect(page).toHaveURL("/admin/wish-cards");
    await expect(page.getByRole("heading", { name: "Blank Wish Cards" })).toBeVisible({ timeout: 10_000 });

    await context.close();
  });

  test("defaults render 3 person cards + 1 family card with the labeled lines", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/admin/wish-cards");

    const cards = page.locator("article.wish-card");
    await expect(cards).toHaveCount(4, { timeout: 10_000 });
    const personCards = page.locator("article.wish-card:not(.wish-card--family)");
    await expect(personCards).toHaveCount(3);
    const familyCard = page.locator("article.wish-card--family");
    await expect(familyCard).toHaveCount(1);

    /* Person cards: the full label set (no ruled lines — the details are
       handwritten freehand) */
    for (const label of ["Name:", "Age:", "Wish type:", "Wish:", "Size:", "Color:"]) {
      await expect(personCards.filter({ hasText: label })).toHaveCount(3);
    }

    /* Every card (person + family) carries exactly one printed "#" — the
       admin writes the ID next to it */
    await expect(cards.locator("span.font-mono")).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      await expect(cards.nth(i).locator("span.font-mono")).toHaveText("#");
    }

    /* Family card: printed heading + wish label, no person identity labels */
    await expect(familyCard.getByRole("heading", { name: "Family Wish" })).toBeVisible();
    await expect(familyCard).toContainText("Wish:");
    await expect(familyCard).not.toContainText("Name:");
    await expect(familyCard).not.toContainText("Age:");

    await context.close();
  });

  test("the count inputs re-render the card set", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/admin/wish-cards");

    const cards = page.locator("article.wish-card");
    await expect(cards).toHaveCount(4, { timeout: 10_000 });

    await page.getByLabel("Person cards").fill("1");
    await expect(cards).toHaveCount(2);
    await expect(page.locator("article.wish-card:not(.wish-card--family)")).toHaveCount(1);

    /* Emptied input → 0 cards of that kind */
    await page.getByLabel("Family cards").fill("");
    await expect(cards).toHaveCount(1);

    await context.close();
  });

  test("cards page is print-optimized: 2-column grid, unsplit cards, hidden chrome", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "storage/admin.json" });
    const page = await context.newPage();

    await page.goto("/admin/wish-cards");

    /* The 2-column grid (2×2 cards per US Letter page) holds on screen too */
    const grid = page.locator(".wish-cards-grid");
    expect(await grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length)).toBe(2);

    /* Print media: cards stay whole and the screen-only chrome disappears */
    await page.emulateMedia({ media: "print" });
    const cards = page.locator("article.wish-card");
    const count = await cards.count();
    for (let i = 0; i < count; i++) {
      expect(await cards.nth(i).evaluate((el) => getComputedStyle(el).breakInside)).toBe("avoid");
    }
    await expect(page.getByRole("button", { name: "🖨️ Print" })).toBeHidden();

    /* @page margin 0 keeps the browser from drawing its print
       header/footer (date, title, URL) */
    const pageMargin = await page.evaluate(() => {
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          if (rule instanceof CSSPageRule) return rule.style.margin;
        }
      }
      return null;
    });
    expect(pageMargin).toBe("0px");

    await context.close();
  });
});
