import type { IsoDate, Promotion, Quantity, Result, Validity } from "@/domain/pricing";
import type { HttpClient } from "./http";

/**
 * The contract every retailer adapter implements. Adapters read a chain's offer pages
 * only: there is deliberately no `fetchCatalog`, because collecting a chain's full
 * catalogue is ruled out (docs/decisions.md section 3).
 */

/** A value kept in a minimised raw record. */
export type RawValue = string | number | boolean | null;

/** One offer as read from the source, minimised; stored as `Offer.rawPayload`. */
export type RawOffer = { sourceUrl: string; payload: Record<string, RawValue> };

/** One store location as read from the source. */
export type RawStore = {
  sourceUrl: string;
  /** Stable identifier at the source (for example an OpenStreetMap node id). */
  sourceRef: string;
  name: string;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  payload: Record<string, RawValue>;
};

export type NormalizedProduct = {
  /** Identifier at the source; with the retailer it makes re-ingestion idempotent. */
  externalId: string;
  name: string;
  brand: string | null;
  ean: string | null;
  quantity: Quantity | null;
  categorySlug: string | null;
  isOrganic: boolean;
  attributes: Record<string, boolean>;
};

export type OfferKind = "WEEKLY" | "DAILY";

export type NormalizedOffer = {
  product: NormalizedProduct;
  /** Headline as the source words it. */
  title: string;
  kind: OfferKind;
  promotion: Promotion;
  /** The mechanic in the chain's own words, e.g. "1+1 gratis". */
  promoDescription: string | null;
  currentPriceCents: number | null;
  regularPriceCents: number | null;
  validity: Validity | null;
  conditions: string | null;
  sourceUrl: string;
  rawPayload: Record<string, RawValue>;
  /** Stable source key: when set, the content hash ignores content changes. */
  dedupeKey?: string;
};

export type AdapterContext = {
  http: HttpClient;
  /** Run day in Europe/Amsterdam. */
  today: IsoDate;
  now: Date;
};

export type RetailerAdapter = {
  /** "jumbo" for a real adapter, "mock:jumbo" for a mock one. */
  id: string;
  retailerSlug: string;
  /** Mock adapters make no requests and produce demo data. */
  isMock: boolean;
  /** Collection runs allowed per Europe/Amsterdam day; default 1. Ignored for mocks. */
  maxRunsPerDay?: number;
  fetchOffers(ctx: AdapterContext): Promise<RawOffer[]>;
  fetchUpcomingOffers(ctx: AdapterContext): Promise<RawOffer[]>;
  fetchStoreLocations(ctx: AdapterContext): Promise<RawStore[]>;
  normalizeProduct(raw: RawOffer, ctx: AdapterContext): Result<NormalizedProduct, string>;
  normalizeOffer(raw: RawOffer, ctx: AdapterContext): Result<NormalizedOffer, string>;
};
