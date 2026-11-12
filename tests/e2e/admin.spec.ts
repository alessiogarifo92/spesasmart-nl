import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, expectTouchTargets } from "./helpers";

// The token the test server is started with (playwright.config.ts).
const TOKEN = "e2e-admin-token-0123456789-abcdefghijklm";

async function signIn(page: Page, path = "/admin") {
  await page.goto(path);
  await page.getByLabel("Beheertoken").fill(TOKEN);
  await page.getByRole("button", { name: "Aanmelden" }).click();
  await expect(
    page.getByRole("button", { name: "Afmelden" }).or(page.getByRole("link", { name: "Terug naar beheer" })),
  ).toBeVisible();
}

test.describe("admin panel", () => {
  test("shows only the sign-in form without a session, on both pages", async ({ page, request }) => {
    for (const path of ["/admin", "/admin/matches", "/en/admin"]) {
      await page.goto(path);
      await expect(page.locator("input[name=token]")).toBeVisible();
      await expect(page.getByTestId("admin-chain")).toHaveCount(0);
      await expect(page.getByTestId("review-item")).toHaveCount(0);
    }
    // The raw responses, page and React payload, carry no admin data either.
    for (const headers of [{}, { RSC: "1" }] as Record<string, string>[]) {
      const body = await (await request.get("/admin", { headers })).text();
      expect(body).not.toContain("admin-chain");
      expect(body).not.toContain("switch-jumbo");
      expect(body).not.toContain("mock:");
    }
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expectNoHorizontalScroll(page);
    await expectTouchTargets(page);
  });

  test("refuses a wrong token and a forged cookie", async ({ page, context, baseURL }) => {
    await page.goto("/admin");
    await page.getByLabel("Beheertoken").fill("not-the-admin-token");
    await page.getByRole("button", { name: "Aanmelden" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Dit token klopt niet." })).toBeVisible();
    await expect(page.getByTestId("admin-chain")).toHaveCount(0);

    await context.addCookies([{ name: "ss_admin", value: `${Date.now() + 60_000}.${"a".repeat(64)}`, url: baseURL! }]);
    await page.goto("/admin");
    await expect(page.locator("input[name=token]")).toBeVisible();
    await expect(page.getByTestId("admin-chain")).toHaveCount(0);
  });

  test("signs in, shows chains, runs and categories, and signs out", async ({ page, context }) => {
    await signIn(page);
    await expect(page.getByRole("heading", { level: 1, name: "Beheer" })).toBeVisible();
    await expect(page.getByTestId("admin-chain")).toHaveCount(4);
    await expect(page.getByTestId("admin-chain").filter({ hasText: "Albert Heijn" })).toBeVisible();
    await expect(page.getByTestId("admin-run").first()).toBeVisible();
    await expect(page.getByTestId("admin-category").first()).toBeVisible();

    const cookie = (await context.cookies()).find((entry) => entry.name === "ss_admin");
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Strict" });
    expect(cookie!.value).not.toContain(TOKEN);

    await expectNoHorizontalScroll(page);
    await expectTouchTargets(page);

    await page.getByRole("button", { name: "Afmelden" }).click();
    await expect(page.locator("input[name=token]")).toBeVisible();
    await expect(page.getByTestId("admin-chain")).toHaveCount(0);
  });

  test("switches a chain's real adapter on and off again", async ({ page }) => {
    await signIn(page);
    const toggle = page.getByTestId("switch-jumbo-adapterEnabled");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    // The environment of the test server lists no adapter: the panel says so.
    await expect(page.getByTestId("admin-chain").filter({ hasText: "Jumbo" })).toContainText(
      "INGESTION_ENABLED_ADAPTERS",
    );
    await page.reload();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  test("hiding a chain removes it from the offers, and showing it brings it back", async ({ page }) => {
    await signIn(page);
    const toggle = page.getByTestId("switch-vomar-active");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await page.goto("/offers");
    await expect(page.getByRole("main")).not.toContainText("Vomar");
    await page.goto("/admin");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await page.goto("/offers");
    await expect(page.getByRole("main")).toContainText("Vomar");
  });

  test("lists the links that wait for a decision, in Italian too", async ({ page }) => {
    await signIn(page, "/admin/matches");
    const items = page.getByTestId("review-item");
    await expect(items.first()).toBeVisible();
    await expect(items.first().getByRole("button")).toHaveText([
      "Zelfde product",
      "Zeer vergelijkbaar",
      "Ander formaat",
      "Geen koppeling",
    ]);
    await expectNoHorizontalScroll(page);
    await expectTouchTargets(page);

    await page.goto("/it/admin/matches");
    await expect(page.getByRole("heading", { level: 1, name: "Collegamenti" })).toBeVisible();
    await expect(items.first().getByRole("button", { name: "Nessun collegamento" })).toBeVisible();
    await page.goto("/it/admin");
    await expect(page.getByRole("link", { name: "Apri la coda" })).toBeVisible();
  });
});
