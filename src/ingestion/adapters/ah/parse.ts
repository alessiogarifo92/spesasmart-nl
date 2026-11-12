import { load } from "cheerio";
import type { RawOffer } from "../../adapter";
import { cleanText, sameSiteUrl } from "../text";

/**
 * Reads the Bonus cards out of Albert Heijn's Bonus page (markup seen 2026-11-12).
 * Class names on that page are generated and change with every release, so cards
 * and fields are found through `data-testid` and `aria-label` only.
 *
 * Two kinds of card: one product ("AH Spruitjes", with prices and a size) and a
 * group ("Alle Conimex*", usually a mechanic only). The Bonus period is stated
 * once, at the top of the page. An offer shown twice is kept once.
 */
export function parseAhBonus(html: string, pageUrl: string): RawOffer[] {
  const $ = load(html);
  const period = cleanText($('[data-testid="period-toggle-link"][aria-current="page"] time').first().text()) || null;

  const offers: RawOffer[] = [];
  const seen = new Set<string>();
  const cards = '[data-testid="product-card-vertical-container"], [data-testid="segment-card-container"]';
  $(cards).each((_, element) => {
    const node = $(element);
    const isProduct = node.attr("data-testid") === "product-card-vertical-container";
    const link = node.find("a[href]").first();
    const sourceUrl = sameSiteUrl(link.attr("href"), pageUrl, "ah.nl", pageUrl);
    const path = sourceUrl === pageUrl ? "" : new URL(sourceUrl).pathname;
    const id = isProduct ? /\/(wi\d+)(?:\/|$)/.exec(path)?.[1] : /^\/bonus\/groep\/([\w-]+)$/.exec(path)?.[1];

    // Plain paragraphs are the title and, on group cards, a note under it.
    const texts = node
      .find("p")
      .not("[data-testid]")
      .map((__, p) => cleanText($(p).text()))
      .get()
      .filter((text) => text !== "");
    const title = texts[0] ?? "";
    if (!id || title === "" || seen.has(id)) return;
    seen.add(id);

    const labels = node
      .find('[aria-label][class*="promotionLabel"]')
      .map((__, label) => cleanText($(label).attr("aria-label")))
      .get()
      .filter((text) => text !== "");
    const text = (testId: string) => cleanText(node.find(`[data-testid="${testId}"]`).first().text()) || null;
    offers.push({
      sourceUrl,
      payload: {
        id,
        card: isProduct ? "product" : "group",
        title,
        note: texts.slice(1).join(" · ") || null,
        labels: labels.join(" | ") || null,
        currentPrice: text("product-card-current-price"),
        originalPrice: text("product-card-original-price"),
        size: text("product-card-price-description"),
        summary: cleanText(link.attr("aria-label")) || null,
        period,
      },
    });
  });
  return offers;
}
