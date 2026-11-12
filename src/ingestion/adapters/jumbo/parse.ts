import { load } from "cheerio";
import type { RawOffer } from "../../adapter";
import { cleanText, sameSiteUrl } from "../text";

/**
 * The three kinds of offer card on Jumbo's offers page (seen 2026-11-12): the grid
 * cards per category, the large cards in the top carousel, and the store-only extras.
 */
const CARDS = [
  ['article[data-testid^="promotion-card-"]', "grid"],
  ['li[data-testid="heavy-promotion-card"]', "heavy"],
  ['article[data-testid="mass-promotion-item"]', "mass"],
] as const;

const lastSegment = (url: string) => new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";

/**
 * Reads the offer cards out of the offers page. Only text is taken: title, the
 * tag with the mechanic, the validity line and the card's own dates. A card without
 * a title or an id is skipped; an offer shown twice is kept once.
 */
export function parseJumboOffers(html: string, pageUrl: string): RawOffer[] {
  const $ = load(html);
  const offers: RawOffer[] = [];
  const seen = new Set<string>();
  for (const [selector, card] of CARDS) {
    $(selector).each((_, element) => {
      const node = $(element);
      const link = node.find("a.title-link").first();
      const title = cleanText(link.text());
      const sourceUrl = sameSiteUrl(link.attr("href"), pageUrl, "jumbo.com", pageUrl);
      const id = cleanText(node.attr("id")) || (sourceUrl === pageUrl ? "" : lastSegment(sourceUrl));
      if (title === "" || id === "" || seen.has(id)) return;
      seen.add(id);

      // A stacked tag has a qualifier ("Alleen online") above the mechanic.
      const tag = node.find('[data-testid="jum-tag"]').first();
      const lower = tag.find(".lower");
      offers.push({
        sourceUrl,
        payload: {
          id,
          card,
          title,
          mechanic: cleanText((lower.length > 0 ? lower : tag).text()) || null,
          qualifier: cleanText(tag.find(".upper").text()) || null,
          group: cleanText(node.attr("group")) || null,
          start: cleanText(node.attr("start-date")) || null,
          end: cleanText(node.attr("expiration-date")) || null,
          validityText: cleanText(node.find("p.subtitle").first().text()) || null,
        },
      });
    });
  }
  return offers;
}
