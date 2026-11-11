import { expect, type Page } from "@playwright/test";

export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Every link, button and field a finger can hit must be at least 44 px in both directions. */
export async function expectTouchTargets(page: Page) {
  const small = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("a[href], button, input, select, [role=radio]")]
      .filter((el) => !el.closest(".sr-only") && el.getClientRects().length > 0)
      // A checkbox or radio inside a label is tapped through the whole label.
      .map((el) => ({ el, box: (el.matches("input[type=checkbox], input[type=radio]") ? el.closest("label") ?? el : el).getBoundingClientRect() }))
      .filter(({ box }) => box.width < 44 || box.height < 44)
      .map(({ el, box }) => `${el.tagName} "${el.textContent?.trim()}" ${box.width}x${box.height}`),
  );
  expect(small).toEqual([]);
}
