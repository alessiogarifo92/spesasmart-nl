import { load } from "cheerio";
import type { RawOffer } from "../../adapter";
import { cleanText, sameSiteUrl } from "../text";

/**
 * Reads the offer cards out of Dirk's offers page (markup seen 2026-11-12). The page
 * states one end date for the whole week in its header; a card adds only a label
 * such as "VR, ZA & ZO actie". A product listed in two departments is kept once.
 */
export function parseDirkOffers(html: string, pageUrl: string): RawOffer[] {
  const $ = load(html);
  const current = $(".offers-header .calender-button.current").first();
  const weekEnd = cleanText(`${current.find(".day").text()} ${current.find(".date").text()}`) || null;

  const offers: RawOffer[] = [];
  const seen = new Set<string>();
  $("article[data-product-id]").each((_, element) => {
    const node = $(element);
    const productId = cleanText(node.attr("data-product-id"));
    const title = cleanText(node.find("p.title").first().text());
    if (productId === "" || title === "" || seen.has(productId)) return;
    seen.add(productId);

    const large = node.find(".price .price-large").first();
    offers.push({
      sourceUrl: sameSiteUrl(node.find("a[href]").first().attr("href"), pageUrl, "dirk.nl", pageUrl),
      payload: {
        productId,
        title,
        subtitle: cleanText(node.find("span.subtitle").first().text()) || null,
        label: cleanText(node.find(".price-label .description").first().text()) || null,
        regularPrice: cleanText(node.find(".regular-price span").first().text()) || null,
        priceLarge: cleanText(large.text()) || null,
        priceSmall: cleanText(node.find(".price .price-small").first().text()) || null,
        // With this class the large figure is whole euros; without it, cents.
        hasEuros: large.hasClass("hasEuros"),
        category: cleanText(node.closest("section.department").children("h2").first().text()) || null,
        weekEnd,
      },
    });
  });
  return offers;
}
