import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, expectTouchTargets } from "./helpers";

test.describe("data sources page", () => {
  test("is reached from More and says what each chain's offers are made of", async ({ page }) => {
    await page.goto("/more");
    await page.getByRole("link", { name: "Gegevensbronnen en juistheid" }).click();
    await expect(page).toHaveURL(/\/more\/sources$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Gegevensbronnen en juistheid");
    // The test database holds the seed only: every chain is demo data.
    for (const slug of ["ah", "jumbo", "vomar", "dirk"]) {
      await expect(page.getByTestId(`source-${slug}`)).toContainText("Demodata");
    }
    await expect(page.getByText("De eindprijs en beschikbaarheid", { exact: false })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectTouchTargets(page);
    await page.getByRole("link", { name: "Meer", exact: false }).first().click();
    await expect(page).toHaveURL(/\/more$/);
  });

  test("is rendered on every request, not frozen at build time", async ({ request }) => {
    // A statically built copy would keep showing the chains' state of the build day.
    const response = await request.get("/more/sources");
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(response.headers()["x-nextjs-cache"]).toBeUndefined();
  });

  test("is translated", async ({ page }) => {
    await page.goto("/it/more/sources");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fonti dati e correttezza");
    await expect(page.getByTestId("source-jumbo")).toContainText("Dati demo");
    await page.goto("/en/more/sources");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Data sources and accuracy");
  });
});
