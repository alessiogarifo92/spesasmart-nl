import type { Quantity, UnitPrice } from "@/domain/pricing";

/** How two listings of different chains relate. The interface shows "Zelfde product", "Zeer vergelijkbaar", "Alternatief". */
export type MatchType = "SAME" | "SIMILAR" | "ALTERNATIVE";

/** AUTO links are shown as they are; NEEDS_REVIEW links wait for a person to confirm them. */
export type MatchStatus = "AUTO" | "NEEDS_REVIEW";

/** One chain's listing of a product, with what the matcher compares. */
export type MatchProduct = {
  id: string;
  retailerId: string;
  /** The name as the chain writes it. */
  name: string;
  brand: string | null;
  ean: string | null;
  categorySlug: string | null;
  /** Package size; null when unknown. */
  quantity: Quantity | null;
  isOrganic: boolean;
  /** Regular price per kg, litre or piece; null when unknown. */
  unitPrice: UnitPrice | null;
};

/** Evidence behind a match, listed in this order. "Unknown" signals mean one side has no value. */
export type MatchSignal =
  | "ean-equal"
  | "ean-different"
  | "brand-equal"
  | "brand-different"
  | "brand-unknown"
  | "size-equal"
  | "size-close"
  | "size-different"
  | "size-unknown"
  | "category-equal"
  | "category-unknown"
  | "organic-different"
  | "price-gap";

export type Match = {
  type: MatchType;
  /** 0..1, rounded to 2 decimals. */
  confidence: number;
  status: MatchStatus;
  /** Similarity of the core name tokens, 0..1, rounded to 2 decimals. */
  nameScore: number;
  /** In the order of `MatchSignal`, without duplicates. */
  signals: MatchSignal[];
};
