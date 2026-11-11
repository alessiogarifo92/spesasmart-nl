import { expect, test } from "@playwright/test";

test("home renders in Dutch by default", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "nl");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("SpesaSmart NL");
});

test("home renders in Italian under /it", async ({ page }) => {
  await page.goto("/it");
  await expect(page.locator("html")).toHaveAttribute("lang", "it");
  await expect(page.getByText("Tutte le offerte dei supermercati in un solo posto.")).toBeVisible();
});

test.describe("with an English browser", () => {
  test.use({ locale: "en-GB" });

  test("first visit follows the browser language", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/en$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});
