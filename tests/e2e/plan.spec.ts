import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, expectTouchTargets } from "./helpers";

// Every test starts in a fresh browser context: no cookie, so a device with no list.
// Amounts come from the demo catalogue (prisma/seed, src/ingestion/adapters/mock/catalogue.ts).

async function add(page: Page, query: string, chain: string, times = 1) {
  await page.goto(`/search?q=${encodeURIComponent(query)}`);
  const card = page.getByTestId("product-card").filter({ hasText: chain }).first();
  for (let count = 1; count <= times; count++) {
    await card.getByRole("button", { name: /^Zet .* op je lijst$/ }).click();
    await expect(card.getByTestId("on-list")).toHaveText(`Op je lijst · ${count}×`);
  }
}

async function addText(page: Page, text: string) {
  await page.goto("/list");
  await page.getByLabel("Voeg iets toe").fill(text);
  await page.getByRole("button", { name: "Toevoegen aan lijst" }).click();
  await expect(page.getByTestId("list-item").filter({ hasText: text })).toBeVisible();
  await expect(page.getByLabel("Voeg iets toe")).toHaveValue("");
}

/** Four products picked at Albert Heijn: milk twice, chicken, coffee and spaghetti. */
async function weekList(page: Page) {
  await add(page, "halfvolle melk 1 liter", "Albert Heijn", 2);
  await add(page, "kipfilet", "Albert Heijn");
  await add(page, "molenhof", "Albert Heijn");
  await add(page, "spaghetti 500", "Albert Heijn");
}

const stops = (page: Page) => page.getByTestId("plan-stop");
const stop = (page: Page, chain: string) => stops(page).filter({ has: page.getByRole("heading", { name: chain }) });
const lines = (page: Page) => page.getByTestId("plan-line");
const total = (page: Page) => page.getByTestId("plan-total-amount");

test.describe("the route for a shopping list", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("without a list there is no route, and looking stores nothing", async ({ page, context }) => {
    await page.goto("/plan");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Jouw route");
    await expect(page.getByRole("heading", { name: "Nog geen route" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Maak je lijst" })).toHaveAttribute("href", "/list");
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Nog geen plan voor deze week" })).toBeVisible();
    await expect(page.getByTestId("plan-card")).toHaveCount(0);
    expect((await context.cookies()).map((cookie) => cookie.name)).not.toContain("ss_device");
  });

  test("the home screen shows the week's plan and leads to the route", async ({ page }) => {
    await weekList(page);
    await page.goto("/");
    const card = page.getByTestId("plan-card");
    await expect(card).toContainText("Boodschappen · 4 producten · geschat");
    await expect(card).toContainText("€ 17,65");
    await expect(card).toContainText("€ 0,20 bespaard");
    await expect(card.getByRole("listitem")).toHaveText([
      /Dirk[\s\S]*3 producten[\s\S]*€\s15,87/,
      /Vomar[\s\S]*1 product[\s\S]*€\s1,78/,
    ]);
    await expect(page.getByRole("heading", { name: "Nog geen plan voor deze week" })).toHaveCount(0);

    await card.getByRole("link", { name: "Bekijk en pas het plan aan" }).click();
    await expect(page).toHaveURL(/\/plan$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Jouw route");
    const nav = page.getByRole("navigation", { name: "Hoofdnavigatie" });
    await expect(nav.getByRole("link", { name: "Plan" })).toHaveAttribute("aria-current", "page");
  });

  test("the route lists every stop, explains each line and compares with one store", async ({ page }) => {
    await weekList(page);
    await page.goto("/list");
    await page.getByRole("link", { name: "Bekijk je route" }).click();
    await expect(page).toHaveURL(/\/plan$/);
    await expect(page.getByText("Boodschappen · 4 producten te kopen")).toBeVisible();
    await expect(page.getByText("Demodata")).toBeVisible();

    await expect(stops(page)).toHaveCount(2);
    await expect(stops(page).nth(0).getByRole("heading")).toHaveText("Dirk · 3 producten");
    await expect(stops(page).nth(1).getByRole("heading")).toHaveText("Vomar · 1 product");
    await expect(stop(page, "Dirk")).toContainText("€ 15,87");

    // The offer is priced for the two cartons on the list, and the swap is named.
    const milk = lines(page).filter({ hasText: "Halfvolle melk 1 L × 2" });
    await expect(milk).toContainText("Zeer vergelijkbaar: Halfvolle melk pak 1 L");
    await expect(milk).toContainText("Aanbieding · € 0,40 goedkoper");
    await expect(milk).toContainText("€ 1,78");
    await expect(milk).toContainText("€ 0,89 p.st.");
    const coffee = lines(page).filter({ hasText: "Molenhof Koffiebonen Aroma 1 kg" });
    await expect(coffee).toContainText("Zelfde product: Molenhof Aroma bonen 1 kg");
    await expect(coffee).toContainText("€ 11,49");
    await expect(lines(page).filter({ hasText: "Spaghetti 500 g" })).toContainText("€ 0,06 goedkoper dan bij Vomar");
    await expect(lines(page).filter({ hasText: "Kipfilet 500 g" })).toContainText("Aanbieding · € 1,50 goedkoper");

    const why = page.getByTestId("plan-why");
    await expect(why.getByRole("heading")).toHaveText("Waarom deze route?");
    await expect(why).toContainText("Alles bij Dirk zou € 17,85 kosten: deze route is € 0,20 goedkoper.");
    await expect(why).toContainText("Kipfilet 500 g is bij Dirk in de aanbieding: € 1,50 goedkoper");

    const summary = page.getByTestId("plan-total");
    await expect(summary).toContainText("Geschat totaal");
    await expect(total(page)).toHaveText("€ 17,65");
    await expect(page.getByTestId("plan-saving")).toHaveText("€ 0,20 bespaard");
    await expect(summary).toContainText("t.o.v. alles bij Dirk (€ 17,85)");
    await expect(summary).toContainText("Aanbiedingen in deze route: € 1,90 voordeel");
    await expect(summary).toContainText(
      "Schatting. De eindprijs en beschikbaarheid worden bevestigd door de winkel of de online dienst.",
    );
    await expect(summary.getByRole("link", { name: "Naar je lijst" })).toHaveAttribute("href", "/list");

    await expect(page.getByTestId("single-store")).toHaveText([
      /Dirk · alle producten[\s\S]*€\s17,85/,
      /Albert Heijn · alle producten[\s\S]*€\s21,95/,
      /Vomar · 3 van 4 producten[\s\S]*€\s7,92/,
      /Jumbo · 3 van 4 producten[\s\S]*€\s19,58/,
    ]);

    // A line leads to the price comparison of what is bought.
    await coffee.getByRole("link").click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Prijsvergelijking");
    await expect(page.getByTestId("product-card").first()).toContainText("Molenhof Aroma bonen 1 kg");
  });

  test("stores, mode, substitutes and budget change the plan and live in the address", async ({ page }) => {
    await weekList(page);
    await page.goto("/plan");
    const group = (name: string) => page.getByRole("group", { name });
    await expect(group("Hoeveel winkels?").getByRole("link", { name: "2 winkels" })).toHaveAttribute(
      "aria-current",
      "true",
    );

    await group("Hoeveel winkels?").getByRole("link", { name: "1 winkel" }).click();
    await expect(page).toHaveURL(/\/plan\?stores=1$/);
    await expect(stops(page).getByRole("heading")).toHaveText(["Dirk · 4 producten"]);
    await expect(total(page)).toHaveText("€ 17,85");
    await expect(page.getByTestId("plan-saving")).toHaveCount(0);
    await expect(page.getByTestId("plan-why")).toContainText("Bij Dirk vind je in één keer het meeste van je lijst");

    await group("Hoeveel winkels?").getByRole("link", { name: "3 winkels" }).click();
    await expect(page).toHaveURL(/\/plan\?stores=3$/);
    await group("Waar let je op?").getByRole("link", { name: "Minste winkels" }).click();
    await expect(page).toHaveURL(/\/plan\?stores=3&mode=fewest-stores$/);
    await expect(stops(page)).toHaveCount(1);
    await expect(total(page)).toHaveText("€ 17,85");

    // Only the very same product may replace the pick: three lines stay at Albert Heijn.
    await page.goto("/plan");
    await page.getByText("Budget en vervangers").click();
    await page.getByRole("link", { name: "Vergelijkbaar product mag" }).click();
    await expect(page).toHaveURL(/\/plan\?similar=0$/);
    await expect(stops(page).getByRole("heading")).toHaveText(["Dirk · 1 product", "Albert Heijn · 3 producten"]);
    await expect(total(page)).toHaveText("€ 20,45");
    await expect(lines(page).filter({ hasText: "Kipfilet 500 g" })).toContainText("Het product dat je koos");
    await expect(page.getByRole("link", { name: "Vergelijkbaar product mag" })).not.toHaveAttribute(
      "aria-current",
      "true",
    );

    await page.getByLabel("Budget in euro").fill("15,50");
    await page.getByRole("button", { name: "Pas toe" }).click();
    await expect(page).toHaveURL(/similar=0/);
    await expect(page).toHaveURL(/budget=15(%2C|,)50/);
    await expect(page.getByTestId("plan-budget")).toHaveText("€ 4,95 boven je budget van € 15,50");
    await expect(page.getByLabel("Budget in euro")).toHaveValue("15.50");
    await page.getByRole("link", { name: "Wis budget" }).click();
    await expect(page).toHaveURL(/\/plan\?similar=0$/);
    await expect(page.getByTestId("plan-budget")).toHaveCount(0);

    await page.goto("/plan?budget=20");
    await expect(page.getByTestId("plan-budget")).toHaveText("Binnen je budget van € 20,00");
    // Nonsense in the address falls back to the defaults.
    await page.goto("/plan?stores=9&mode=x&budget=abc");
    await expect(total(page)).toHaveText("€ 17,65");
    await expect(page.getByTestId("plan-budget")).toHaveCount(0);
  });

  test("filters say what falls outside them", async ({ page }) => {
    await weekList(page);
    await page.goto("/plan?stores=3");
    await page.getByRole("link", { name: "Alleen aanbiedingen" }).click();
    await expect(page).toHaveURL(/mode=offers-only/);
    await expect(stops(page).getByRole("heading")).toHaveText(["Dirk · 1 product", "Vomar · 1 product"]);
    await expect(lines(page).filter({ hasText: "Kipfilet 500 g" })).toContainText("Alleen hier in de aanbieding");
    const missing = page.getByTestId("plan-missing");
    await expect(missing).toHaveCount(2);
    await expect(missing.first()).toContainText("Molenhof Koffiebonen Aroma 1 kg");
    await expect(missing.first()).toContainText("Nu niet in de aanbieding");
    await expect(page.getByTestId("plan-total")).toContainText("Geschat totaal · 2 van 4 producten");
    await expect(total(page)).toHaveText("€ 5,27");
    // A chain with nothing on offer from the list is not offered as "everything at one store".
    await expect(page.getByTestId("single-store")).toHaveCount(2);

    await page.getByRole("link", { name: "Alleen biologisch" }).click();
    await expect(page.getByRole("heading", { name: "Niets van je lijst gevonden" })).toBeVisible();
    await expect(page.getByTestId("plan-missing")).toHaveCount(4);
    await expect(page.getByTestId("plan-missing").first()).toContainText("Geen biologische variant gevonden");
    await expect(page.getByTestId("plan-total")).toHaveCount(0);
  });

  test("typed items, pinned items and ticked items", async ({ page }) => {
    await add(page, "halfvolle melk 1 liter", "Albert Heijn");
    await addText(page, "volkoren brood");
    await addText(page, "tahin");

    await page.goto("/plan");
    const bread = lines(page).filter({ hasText: "volkoren brood" });
    await expect(bread).toContainText(/Hier: .*[Vv]olkoren/);
    const tahin = page.getByTestId("plan-missing");
    await expect(tahin).toHaveCount(1);
    await expect(tahin).toContainText("tahin");
    await expect(tahin).toContainText("Niet gevonden bij de winkels");
    await expect(tahin.getByRole("link", { name: "Zoek tahin" })).toHaveAttribute("href", "/search?q=tahin");
    await expect(page.getByTestId("plan-total")).toContainText("Geschat totaal · 2 van 3 producten");

    // Pinned to Albert Heijn, the milk stays there although Vomar has it on offer.
    await page.goto("/list");
    const milk = page.getByTestId("list-item").filter({ hasText: "Halfvolle melk 1 L" });
    await milk.getByText("Elke winkel").first().click();
    await milk
      .getByRole("group", { name: "Waar wil je dit kopen?" })
      .getByRole("button", { name: "Albert Heijn" })
      .click();
    await expect(milk.getByText("Altijd bij Albert Heijn")).toBeVisible();
    await page.goto("/plan?stores=3");
    const pinned = lines(page).filter({ hasText: "Halfvolle melk 1 L" });
    await expect(pinned).toContainText("Vastgezet bij deze winkel");
    await expect(pinned).toContainText("€ 1,19");
    await expect(stop(page, "Albert Heijn")).toContainText("Halfvolle melk 1 L");

    // What is ticked off is bought: it leaves the plan.
    await page.goto("/list");
    await milk.getByRole("button", { name: "Afgevinkt: Halfvolle melk 1 L" }).click();
    await expect(page.getByText("3 producten · 1 afgevinkt")).toBeVisible();
    await page.goto("/plan");
    await expect(page.getByText("Boodschappen · 2 producten te kopen")).toBeVisible();
    await expect(lines(page).filter({ hasText: "Halfvolle melk" })).toHaveCount(0);

    await page.goto("/list");
    for (const name of ["volkoren brood", "tahin"]) {
      await page.getByRole("button", { name: `Afgevinkt: ${name}` }).click();
      await expect(page.getByRole("button", { name: `Afgevinkt: ${name}` })).toHaveAttribute("aria-pressed", "true");
    }
    await expect(page.getByRole("link", { name: "Bekijk je route" })).toHaveCount(0);
    await page.goto("/plan");
    await expect(page.getByRole("heading", { name: "Alles is afgevinkt" })).toBeVisible();
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Alles is afgevinkt" })).toBeVisible();
  });

  test("a deal that needs more items than asked is mentioned, not applied", async ({ page }) => {
    // Vomar sells peanut butter with the second jar at half price; one jar is on the list.
    await add(page, "pindakaas", "Vomar");
    await page.goto("/plan?stores=1&similar=0");
    const line = lines(page).filter({ hasText: "Pindakaas" });
    await expect(line).toContainText("Aanbieding vanaf 2 stuks: niet meegerekend");
    await expect(line).not.toContainText("goedkoper");
    const one = await total(page).innerText();

    // With two on the list the deal counts, and the total is less than twice the price of one.
    await page.goto("/list");
    await page.getByRole("button", { name: /^Eén meer: Pindakaas/ }).click();
    await expect(page.getByTestId("item-quantity")).toHaveText("2");
    await page.goto("/plan?stores=1&similar=0");
    await expect(line).toContainText("Aanbieding");
    await expect(line).not.toContainText("niet meegerekend");
    const cents = (text: string) => Number(text.replace(/[^0-9]/g, ""));
    const two = await total(page).innerText();
    expect(cents(two)).toBeLessThan(2 * cents(one));
    expect(cents(two)).toBeGreaterThan(cents(one));
  });

  test("another device has no plan", async ({ page, browser }) => {
    await weekList(page);
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await otherPage.goto("/plan");
    await expect(otherPage.getByRole("heading", { name: "Nog geen route" })).toBeVisible();
    await other.close();
  });

  test("the route in Italian, on 390 px with finger-sized targets", async ({ page }) => {
    await weekList(page);
    await addText(page, "tahin");
    await page.goto("/plan?budget=10");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectTouchTargets(page);

    await page.goto("/it/plan?stores=3");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Il tuo percorso");
    await expect(
      page.getByRole("group", { name: "Quanti negozi?" }).getByRole("link", { name: "3 negozi" }),
    ).toHaveAttribute("aria-current", "true");
    await expect(page.getByTestId("plan-why").getByRole("heading")).toHaveText("Perché questo percorso?");
    await expect(page.getByTestId("plan-total")).toContainText("Totale stimato");
    await expect(page.getByTestId("plan-saving")).toHaveText("0,20 € risparmiati");
    await expect(page.getByTestId("plan-missing")).toContainText("Non trovato nei negozi");
    await expect(page.getByRole("link", { name: "Solo offerte" })).toHaveAttribute(
      "href",
      "/it/plan?stores=3&mode=offers-only",
    );
    await expectNoHorizontalScroll(page);
    await expectTouchTargets(page);
  });
});
