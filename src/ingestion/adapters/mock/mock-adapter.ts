import {
  fail,
  normalizeEan,
  ok,
  parsePriceCents,
  parsePromotion,
  parseQuantity,
  parseValidity,
  type Promotion,
  type Validity,
} from "@/domain/pricing";
import type { AdapterContext, NormalizedProduct, RawOffer, RawValue, RetailerAdapter } from "../../adapter";
import {
  DEMO_OFFERS,
  DEMO_PRODUCTS,
  DEMO_SOURCE_URL,
  isDemoOfferListed,
  type DemoOffer,
  type DemoRetailerSlug,
} from "./catalogue";
import { formatPrice, formatSize, formatValidity } from "./format";

/** How one chain prints its offer page. */
export type MockStyle = {
  retailerSlug: DemoRetailerSlug;
  /** Prices as bare cents ("349"), as on Dirk's and Vomar's pages. */
  impliedCents: boolean;
  /** Words before the validity dates, e.g. "geldig van ". */
  validityPrefix?: string;
};

function text(payload: Record<string, RawValue>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** Turns one catalogue offer into the raw record a page scrape would produce. */
function toRaw(offer: DemoOffer, style: MockStyle, ctx: AdapterContext): RawOffer {
  const product = DEMO_PRODUCTS.find((candidate) => candidate.concept === offer.concept);
  const variant = product?.variants[style.retailerSlug];
  if (!product || !variant) {
    throw new Error(`Demo offer "${offer.key}" points at a product that ${style.retailerSlug} does not sell`);
  }
  const priceCut = offer.promoType === "PRICE_CUT";
  const validity = formatValidity({ today: ctx.today, fromOffset: offer.fromOffset, untilOffset: offer.untilOffset });
  return {
    sourceUrl: DEMO_SOURCE_URL,
    payload: {
      key: offer.key,
      concept: offer.concept,
      name: variant.name,
      brand: product.brand ?? null,
      ean: product.ean ?? null,
      size: formatSize(product),
      category: product.category,
      organic: product.isOrganic ?? false,
      attributes: Object.keys(product.attributes ?? {})
        .filter((name) => product.attributes?.[name])
        .join(","),
      price: "currentCents" in offer ? formatPrice(offer.currentCents, style.impliedCents) : "",
      regularPrice: formatPrice(variant.regularCents, style.impliedCents),
      // A plain price cut shows only the two prices; its label is a badge, not a mechanic.
      promotion: priceCut ? "" : (offer.promoDescription ?? ""),
      badge: priceCut ? (offer.promoDescription ?? null) : null,
      validity: validity === "" || validity === "alleen vandaag" ? validity : `${style.validityPrefix ?? ""}${validity}`,
      conditions: offer.conditions ?? null,
      kind: offer.kind ?? "WEEKLY",
    },
  };
}

function readPrice(value: string | null, impliedCents: boolean): number | null {
  if (value === null) return null;
  const result = parsePriceCents(value, { impliedCents });
  return result.ok ? result.value : null;
}

/**
 * A mock adapter for one chain: it serves the demo catalogue as page text and reads it
 * back with the domain parsers. It never touches `ctx.http`.
 */
export function createMockAdapter(style: MockStyle): RetailerAdapter {
  // Expired catalogue offers are never emitted: an offer page lists none.
  const offers = DEMO_OFFERS.filter((offer) => offer.retailer === style.retailerSlug && isDemoOfferListed(offer));
  const upcoming = (offer: DemoOffer) => offer.fromOffset !== null && offer.fromOffset > 0;

  function normalizeProduct(raw: RawOffer) {
    const { payload } = raw;
    const name = text(payload, "name");
    if (name === null) return fail("name-missing");
    const concept = text(payload, "concept");
    if (concept === null) return fail("concept-missing");

    const size = text(payload, "size");
    const quantity = size === null ? null : parseQuantity(size);
    const eanText = text(payload, "ean");
    const ean = eanText === null ? null : normalizeEan(eanText);
    const attributes = Object.fromEntries(
      (text(payload, "attributes") ?? "")
        .split(",")
        .filter((flag) => flag !== "")
        .map((flag) => [flag, true]),
    );
    const product: NormalizedProduct = {
      externalId: `demo-${concept}`,
      name,
      brand: text(payload, "brand"),
      ean: ean?.ok ? ean.value : null,
      quantity: quantity?.ok ? quantity.value : null,
      categorySlug: text(payload, "category"),
      isOrganic: payload.organic === true,
      attributes,
    };
    return ok(product);
  }

  return {
    id: `mock:${style.retailerSlug}`,
    retailerSlug: style.retailerSlug,
    isMock: true,
    async fetchOffers(ctx) {
      return offers.filter((offer) => !upcoming(offer)).map((offer) => toRaw(offer, style, ctx));
    },
    async fetchUpcomingOffers(ctx) {
      return offers.filter(upcoming).map((offer) => toRaw(offer, style, ctx));
    },
    async fetchStoreLocations() {
      return [];
    },
    normalizeProduct,
    normalizeOffer(raw, ctx) {
      const product = normalizeProduct(raw);
      if (!product.ok) return product;
      const { payload } = raw;
      const kind = text(payload, "kind");
      if (kind !== "WEEKLY" && kind !== "DAILY") return fail("kind-unrecognised");

      const currentPriceCents = readPrice(text(payload, "price"), style.impliedCents);
      const regularPriceCents = readPrice(text(payload, "regularPrice"), style.impliedCents);
      const promotionText = text(payload, "promotion");
      let promotion: Promotion;
      if (promotionText !== null) promotion = parsePromotion(promotionText);
      else if (currentPriceCents !== null) promotion = { type: "PRICE_CUT" };
      else promotion = { type: "UNKNOWN", text: "" };

      const validityText = text(payload, "validity");
      const parsedValidity = validityText === null ? null : parseValidity(validityText, { today: ctx.today });
      const validity: Validity | null = parsedValidity?.ok ? parsedValidity.value : null;
      const key = text(payload, "key");

      return ok({
        product: product.value,
        title: product.value.name,
        kind,
        promotion,
        promoDescription: promotionText ?? text(payload, "badge"),
        currentPriceCents,
        regularPriceCents,
        validity,
        conditions: text(payload, "conditions"),
        sourceUrl: raw.sourceUrl,
        rawPayload: payload,
        ...(key === null ? {} : { dedupeKey: key }),
      });
    },
  };
}
