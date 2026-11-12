import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, expectTouchTargets } from "./helpers";

// Expectations rest on the demo catalogue (src/ingestion/adapters/mock/catalogue.ts).
const cards = (page: Page) => page.getByTestId("product-card");
const card = (page: Page, chain: string): Locator => cards(page).filter({ hasText: chain });

test.describe("search", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("a typo still finds the product, with the lowest price and best unit price marked", async ({ page }) => {
    await page.goto("/search?q=spagetti");
    await expect(page.getByText("4 resultaten")).toBeVisible();
    await expect(cards(page)).toHaveCount(4);
    for (const one of await cards(page).all()) await expect(one).toContainText(/spaghetti/i);

    const dirk = card(page, "Dirk");
    await expect(dirk).toContainText("€ 0,89");
    await expect(dirk).toContainText("€ 1,78 per kg");
    await expect(dirk).toContainText("Laagste prijs");
    await expect(dirk).toContainText("Beste prijs per kg");
    await expect(page.getByText("Laagste prijs")).toHaveCount(1);
    await expect(cards(page).first()).toContainText("Dirk");
    await expect(dirk).toContainText("Bron: demodata");

    await expect(page.getByText("Demodata", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("De eindprijs en beschikbaarheid worden bevestigd door de winkel")).toBeVisible();
  });

  test("a size in the query is recognised and that size is listed first", async ({ page }) => {
    await page.goto("/search?q=halfvolle+melk+1+liter");
    await expect(page.getByTestId("search-understood")).toHaveText("Gezocht op: halfvolle melk · maat 1 l");
    const sized = page.getByRole("list", { name: "In deze maat" }).getByTestId("product-card");
    await expect(sized).toHaveCount(4);

    // Vomar has a verified price cut running: the offer price is the price shown.
    const vomar = sized.filter({ hasText: "Vomar" });
    await expect(vomar).toContainText(/Vomar · Aanbieding · (Nog \d+ dag|Verloopt vandaag)/);
    await expect(vomar).toContainText("€ 0,89");
    await expect(vomar).toContainText("van € 1,09");
    await expect(vomar).toContainText("Laagste prijs");
    await expect(vomar).toContainText("Beste prijs per liter");
  });

  test("a size nobody sells is said so, and other sizes are shown", async ({ page }) => {
    await page.goto("/search?q=cola+1,5+l");
    await expect(page.getByText("Geen product in deze maat gevonden. Dit zijn andere maten.")).toBeVisible();
    await expect(cards(page)).toHaveCount(3);
    await expect(page.getByTestId("search-understood")).toContainText("maat 1,5 l");
  });

  test("a deal that needs several items is described and does not change the price of one", async ({ page }) => {
    await page.goto("/search?q=griekse+yoghurt");
    const ah = card(page, "Albert Heijn");
    await expect(ah).toContainText("€ 2,19");
    await expect(ah).toContainText("1+1 gratis · geldt vanaf 2 stuks");
    await expect(ah).not.toContainText("Aanbieding ·");
    await expect(card(page, "Dirk")).toContainText("Laagste prijs");
  });

  test("an unverified offer is labelled and never lowers the price", async ({ page }) => {
    await page.goto("/search?q=eieren");
    const jumbo = card(page, "Jumbo");
    await expect(jumbo).toContainText("Te controleren");
    await expect(jumbo).toContainText("Aanbieding met onbekende geldigheid: niet meegerekend in de prijs.");
    await expect(jumbo).toContainText("€ 3,19");
    await expect(jumbo).not.toContainText("Laagste prijs");
  });

  test("a barcode finds the product at every chain that sells it", async ({ page }) => {
    await page.goto("/search?q=2000000000015");
    await expect(page.getByTestId("search-understood")).toHaveText("Gezocht op: EAN 2000000000015");
    await expect(cards(page)).toHaveCount(3);
    for (const one of await cards(page).all()) await expect(one).toContainText(/Molenhof/);
  });

  test("brand, organic and cheapest-first are understood", async ({ page }) => {
    await page.goto("/search?q=wasmiddel+goedkoop");
    await expect(page.getByTestId("search-understood")).toHaveText("Gezocht op: wasmiddel · goedkoopste eerst");
    await expect(cards(page).first()).toContainText("Dirk");

    await page.goto("/search?q=biologische+havermout");
    await expect(page.getByTestId("search-understood")).toHaveText("Gezocht op: havermout · biologisch");
    await expect(cards(page)).toHaveCount(3);

    await page.goto("/search?q=molenhof");
    await expect(page.getByTestId("search-understood")).toHaveText("Gezocht op: merk Molenhof");
  });

  test("Italian words search the Dutch catalogue, in Italian", async ({ page }) => {
    await page.goto("/it/search?q=latte+1+litro");
    await expect(page.getByTestId("search-understood")).toHaveText("Ricerca per: melk · formato 1 l");
    await expect(page.getByRole("list", { name: "In questo formato" }).getByTestId("product-card")).toHaveCount(4);
    await expect(page.getByText("Prezzo più basso")).toBeVisible();
    await expect(page.getByText("Miglior prezzo al litro")).toBeVisible();
    // Four 1 l packs, and the two 2 l packs under "other sizes".
    await expect(page.getByText("6 risultati")).toBeVisible();
    await expect(page.getByRole("list", { name: "Altri formati" }).getByTestId("product-card")).toHaveCount(2);
  });

  test("nothing found, and nothing asked, each have their own state", async ({ page }) => {
    await page.goto("/search?q=xyzzy");
    await expect(page.getByRole("heading", { name: "Niets gevonden voor “xyzzy”" })).toBeVisible();
    await expect(page.getByText("Geen resultaten")).toBeVisible();
    await expect(cards(page)).toHaveCount(0);

    await page.goto("/search");
    await expect(page.getByRole("heading", { name: "Zoek een product" })).toBeVisible();
    await page.goto("/search?q=+++");
    await expect(page.getByRole("heading", { name: "Zoek een product" })).toBeVisible();
  });

  test("searching from the home page keeps the words in the field", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("searchbox").fill("kipfile 500 gram");
    await page.getByRole("searchbox").press("Enter");
    await expect(page).toHaveURL(/\/search\?q=kipfile\+500\+gram$/);
    await expect(page.getByRole("searchbox")).toHaveValue("kipfile 500 gram");
    await expect(card(page, "Dirk")).toContainText("€ 3,49");
    await expect(card(page, "Dirk")).toContainText("van € 4,99");
    await expect(page).toHaveTitle(/kipfile 500 gram · Zoeken/);
  });

  test("markup in the query is shown as text", async ({ page }) => {
    await page.goto(`/search?q=${encodeURIComponent('<img src=x onerror="window.hacked=1">')}`);
    await expect(page.getByRole("heading", { name: /Niets gevonden voor/ })).toContainText("<img src=x");
    expect(await page.evaluate(() => (window as unknown as { hacked?: number }).hacked)).toBeUndefined();
  });

  test("results fit a phone and every control can be tapped", async ({ page }) => {
    await page.goto("/search?q=halfvolle+melk+1+liter");
    await expectNoHorizontalScroll(page);
    await expectTouchTargets(page);
    await page.goto("/search?q=xyzzy");
    await expectNoHorizontalScroll(page);
    await expectTouchTargets(page);
  });
});
