import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, expectTouchTargets } from "./helpers";

// The demo catalogue is seeded relative to today (prisma/seed/demo.ts), so these
// expectations hold on any day the suite runs.
const cards = (page: Page) => page.getByTestId("offer-card");
const card = (page: Page, name: string, chain: string): Locator =>
  cards(page).filter({ hasText: name }).filter({ hasText: `· ${chain}` });

test.describe("offers page", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("an offer shows price, regular price, estimate, unit price, validity, chain, source and update time", async ({ page }) => {
    await page.goto("/offers");
    const kipfilet = card(page, "Kipfilet 500 g", "Dirk");
    await expect(kipfilet).toContainText("Nog 4 dagen · Dirk");
    await expect(kipfilet).toContainText("€ 3,49");
    await expect(kipfilet).toContainText("van € 4,99");
    await expect(kipfilet).toContainText("€ 6,98 per kg");
    await expect(kipfilet).toContainText("ca. −30%");
    await expect(kipfilet).toContainText(/Geldig \S+ \d+ \S+ t\/m \S+ \d+ \S+/);
    await expect(kipfilet).toContainText("Bron: demodata");
    await expect(kipfilet).toContainText(/Bijgewerkt \d+ \S+/);
    await expect(page.getByText("Demodata", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("De eindprijs en beschikbaarheid worden bevestigd door de winkel")).toBeVisible();
  });

  test("a quantity deal keeps the shelf price and labels the per-item price as an estimate", async ({ page }) => {
    await page.goto("/offers");
    const yoghurt = card(page, "Griekse yoghurt", "Albert Heijn");
    await expect(yoghurt).toContainText("1+1 gratis");
    await expect(yoghurt).toContainText("€ 2,19");
    await expect(yoghurt).toContainText("bij 2 st.: ca. € 1,10 p.st.");
    await expect(yoghurt).toContainText("ca. −50%");

    const wasmiddel = card(page, "wasmiddel", "Jumbo");
    await expect(wasmiddel).toContainText("2 voor € 11,00");
    await expect(wasmiddel).toContainText("bij 2 st.: ca. € 5,50 p.st.");
  });

  test("an offer with unknown validity is labelled to be verified", async ({ page }) => {
    await page.goto("/offers");
    const section = page.getByRole("list", { name: "Geldigheid onbekend" });
    const eieren = section.getByTestId("offer-card");
    await expect(eieren).toHaveCount(1);
    await expect(eieren).toContainText("Te controleren");
    await expect(eieren).toContainText("Geldigheid niet bekend: controleer bij de winkel");
    await expect(eieren).toHaveAttribute("data-state", "unknown-validity");
  });

  test("the daily deal is marked and expired offers are not listed", async ({ page }) => {
    await page.goto("/offers");
    await expect(card(page, "Bananen 1 kg", "Vomar")).toContainText("Verloopt vandaag · Vomar · Dagaanbieding");
    await expect(cards(page).filter({ hasText: "Elstar" })).toHaveCount(0);
    await expect(page.locator('[data-state="expired"]')).toHaveCount(0);
  });

  test("filtering by chain keeps only that chain and can be undone", async ({ page }) => {
    await page.goto("/offers");
    const all = await cards(page).count();
    await page.getByRole("group", { name: "Winkels" }).getByRole("link", { name: "Dirk" }).click();
    await expect(page).toHaveURL(/\/offers\?retailer=dirk$/);
    const shown = await cards(page).count();
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(all);
    await expect(cards(page).filter({ hasText: "· Dirk" })).toHaveCount(shown);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    await page.getByRole("group", { name: "Winkels" }).getByRole("link", { name: "Jumbo" }).click();
    await expect(page).toHaveURL(/retailer=dirk&retailer=jumbo$/);
    expect(await cards(page).count()).toBeGreaterThan(shown);

    await page.getByRole("link", { name: "Wis filters" }).click();
    await expect(page).toHaveURL(/\/offers$/);
    await expect(cards(page)).toHaveCount(all);
  });

  test("period chips show what ends soon or has not started", async ({ page }) => {
    await page.goto("/offers");
    const period = page.getByRole("group", { name: "Periode" });

    await period.getByRole("link", { name: "Binnenkort" }).click();
    await expect(page).toHaveURL(/when=upcoming/);
    const upcoming = await cards(page).count();
    expect(upcoming).toBeGreaterThan(0);
    await expect(page.locator('[data-testid="offer-card"][data-state="upcoming"]')).toHaveCount(upcoming);
    await expect(cards(page).first()).toContainText(/Vanaf \S+ \d+ \S+/);

    await period.getByRole("link", { name: "Nog 1 dag" }).click();
    await expect(page).toHaveURL(/within=1$/);
    await expect(card(page, "Bananen 1 kg", "Vomar")).toBeVisible();
    await expect(card(page, "Trostomaten", "Albert Heijn")).toContainText("Nog 1 dag");
    await expect(card(page, "Kipfilet 500 g", "Dirk")).toHaveCount(0);
    await expect(page.locator('[data-state="upcoming"], [data-state="unknown-validity"]')).toHaveCount(0);
  });

  test("category, brand and organic filters apply through the form", async ({ page }) => {
    await page.goto("/offers");
    await page.getByText("Meer filters").click();
    await page.getByLabel("Alleen biologisch").check();
    await page.getByRole("button", { name: "Toon aanbiedingen" }).click();
    await expect(page).toHaveURL(/organic=1/);
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page)).toContainText("Biologische havermout");
    await expect(cards(page)).toContainText("Bio");

    await page.goto("/offers");
    await page.getByText("Meer filters").click();
    await page.getByLabel("Categorie").selectOption({ label: "Zuivel & eieren" });
    await page.getByRole("button", { name: "Toon aanbiedingen" }).click();
    await expect(page).toHaveURL(/category=zuivel-eieren/);
    await expect(card(page, "Griekse yoghurt", "Albert Heijn")).toBeVisible();
    await expect(card(page, "Kipfilet 500 g", "Dirk")).toHaveCount(0);

    await page.goto("/offers");
    await page.getByText("Meer filters").click();
    await page.getByLabel("Merk").selectOption("Molenhof");
    await page.getByRole("button", { name: "Toon aanbiedingen" }).click();
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page)).toContainText("Molenhof");
  });

  test("filters that match nothing give an empty state with a way back", async ({ page }) => {
    await page.goto("/offers?retailer=vomar&when=upcoming");
    await expect(page.getByRole("heading", { name: "Geen aanbiedingen met deze filters" })).toBeVisible();
    await expect(cards(page)).toHaveCount(0);
    await page.getByRole("main").getByRole("link", { name: "Wis filters" }).first().click();
    await expect(page).toHaveURL(/\/offers$/);
    expect(await cards(page).count()).toBeGreaterThan(0);
  });

  test("unrecognised filter values are ignored", async ({ page }) => {
    const response = await page.goto("/offers?retailer=%27%3B--&within=99&category=NOPE");
    expect(response?.status()).toBe(200);
    expect(await cards(page).count()).toBeGreaterThan(0);
  });

  test("fits 390 px with finger-sized controls, also with the filter form open", async ({ page }) => {
    await page.goto("/offers?organic=1");
    await expectNoHorizontalScroll(page);
    await expectTouchTargets(page);
    await page.goto("/offers");
    await expectNoHorizontalScroll(page);
    await expectTouchTargets(page);
  });

  test("is translated: Italian labels and estimates", async ({ page }) => {
    await page.goto("/it/offers");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Offerte");
    const kipfilet = card(page, "Kipfilet 500 g", "Dirk");
    await expect(kipfilet).toContainText("Ancora 4 giorni");
    await expect(kipfilet).toContainText("circa −30%");
    await expect(kipfilet).toContainText("al kg");
    await expect(page.getByText("Dati demo", { exact: true }).first()).toBeVisible();
  });
});

test.describe("home", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("opens on the plan, then what ends today, the week's best and what is coming", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Nog geen plan voor deze week" })).toBeVisible();

    const today = page.getByRole("list", { name: "Verloopt vandaag" });
    await expect(today.getByTestId("offer-card")).toContainText("Bananen 1 kg");

    const week = page.getByRole("list", { name: "Let op deze week" }).getByTestId("offer-card");
    expect(await week.count()).toBeGreaterThan(1);
    // Biggest estimated discount first: the 1+1 offer (about 50%).
    await expect(week.first()).toContainText("Griekse yoghurt");
    await expect(week.filter({ hasText: "Te controleren" })).toHaveCount(0);

    const upcoming = page.getByRole("list", { name: "Binnenkort" }).getByTestId("offer-card");
    await expect(upcoming.first()).toHaveAttribute("data-state", "upcoming");

    await expect(page.getByText("Demodata", { exact: true }).first()).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectTouchTargets(page);
  });

  test("links to all offers", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Alle aanbiedingen" }).click();
    await expect(page).toHaveURL(/\/offers$/);
  });
});
