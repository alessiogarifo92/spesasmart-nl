import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, expectTouchTargets } from "./helpers";

const routes = ["/", "/offers", "/list", "/more", "/search"];

test.describe("app shell at 390 px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const route of routes) {
    test(`${route} fits the screen and has finger-sized controls`, async ({ page }) => {
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expectTouchTargets(page);
    });
  }

  test("the bottom navigation reaches every section and marks the current one", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Hoofdnavigatie" });
    await expect(nav.getByRole("link", { name: "Plan" })).toHaveAttribute("aria-current", "page");

    await nav.getByRole("link", { name: "Aanbiedingen" }).click();
    await expect(page).toHaveURL(/\/offers$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Aanbiedingen");
    await expect(nav.getByRole("link", { name: "Aanbiedingen" })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Plan" })).not.toHaveAttribute("aria-current", "page");

    await nav.getByRole("link", { name: "Lijst" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Lijst");
    await nav.getByRole("link", { name: "Meer" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Meer");
  });

  test("the content is never hidden behind the bottom navigation", async ({ page }) => {
    await page.goto("/more");
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const lastText = page.getByText("Je lijst hoort bij dit apparaat", { exact: false });
    const nav = page.getByRole("navigation", { name: "Hoofdnavigatie" });
    const [textBox, navBox] = [await lastText.boundingBox(), await nav.boundingBox()];
    expect(textBox!.y + textBox!.height).toBeLessThanOrEqual(navBox!.y);
  });

  test("the search field submits to the search page", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Zoek product, merk of EAN").fill("melk");
    await page.getByRole("button", { name: "Zoeken" }).click();
    await expect(page).toHaveURL(/\/search\?q=melk$/);
  });

  test("the language switcher keeps the page and changes the language", async ({ page }) => {
    await page.goto("/more");
    await page.getByRole("link", { name: "Italiano" }).click();
    await expect(page).toHaveURL(/\/it\/more$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "it");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Altro");
    await expect(page.getByRole("link", { name: "Italiano" })).toHaveAttribute("aria-current", "true");

    await page.getByRole("link", { name: "English" }).click();
    await expect(page).toHaveURL(/\/en\/more$/);
    await page.getByRole("link", { name: "Nederlands" }).click();
    await expect(page).toHaveURL(/\/more$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "nl");
  });
});

test.describe("themes", () => {
  const background = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  test.describe("on a dark device", () => {
    test.use({ colorScheme: "dark" });
    test("is dark by default; a chosen light theme survives a reload", async ({ page }) => {
      await page.goto("/more");
      expect(await background(page)).toBe("rgb(15, 20, 18)");
      await expect(page.getByRole("radio", { name: "Systeem" })).toBeChecked();

      await page.getByRole("radio", { name: "Licht" }).click();
      expect(await background(page)).toBe("rgb(243, 247, 244)");
      await page.reload();
      expect(await background(page)).toBe("rgb(243, 247, 244)");
      await expect(page.getByRole("radio", { name: "Licht" })).toBeChecked();

      await page.getByRole("radio", { name: "Systeem" }).click();
      expect(await background(page)).toBe("rgb(15, 20, 18)");
    });
  });

  test.describe("on a light device", () => {
    test.use({ colorScheme: "light" });
    test("follows the device; a chosen dark theme wins", async ({ page }) => {
      await page.goto("/more");
      expect(await background(page)).toBe("rgb(243, 247, 244)");
      await page.getByRole("radio", { name: "Donker" }).click();
      expect(await background(page)).toBe("rgb(15, 20, 18)");
      await page.reload();
      expect(await background(page)).toBe("rgb(15, 20, 18)");
    });
  });
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  test("transitions are switched off", async ({ page }) => {
    await page.goto("/");
    const duration = await page
      .getByRole("link", { name: "Maak je lijst" })
      .evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(parseFloat(duration)).toBeLessThan(0.001);
  });
});

test.describe("installable app", () => {
  test("the manifest names the app, its scope and icons that exist", async ({ page, request }) => {
    await page.goto("/");
    const href = await page.locator('link[rel="manifest"]').getAttribute("href");
    const manifest = await (await request.get(href!)).json();
    expect(manifest).toMatchObject({ id: "/", start_url: "/", scope: "/", display: "standalone", short_name: "SpesaSmart" });
    expect(manifest.icons.map((icon: { purpose: string }) => icon.purpose).sort()).toEqual(["any", "any", "maskable"]);
    for (const icon of manifest.icons) {
      const response = await request.get(icon.src);
      expect(response.status(), icon.src).toBe(200);
      expect(response.headers()["content-type"]).toBe("image/png");
    }
  });

  test("iOS gets a home-screen icon and safe-area handling", async ({ page, request }) => {
    await page.goto("/");
    const touchIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
    expect((await request.get(touchIcon!)).status()).toBe(200);
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", /viewport-fit=cover/);
  });

  test("Chrome reports no installability errors", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => navigator.serviceWorker.ready);
    const session = await page.context().newCDPSession(page);
    const { installabilityErrors } = await session.send("Page.getInstallabilityErrors");
    expect(installabilityErrors).toEqual([]);
  });

  test("without a connection, navigation shows the offline page in the page's language", async ({ page, context }) => {
    await page.goto("/it");
    await page.evaluate(() => navigator.serviceWorker.ready);
    // The worker takes control of this page once it has claimed its clients.
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await context.setOffline(true);
    await page.goto("/it/offers").catch(() => {});
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Nessuna connessione");
    await context.setOffline(false);
  });

  test("install instructions name both platforms", async ({ page }) => {
    await page.goto("/more");
    await expect(page.getByText(/^Android:/)).toBeVisible();
    await expect(page.getByText(/^iPhone of iPad:/)).toBeVisible();
  });
});
