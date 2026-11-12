import {
  fail,
  ok,
  parsePriceCents,
  parsePromotion,
  parseQuantity,
  parseValidity,
  type IsoDate,
  type Promotion,
  type Validity,
} from "@/domain/pricing";
import type { AdapterContext, NormalizedProduct, RawOffer, RetailerAdapter } from "../../adapter";
import { field } from "../text";
import { parseAhBonus } from "./parse";

/**
 * The one page this adapter reads. robots.txt (2026-11-12) does not restrict /bonus;
 * it does disallow the group pages behind the cards (/bonus/groep/…?week=…), which
 * are therefore recorded as an offer's source link and never requested.
 */
export const AH_BONUS_URL = "https://www.ah.nl/bonus";

/** Offers about delivery ("gratis bezorging bij 8 euro") are not product offers. */
const DELIVERY = /bezorg/i;

const cents = (text: string | null) => {
  const price = parsePriceCents(text ?? "");
  return price.ok ? price.value : null;
};

/** "uitgelicht 1+1 gratis" → "1+1 gratis"; "voor €0.89" → "voor 0.89". */
const tidyLabel = (label: string) =>
  label
    .replace(/^uitgelicht /i, "")
    .replace(/€ ?/g, "")
    .trim();

type Pricing = { promotion: Promotion; currentPriceCents: number | null; regularPriceCents: number | null };

/**
 * A Bonus card shows up to two prices. With a struck-through price, that one is the
 * regular price and the other the Bonus price. A single price next to a quantity
 * mechanic ("2 voor 1.99", "1+1 gratis") is the regular price of one item. A single
 * price next to a label this adapter does not understand is not interpreted at all.
 */
function readPricing(payload: RawOffer["payload"]): Pricing {
  const labels = (field(payload, "labels") ?? "").split(" | ").filter(Boolean).map(tidyLabel);
  const shown = cents(field(payload, "currentPrice"));
  const original = cents(field(payload, "originalPrice"));
  const none: Pricing = {
    promotion: { type: "UNKNOWN", text: labels.join(" | ") },
    currentPriceCents: null,
    regularPriceCents: null,
  };
  // Two labels are tiers ("2 stuks 35%" and "1 stuk 25%"): kept as text.
  if (labels.length !== 1)
    return original === null ? none : { ...none, currentPriceCents: shown, regularPriceCents: original };

  const label = labels[0]!;
  const plain = /^voor (\d{1,3}\.\d{2})$/i.exec(label);
  if (plain) {
    return { promotion: { type: "PRICE_CUT" }, currentPriceCents: cents(plain[1]!), regularPriceCents: original };
  }
  const promotion = parsePromotion(label);
  if (original !== null) return { promotion, currentPriceCents: shown, regularPriceCents: original };
  if (promotion.type === "UNKNOWN") return { ...none, promotion };
  return { promotion, currentPriceCents: null, regularPriceCents: shown };
}

/** "8 t/m 14 november", stated once for the whole page. */
function readValidity(payload: RawOffer["payload"], today: IsoDate): Validity | null {
  const period = field(payload, "period");
  if (period === null) return null;
  const parsed = parseValidity(period, { today });
  return parsed.ok ? parsed.value : null;
}

function normalizeProduct(raw: RawOffer) {
  const { payload } = raw;
  const id = field(payload, "id");
  const title = field(payload, "title");
  if (id === null) return fail("id-missing");
  if (title === null) return fail("title-missing");
  const isGroup = payload.card !== "product";
  const size = isGroup ? null : parseQuantity(field(payload, "size") ?? "");
  const product: NormalizedProduct = {
    // A group ("Alle Conimex*") is a range of products, not one package.
    externalId: isGroup ? `groep:${id}` : id,
    name: title.replace(/^online only: /i, ""),
    brand: null,
    ean: null,
    quantity: size?.ok ? size.value : null,
    categorySlug: null,
    isOrganic: /\bbiologisch/i.test(`${title} ${field(payload, "summary") ?? ""}`),
    attributes: {},
  };
  return ok(product);
}

function readConditions(payload: RawOffer["payload"]): string | null {
  const parts = [/^online only: /i.test(field(payload, "title") ?? "") ? "Online only" : null, field(payload, "note")];
  return parts.filter(Boolean).join(" · ") || null;
}

/**
 * Albert Heijn's public Bonus page: the Bonus cards of the current week, read from
 * the server-rendered page. No app or site API is called. Next week's Bonus is not
 * on the page, so there are no upcoming offers.
 */
export const ahAdapter: RetailerAdapter = {
  id: "ah",
  retailerSlug: "ah",
  isMock: false,
  maxRunsPerDay: 1,
  async fetchOffers(ctx: AdapterContext) {
    const response = await ctx.http.get(AH_BONUS_URL);
    const offers = parseAhBonus(response.text, response.url).filter(
      (raw) => !DELIVERY.test(`${field(raw.payload, "labels") ?? ""} ${field(raw.payload, "title") ?? ""}`),
    );
    if (offers.length === 0) throw new Error("no Bonus cards found on the page; the markup may have changed");
    return offers;
  },
  fetchUpcomingOffers: async () => [],
  fetchStoreLocations: async () => [],
  normalizeProduct,
  normalizeOffer(raw, ctx) {
    const product = normalizeProduct(raw);
    if (!product.ok) return product;
    const validity = readValidity(raw.payload, ctx.today);
    return ok({
      product: product.value,
      title: product.value.name,
      kind: "WEEKLY" as const,
      ...readPricing(raw.payload),
      promoDescription: field(raw.payload, "labels"),
      validity,
      conditions: readConditions(raw.payload),
      sourceUrl: raw.sourceUrl,
      rawPayload: raw.payload,
      // Product and group ids return in later weeks: the period's end tells the offers apart.
      dedupeKey: `${product.value.externalId}:${validity?.end ?? "unknown"}`,
    });
  },
};
