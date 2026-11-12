import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, expectTouchTargets } from "./helpers";

// Every test starts in a fresh browser context: no cookie, so a device with no list.
const items = (page: Page) => page.getByTestId("list-item");
const item = (page: Page, name: string | RegExp) => items(page).filter({ hasText: name });

async function addText(page: Page, text: string) {
  await page.getByLabel("Voeg iets toe").fill(text);
  await page.getByRole("button", { name: "Toevoegen aan lijst" }).click();
  await expect(item(page, text)).toBeVisible();
  // The field is cleared when the save has come back; typing before that would be wiped.
  await expect(page.getByLabel("Voeg iets toe")).toHaveValue("");
}

test.describe("shopping list", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("an empty list points to search and offers, and looking at it stores nothing", async ({ page, context }) => {
    await page.goto("/list");
    await expect(page.getByRole("heading", { name: "Je lijst is leeg" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Zoek producten" })).toHaveAttribute("href", "/search");
    await expect(page.getByRole("link", { name: "Bekijk aanbiedingen" })).toHaveAttribute("href", "/offers");
    await page.goto("/search?q=melk");
    await page.goto("/offers");
    expect((await context.cookies()).map((cookie) => cookie.name)).not.toContain("ss_device");
  });

  test("a product added from search is on the list and survives a reload", async ({ page, context }) => {
    await page.goto("/search?q=spagetti");
    const dirk = page.getByTestId("product-card").filter({ hasText: "Dirk" });
    const name = (await dirk.getByRole("heading").innerText()).trim();
    await dirk.getByRole("button", { name: `Zet ${name} op je lijst` }).click();
    await expect(dirk.getByTestId("on-list")).toHaveText("Op je lijst · 1×");
    // Adding the same product again raises the quantity instead of writing a second line.
    await dirk.getByRole("button", { name: `Zet ${name} op je lijst` }).click();
    await expect(dirk.getByTestId("on-list")).toHaveText("Op je lijst · 2×");
    await expect(page.getByTestId("on-list")).toHaveCount(1);

    await page.getByRole("navigation", { name: "Hoofdnavigatie" }).getByRole("link", { name: "Lijst" }).click();
    await expect(page).toHaveURL(/\/list$/);
    await expect(items(page)).toHaveCount(1);
    await expect(item(page, name).getByTestId("item-quantity")).toHaveText("2");
    await expect(page.getByText("Boodschappen · 1 product")).toBeVisible();

    await page.reload();
    await expect(item(page, name).getByTestId("item-quantity")).toHaveText("2");

    // The list hangs on one cookie that scripts cannot read.
    const cookie = (await context.cookies()).find((one) => one.name === "ss_device");
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });
    expect(cookie?.value).toMatch(/^[0-9a-f-]{36}$/);
    expect(await page.evaluate(() => document.cookie)).not.toContain("ss_device");
  });

  test("a product added from the offers is on the list", async ({ page }) => {
    await page.goto("/offers");
    const offer = page.getByTestId("offer-card").first();
    const name = (await offer.getByRole("heading").innerText()).replace(/\s*Bio$/, "").trim();
    await offer.getByRole("button", { name: /^Zet .* op je lijst$/ }).click();
    await expect(offer.getByTestId("on-list")).toHaveText("Op je lijst · 1×");
    await page.goto("/list");
    await expect(items(page)).toHaveCount(1);
    await expect(items(page).first()).toContainText(name.split(" ")[0]!);
    // Back on the offers, the mark is still there.
    await page.goto("/offers");
    await expect(page.getByTestId("offer-card").first().getByTestId("on-list")).toBeVisible();
  });

  test("free text, quantity, tick, pin to a chain and remove all persist", async ({ page }) => {
    await page.goto("/list");
    await addText(page, "tahin");
    await addText(page, "bananen");
    await expect(page.getByLabel("Voeg iets toe")).toHaveValue("");
    await expect(items(page)).toHaveCount(2);
    await expect(items(page).first()).toContainText("tahin");

    const tahin = item(page, "tahin");
    await expect(tahin.getByRole("button", { name: "Eén minder: tahin" })).toBeDisabled();
    await tahin.getByRole("button", { name: "Eén meer: tahin" }).click();
    await expect(tahin.getByTestId("item-quantity")).toHaveText("2");
    await tahin.getByRole("button", { name: "Eén meer: tahin" }).click();
    await expect(tahin.getByTestId("item-quantity")).toHaveText("3");
    await tahin.getByRole("button", { name: "Eén minder: tahin" }).click();
    await expect(tahin.getByTestId("item-quantity")).toHaveText("2");

    await tahin.getByRole("button", { name: "Afgevinkt: tahin" }).click();
    await expect(tahin.getByRole("button", { name: "Afgevinkt: tahin" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Boodschappen · 2 producten · 1 afgevinkt")).toBeVisible();

    const bananen = item(page, "bananen");
    await bananen.getByText("Elke winkel").first().click();
    await bananen.getByRole("group", { name: "Waar wil je dit kopen?" }).getByRole("button", { name: "Jumbo" }).click();
    await expect(bananen.getByText("Altijd bij Jumbo")).toBeVisible();

    await page.reload();
    await expect(item(page, "tahin").getByTestId("item-quantity")).toHaveText("2");
    await expect(item(page, "tahin").getByRole("button", { name: "Afgevinkt: tahin" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(item(page, "bananen").getByText("Altijd bij Jumbo")).toBeVisible();

    await page.getByRole("button", { name: "Vink alles weer uit" }).click();
    await expect(item(page, "tahin").getByRole("button", { name: "Afgevinkt: tahin" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(page.getByRole("button", { name: "Vink alles weer uit" })).toHaveCount(0);

    await item(page, "bananen").getByText("Altijd bij Jumbo").click();
    await item(page, "bananen").getByRole("button", { name: "Verwijder bananen van je lijst" }).click();
    await expect(items(page)).toHaveCount(1);
    await page.reload();
    await expect(items(page)).toHaveCount(1);
    await expect(items(page).first()).toContainText("tahin");
  });

  test("several lists can be kept, opened, renamed and deleted", async ({ page }) => {
    await page.goto("/list");
    await addText(page, "melk");
    await page.getByTestId("list-manager").getByText("Je lijst").click();
    await page.getByLabel("Nieuwe lijst").fill("Verjaardag");
    await page.getByRole("button", { name: "Maak lijst" }).click();

    // The new list is the current one, and empty.
    await expect(page.getByText("Verjaardag · geen producten")).toBeVisible();
    await expect(items(page)).toHaveCount(0);
    await addText(page, "taart");

    // What is added from search goes to the list that is open.
    await page.goto("/search?q=spagetti");
    await page
      .getByTestId("product-card")
      .first()
      .getByRole("button", { name: /op je lijst$/ })
      .click();
    await expect(page.getByTestId("on-list")).toHaveCount(1);
    await page.goto("/list");
    await expect(page.getByText("Verjaardag · 2 producten")).toBeVisible();

    await page.getByTestId("list-manager").getByText("Je lijsten (2)").click();
    await page.getByRole("button", { name: /Boodschappen\s*1 product/ }).click();
    await expect(page.getByText("Boodschappen · 1 product")).toBeVisible();
    await expect(items(page)).toHaveCount(1);
    await expect(items(page).first()).toContainText("melk");

    await page.getByLabel("Naam van deze lijst").fill("Week 46");
    await page.getByRole("button", { name: "Bewaar" }).click();
    await expect(page.getByText("Week 46 · 1 product")).toBeVisible();
    await page.reload();
    await expect(page.getByText("Week 46 · 1 product")).toBeVisible();

    await page.getByTestId("list-manager").getByText("Je lijsten (2)").click();
    await page.getByText("Verwijder deze lijst").click();
    await page.getByRole("button", { name: "Ja, verwijder Week 46" }).click();
    await expect(page.getByText("Verjaardag · 2 producten")).toBeVisible();
    await expect(page.getByTestId("list-manager").getByText("Je lijst", { exact: true })).toBeVisible();
  });

  test("another device does not see the list", async ({ page, browser }) => {
    await page.goto("/list");
    await addText(page, "geheim ingrediënt");
    const other = await browser.newContext({ locale: "nl-NL" });
    const otherPage = await other.newPage();
    await otherPage.goto("/list");
    await expect(otherPage.getByRole("heading", { name: "Je lijst is leeg" })).toBeVisible();
    await expect(otherPage.getByText("geheim ingrediënt")).toHaveCount(0);
    await other.close();
  });

  test("delete my data removes the lists and the cookie", async ({ page, context }) => {
    await page.goto("/more");
    await expect(page.getByText("Wis mijn gegevens")).toHaveCount(0);
    await page.goto("/list");
    await addText(page, "tahin");
    await page.goto("/more");
    await expect(page.getByText("willekeurig nummer in een cookie")).toBeVisible();
    await page.getByText("Wis mijn gegevens").click();
    await page.getByRole("button", { name: "Ja, wis alles" }).click();
    await expect(page.getByText("Wis mijn gegevens")).toHaveCount(0);
    expect((await context.cookies()).map((cookie) => cookie.name)).not.toContain("ss_device");
    await page.goto("/list");
    await expect(page.getByRole("heading", { name: "Je lijst is leeg" })).toBeVisible();
  });

  test("the first list is named in the language of the app", async ({ page }) => {
    await page.goto("/it/list");
    await page.getByLabel("Aggiungi qualcosa").fill("tahina");
    await page.getByRole("button", { name: "Aggiungi alla lista" }).click();
    await expect(page.getByText("Spesa · 1 prodotto")).toBeVisible();
    await expect(page.getByText("Qualsiasi negozio").first()).toBeVisible();
  });

  test("fits 390 px with finger-sized targets, also with a long name and the options open", async ({ page }) => {
    await page.goto("/list");
    await addText(page, "Biologische volkoren speltspaghetti van de boerderij om de hoek extra lang 500 g");
    await addText(page, "melk");
    await item(page, "melk").getByText("Elke winkel").first().click();
    await page.getByTestId("list-manager").getByText("Je lijst").click();
    await expectNoHorizontalScroll(page);
    await expectTouchTargets(page);
    await page.goto("/search?q=melk");
    await expectNoHorizontalScroll(page);
    for (const button of await page.getByRole("button", { name: /op je lijst$/ }).all()) {
      const box = await button.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.width).toBeGreaterThanOrEqual(44);
    }
  });
});
