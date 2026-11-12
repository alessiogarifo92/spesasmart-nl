import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, expectTouchTargets } from "./helpers";

// Expectations rest on the demo catalogue (src/ingestion/adapters/mock/catalogue.ts).
const rows = (page: Page) => page.getByTestId("comparison-row");

/** Opens the price comparison of one chain's listing through the search results. */
async function openComparison(page: Page, query: string, chain: string) {
  await page.goto(`/search?q=${encodeURIComponent(query)}`);
  const card = page.getByTestId("product-card").filter({ hasText: chain }).first();
  await card.getByRole("link", { name: /^Vergelijk prijzen van / }).click();
  await expect(page).toHaveURL(/\/product\/[a-z0-9]+$/);
  await expect(page.getByRole("heading", { level: 1, name: "Prijsvergelijking" })).toBeVisible();
}

test.describe("price comparison", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("a product is shown next to the same thing at other chains, cheapest marked", async ({ page }) => {
    await openComparison(page, "spagetti", "Dirk");
    const main = page.getByTestId("product-card").first();
    await expect(main).toContainText("Dirk");
    await expect(main).toContainText("Spaghetti 500 g");
    await expect(main).toContainText("Laagste prijs");
    await expect(main).toContainText("Beste prijs per kg");
    // The page of a product does not link to itself.
    await expect(main.getByRole("link", { name: /^Vergelijk/ })).toHaveCount(0);

    const elsewhere = page.getByRole("list", { name: "Bij andere winkels" }).getByTestId("comparison-row");
    await expect(elsewhere).toHaveCount(2);
    await expect(elsewhere.nth(0)).toContainText("Zeer vergelijkbaar");
    await expect(elsewhere.nth(0)).toContainText("Vomar");
    await expect(elsewhere.nth(0)).toContainText("€ 0,95");
    await expect(elsewhere.nth(1)).toContainText("Albert Heijn");
    await expect(page.getByText("Laagste prijs")).toHaveCount(1);
    // "Spaghetti pasta" at Jumbo shares one word of two: that link waits for review and is not shown.
    await expect(page.getByText("Spaghetti pasta")).toHaveCount(0);

    await expect(page.getByText("Producten worden automatisch aan elkaar gekoppeld")).toBeVisible();
    await expect(page.getByText("Demodata", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("De eindprijs en beschikbaarheid worden bevestigd door de winkel")).toBeVisible();
    await expect(page).toHaveTitle(/Spaghetti 500 g · Prijsvergelijking/);
  });

  test("one barcode at several chains is called the same product", async ({ page }) => {
    await openComparison(page, "molenhof", "Albert Heijn");
    await expect(rows(page)).toHaveCount(2);
    for (const row of await rows(page).all()) await expect(row).toContainText("Zelfde product");
    await expect(page.getByText("Zeer vergelijkbaar")).toHaveCount(0);
  });

  test("another size is an alternative, compared on the price per litre", async ({ page }) => {
    await openComparison(page, "halfvolle melk 1 liter", "Albert Heijn");
    const equals = page.getByRole("list", { name: "Bij andere winkels" }).getByTestId("comparison-row");
    await expect(equals).toHaveCount(3);
    // Vomar's verified offer is the lowest price among the 1 l packs.
    await expect(equals.first()).toContainText("Vomar");
    await expect(equals.first()).toContainText("Laagste prijs");

    const alternatives = page.getByRole("list", { name: "Alternatieven" }).getByTestId("comparison-row");
    await expect(alternatives).toHaveCount(2);
    await expect(alternatives.first()).toContainText("Alternatief");
    await expect(alternatives.first()).toContainText("Halfvolle melk 2 L");
    await expect(alternatives.first()).toContainText("€ 0,85 per liter");
    // The 2 l pack costs more, but less per litre than anything else on the page.
    await expect(alternatives.first()).toContainText("Beste prijs per liter");
    await expect(alternatives.first()).not.toContainText("Laagste prijs");
    await expect(page.getByText("Beste prijs per liter")).toHaveCount(1);
    await expect(page.getByText("Een andere maat of variant.")).toBeVisible();
  });

  test("a wrong link and a wrong price can be reported with one tap", async ({ page, context }) => {
    await openComparison(page, "spagetti", "Dirk");
    const row = rows(page).first();
    await row.getByRole("button", { name: /^Meld dat .* niet hetzelfde product is$/ }).click();
    await expect(row.getByRole("status")).toHaveText("Gemeld, bedankt.");
    await expect(row.getByRole("button", { name: /^Meld dat/ })).toHaveCount(0);

    await page.getByRole("button", { name: /^Meld dat de prijs van Spaghetti 500 g bij Dirk niet klopt$/ }).click();
    await expect(page.getByRole("status").filter({ hasText: "Gemeld, bedankt." })).toHaveCount(2);
    // Reporting stores no cookie.
    expect((await context.cookies()).map((cookie) => cookie.name)).not.toContain("ss_device");
  });

  test("a product without a sure link says so instead of guessing", async ({ page }) => {
    await openComparison(page, "spaghetti pasta", "Jumbo");
    await expect(page.getByRole("heading", { name: "Nog niets om mee te vergelijken" })).toBeVisible();
    await expect(rows(page)).toHaveCount(0);
  });

  test("an offer leads to the comparison of its product, and it can go on the list from there", async ({ page }) => {
    await page.goto("/offers");
    const offer = page.getByTestId("offer-card").first();
    await offer.getByRole("link", { name: /^Vergelijk prijzen van / }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Prijsvergelijking" })).toBeVisible();
    const main = page.getByTestId("product-card").first();
    await main.getByRole("button", { name: /op je lijst$/ }).click();
    await expect(main.getByTestId("on-list")).toHaveText("Op je lijst · 1×");
  });

  test("an unknown product is a 404", async ({ page }) => {
    const response = await page.goto("/product/doesnotexist123");
    expect(response?.status()).toBe(404);
    expect((await page.goto("/product/..%2F..%2Fetc"))?.status()).toBe(404);
  });

  test("fits 390 px with finger-sized targets, in Italian too", async ({ page }) => {
    await openComparison(page, "halfvolle melk 1 liter", "Albert Heijn");
    await expectNoHorizontalScroll(page);
    await expectTouchTargets(page);
    await page.goto(page.url().replace("/product/", "/it/product/"));
    await expect(page.getByRole("heading", { level: 1, name: "Confronto prezzi" })).toBeVisible();
    await expect(page.getByText("Molto simile").first()).toBeVisible();
    await expect(page.getByText("Alternativa", { exact: true }).first()).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});
