import { fail, ok, parsePriceCents, parseQuantity, parseValidity, type IsoDate, type Validity } from "@/domain/pricing";
import { addDays } from "@/lib/dates";
import type { AdapterContext, NormalizedProduct, RawOffer, RetailerAdapter } from "../../adapter";
import { field } from "../text";
import { parseDirkOffers } from "./parse";

/** The one page this adapter reads. robots.txt (2026-11-12) allows everything. */
export const DIRK_OFFERS_URL = "https://www.dirk.nl/aanbiedingen";

/**
 * Dirk prints a price as two figures: euros and cents ("1" + "99"), or cents alone
 * ("99") when it is under one euro. Anything else is not read as a price.
 */
export function readDirkPrice(large: string | null, small: string | null, hasEuros: boolean): number | null {
  if (large === null || !/^\d{1,3}$/.test(large)) return null;
  if (hasEuros) return small !== null && /^\d{2}$/.test(small) ? Number(large) * 100 + Number(small) : null;
  const cents = Number(large);
  return small === null && large.length <= 2 && cents > 0 ? cents : null;
}

const WEEKEND_LABEL = /^vr,? za (?:&|en) zo\b/i;
const weekday = (date: IsoDate) => new Date(`${date}T00:00:00Z`).getUTCDay();

/**
 * The header's "tot en met di 17 november" ends every offer on the page; the page
 * gives no start date. A "VR, ZA & ZO actie" runs on the Friday, Saturday and
 * Sunday of that same week.
 */
function readValidity(payload: RawOffer["payload"], today: IsoDate): Validity | null {
  const weekEnd = field(payload, "weekEnd");
  if (weekEnd === null) return null;
  const parsed = parseValidity(`t/m ${weekEnd}`, { today });
  if (!parsed.ok) return null;
  const end = parsed.value.end;
  if (!WEEKEND_LABEL.test(field(payload, "label") ?? "")) return { start: null, end, approximate: false };
  const sunday = addDays(end, -weekday(end));
  return { start: addDays(sunday, -2), end: sunday, approximate: false };
}

function normalizeProduct(raw: RawOffer) {
  const productId = field(raw.payload, "productId");
  const title = field(raw.payload, "title");
  if (productId === null) return fail("id-missing");
  if (title === null) return fail("title-missing");
  // The size line is free text ("1 kg", "Zak 250 gram of schaal 500 gram."): only a plain size is taken.
  const size = parseQuantity((field(raw.payload, "subtitle") ?? "").replace(/\.? ?op ?= ?op\.?$/i, ""));
  const product: NormalizedProduct = {
    externalId: productId,
    name: title,
    // The brand is part of the title on this page, not a field of its own.
    brand: null,
    ean: null,
    quantity: size.ok ? size.value : null,
    categorySlug: null,
    isOrganic: /\bbio(?:logisch\w*)?\b/i.test(title),
    attributes: {},
  };
  return ok(product);
}

/**
 * Dirk's public offers page: per product an offer price and usually the regular
 * price, with one end date for the whole page. The page shows plain price offers
 * only. Next week's offers load on a button and are not collected.
 */
export const dirkAdapter: RetailerAdapter = {
  id: "dirk",
  retailerSlug: "dirk",
  isMock: false,
  maxRunsPerDay: 1,
  async fetchOffers(ctx: AdapterContext) {
    const response = await ctx.http.get(DIRK_OFFERS_URL);
    const offers = parseDirkOffers(response.text, response.url);
    if (offers.length === 0)
      throw new Error("no offer cards with a title found on the page; the markup may have changed");
    return offers;
  },
  fetchUpcomingOffers: async () => [],
  fetchStoreLocations: async () => [],
  normalizeProduct,
  normalizeOffer(raw, ctx) {
    const product = normalizeProduct(raw);
    if (!product.ok) return product;
    const { payload } = raw;
    const regular = parsePriceCents(field(payload, "regularPrice") ?? "");
    const subtitle = field(payload, "subtitle");
    const validity = readValidity(payload, ctx.today);
    return ok({
      product: product.value,
      title: product.value.name,
      kind: "WEEKLY" as const,
      promotion: { type: "PRICE_CUT" as const },
      promoDescription: field(payload, "label"),
      currentPriceCents: readDirkPrice(
        field(payload, "priceLarge"),
        field(payload, "priceSmall"),
        payload.hasEuros === true,
      ),
      regularPriceCents: regular.ok ? regular.value : null,
      validity,
      conditions: subtitle !== null && /op ?= ?op/i.test(subtitle) ? "OP=OP" : null,
      sourceUrl: raw.sourceUrl,
      rawPayload: payload,
      // The same product returns in later weeks: the week's end date tells the offers apart.
      dedupeKey: `product:${product.value.externalId}:${validity?.end ?? "unknown"}`,
    });
  },
};
