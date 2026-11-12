import {
  fail,
  isIsoDate,
  ok,
  parsePriceCents,
  parsePromotion,
  parseValidity,
  type IsoDate,
  type Promotion,
  type Validity,
} from "@/domain/pricing";
import type { AdapterContext, NormalizedProduct, RawOffer, RetailerAdapter } from "../../adapter";
import { field } from "../text";
import { parseJumboOffers } from "./parse";

/** The one page this adapter reads. robots.txt (2026-11-12) does not restrict /aanbiedingen. */
export const JUMBO_OFFERS_URL = "https://www.jumbo.com/aanbiedingen/nu";

/** "2026-11-11T00:01:00+01:00" → "2026-11-11": the offset is Dutch time, so the date part is the Dutch day. */
function isoDay(value: string | null): IsoDate | null {
  const day = value?.slice(0, 10) ?? "";
  return /^\d{4}-\d{2}-\d{2}T/.test(value ?? "") && isIsoDate(day) ? day : null;
}

/** The card's own dates when it has them, else its validity line ("wo 4 nov t/m di 5 jan"). */
function readValidity(payload: RawOffer["payload"], today: IsoDate): Validity | null {
  const start = isoDay(field(payload, "start"));
  const end = isoDay(field(payload, "end"));
  if (start !== null && end !== null && start <= end) return { start, end, approximate: false };
  const text = field(payload, "validityText");
  if (text === null) return null;
  const parsed = parseValidity(text, { today });
  return parsed.ok ? parsed.value : null;
}

/**
 * Jumbo writes a plain offer price as "voor 0,99". Everything else goes through the
 * shared mechanic parser; what that does not recognise ("1,59 per 100 gram",
 * "1,00 korting") is kept as text and no price is derived from it.
 */
function readMechanic(mechanic: string | null): { promotion: Promotion; currentPriceCents: number | null } {
  if (mechanic === null) return { promotion: { type: "UNKNOWN", text: "" }, currentPriceCents: null };
  const plain = /^voor (\d{1,3},\d{2})$/i.exec(mechanic);
  if (plain) {
    const price = parsePriceCents(plain[1]!);
    if (price.ok) return { promotion: { type: "PRICE_CUT" }, currentPriceCents: price.value };
  }
  return { promotion: parsePromotion(mechanic), currentPriceCents: null };
}

function normalizeProduct(raw: RawOffer) {
  const id = field(raw.payload, "id");
  const title = field(raw.payload, "title");
  if (id === null) return fail("id-missing");
  if (title === null) return fail("title-missing");
  // An offer here covers a range ("Alle Jumbo wokgroenten"), not one package: the page
  // states no brand, size or barcode, so none is recorded.
  const product: NormalizedProduct = {
    externalId: `offer:${id}`,
    name: title,
    brand: null,
    ean: null,
    quantity: null,
    categorySlug: null,
    isOrganic: false,
    attributes: {},
  };
  return ok(product);
}

/**
 * Jumbo's public offers page. It gives a title, a mechanic and dates per offer, and
 * never a regular price; offers without an explicit price are stored with their
 * mechanic only. Next week's offers are not on the page, so there are no upcoming ones.
 */
export const jumboAdapter: RetailerAdapter = {
  id: "jumbo",
  retailerSlug: "jumbo",
  isMock: false,
  maxRunsPerDay: 1,
  async fetchOffers(ctx: AdapterContext) {
    const response = await ctx.http.get(JUMBO_OFFERS_URL);
    const offers = parseJumboOffers(response.text, response.url);
    // A page that still answers but lists nothing means the markup changed: say so.
    if (offers.length === 0) throw new Error("no offer cards found on the page; the markup may have changed");
    return offers;
  },
  fetchUpcomingOffers: async () => [],
  fetchStoreLocations: async () => [],
  normalizeProduct,
  normalizeOffer(raw, ctx) {
    const product = normalizeProduct(raw);
    if (!product.ok) return product;
    const mechanic = field(raw.payload, "mechanic");
    return ok({
      product: product.value,
      title: product.value.name,
      kind: "WEEKLY" as const,
      ...readMechanic(mechanic),
      promoDescription: mechanic,
      regularPriceCents: null,
      validity: readValidity(raw.payload, ctx.today),
      conditions: field(raw.payload, "qualifier"),
      sourceUrl: raw.sourceUrl,
      rawPayload: raw.payload,
      dedupeKey: `offer:${field(raw.payload, "id")}`,
    });
  },
};
