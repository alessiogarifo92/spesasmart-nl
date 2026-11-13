import { expect, test } from "@playwright/test";

test("home renders in Dutch by default", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "nl");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Jouw week");
});

test("home renders in Italian under /it", async ({ page }) => {
  await page.goto("/it");
  await expect(page.locator("html")).toHaveAttribute("lang", "it");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("La tua settimana");
});

test.describe("with an English browser", () => {
  test.use({ locale: "en-GB" });

  test("first visit follows the browser language", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/en$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});

test("every response carries the security headers and does not advertise the framework", async ({ request }) => {
  for (const path of ["/", "/offers", "/manifest.webmanifest"]) {
    const headers = (await request.get(path)).headers();
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["content-security-policy"]).toBe("frame-ancestors 'none'");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["x-powered-by"]).toBeUndefined();
  }
});
