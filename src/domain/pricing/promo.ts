import { parsePriceCents, roundHalfUp } from "./money";
import { fail, ok, type Result } from "./result";

/** Promotion mechanics as shown on Dutch retailer pages. */
export type Promotion =
  /** A plain lower price per item: the offer price. */
  | { type: "PRICE_CUT" }
  /** Buy `buy`, get `free` more for nothing ("1+1 gratis", "2+1 gratis", "2 halen 1 betalen"). */
  | { type: "X_PLUS_Y_FREE"; buy: number; free: number }
  /** Every n-th item at half the regular price ("2e halve prijs"). */
  | { type: "NTH_HALF_PRICE"; n: number }
  /** `quantity` items together for `totalCents` ("2 voor 3,00", "3 stuks 5.-"). */
  | { type: "X_FOR_PRICE"; quantity: number; totalCents: number }
  /** `percent` off the regular price of each item ("25% korting"). 0 < percent < 100. */
  | { type: "PERCENT_OFF"; percent: number }
  /** Text that is not a recognised mechanic, kept verbatim. */
  | { type: "UNKNOWN"; text: string };

type Known = Exclude<Promotion, { type: "UNKNOWN" }>;

const PRICE = String.raw`€? ?\d+(?:\.\d{3})*(?:[.,](?:\d+|[-–]{1,2}))?(?: ?euro)?`;
const WORDS = String.raw`(?: [a-z]+)*`;
const ORDINAL = String.raw`(?:(\d+) ?(?:e|de)|(tweede)|(derde))`;
const ORDINAL_WORDS: Record<string, number> = { tweede: 2, derde: 3 };

function readPrice(text: string): number | null {
  const result = parsePriceCents(text.replace(/ ?euro$/, ""));
  return result.ok ? result.value : null;
}

function readOrdinal(digits: string | undefined, ...words: (string | undefined)[]): number {
  if (digits !== undefined) return Number(digits);
  const word = words.find((w) => w !== undefined);
  return word === undefined ? 0 : ORDINAL_WORDS[word];
}

type Matcher = { pattern: RegExp; build: (m: RegExpExecArray) => Known | null };

const MATCHERS: Matcher[] = [
  {
    pattern: new RegExp(String.raw`(\d+) ?\+ ?(\d+)${WORDS} gratis\b`),
    build: (m) => xPlusYFree(Number(m[1]), Number(m[2])),
  },
  {
    pattern: new RegExp(String.raw`${ORDINAL} gratis\b`),
    build: (m) => {
      const n = readOrdinal(m[1], m[2], m[3]);
      return n >= 2 ? xPlusYFree(n - 1, 1) : null;
    },
  },
  {
    pattern: /(\d+) halen,? (\d+) betalen\b/,
    build: (m) => xPlusYFree(Number(m[2]), Number(m[1]) - Number(m[2])),
  },
  {
    pattern: new RegExp(String.raw`${ORDINAL}${WORDS} halve prijs\b`),
    build: (m) => {
      const n = readOrdinal(m[1], m[2], m[3]);
      return n >= 2 ? { type: "NTH_HALF_PRICE", n } : null;
    },
  },
  {
    pattern: new RegExp(String.raw`(?:^| )(\d+) (?:[a-z]+ )?voor (${PRICE})(?= |$)`),
    build: (m) => xForPrice(Number(m[1]), readPrice(m[2])),
  },
  {
    pattern: new RegExp(String.raw`(?:^| )(\d+) (?:stuks?|st) (${PRICE})(?= |$)`),
    build: (m) => xForPrice(Number(m[1]), readPrice(m[2])),
  },
  {
    pattern: new RegExp(String.raw`(\d+(?:[.,]\d+)?) ?%${WORDS} korting\b`),
    build: (m) => {
      const percent = Number(m[1].replace(",", "."));
      return percent > 0 && percent < 100 ? { type: "PERCENT_OFF", percent } : null;
    },
  },
  { pattern: /\bactieprijs\b/, build: () => ({ type: "PRICE_CUT" }) },
  {
    pattern: new RegExp(String.raw`(?:^| )van (${PRICE}) voor (${PRICE})(?= |$)`),
    build: (m) => (readPrice(m[1]) !== null && readPrice(m[2]) !== null ? { type: "PRICE_CUT" } : null),
  },
];

function xPlusYFree(buy: number, free: number): Known | null {
  return buy >= 1 && free >= 1 ? { type: "X_PLUS_Y_FREE", buy, free } : null;
}

function xForPrice(quantity: number, totalCents: number | null): Known | null {
  return quantity >= 1 && totalCents !== null ? { type: "X_FOR_PRICE", quantity, totalCents } : null;
}

/**
 * Reads a promotion label, case-insensitive and tolerant of extra words ("1+1 DIEPVRIES GRATIS").
 * Returns UNKNOWN with the original text when no mechanic matches, when more than one does,
 * or when numbers are left over outside the match ("25% korting op de 2e").
 */
export function parsePromotion(text: string): Promotion {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  const found: Known[] = [];
  for (const { pattern, build } of MATCHERS) {
    const match = pattern.exec(normalized);
    if (!match) continue;
    const leftover = normalized.replace(match[0], " ");
    const promotion = build(match);
    if (promotion && !/[\d%€+]/.test(leftover)) found.push(promotion);
  }
  return found.length === 1 ? found[0] : { type: "UNKNOWN", text };
}

export type DealInput = {
  promotion: Promotion;
  /** Regular price of one item in cents; null or absent when unknown. */
  regularPriceCents?: number | null;
  /** Offer price of one item in cents, as shown on the offer; null or absent when unknown. */
  offerPriceCents?: number | null;
  /** Number of items bought, a positive integer. */
  quantity: number;
};

export type DealReason = "missing-regular-price" | "missing-offer-price" | "unknown-promotion";

/** `assumed` is true when an UNKNOWN promotion was priced as a plain price cut. */
export type DealTotal = { totalCents: number; assumed: boolean };
export type DealUnit = { unitCents: number; assumed: boolean };

function checkCents(name: string, value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be non-negative integer cents, got ${value}`);
  }
  return value;
}

function computeTotal(promotion: Known, regular: number | null, offer: number | null, quantity: number) {
  switch (promotion.type) {
    case "PRICE_CUT":
      return offer === null ? null : quantity * offer;
    case "X_PLUS_Y_FREE": {
      if (regular === null) return null;
      const groupSize = promotion.buy + promotion.free;
      const groups = Math.floor(quantity / groupSize);
      const paidLeftover = Math.min(quantity % groupSize, promotion.buy);
      return (groups * promotion.buy + paidLeftover) * regular;
    }
    case "NTH_HALF_PRICE": {
      if (regular === null) return null;
      const halfPriced = Math.floor(quantity / promotion.n);
      return roundHalfUp(2 * quantity * regular - halfPriced * regular, 2);
    }
    case "X_FOR_PRICE": {
      const groups = Math.floor(quantity / promotion.quantity);
      const leftover = quantity % promotion.quantity;
      if (leftover > 0 && regular === null) return null;
      return groups * promotion.totalCents + leftover * (regular ?? 0);
    }
    case "PERCENT_OFF":
      if (regular === null) return null;
      return quantity * roundHalfUp(regular * (100 - promotion.percent), 100);
  }
}

/**
 * Total in integer cents the shopper pays for exactly `quantity` items under `promotion`.
 * Leftover items outside a complete deal pay the regular price. 2e halve prijs is rounded
 * half up on the total; PERCENT_OFF is rounded half up per item. An UNKNOWN promotion with
 * an offer price is priced as a price cut and flagged `assumed`.
 */
export function effectiveTotalCents(input: DealInput): Result<DealTotal, DealReason> {
  const { promotion, quantity } = input;
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new RangeError(`quantity must be a positive integer, got ${quantity}`);
  }
  const regular = checkCents("regularPriceCents", input.regularPriceCents);
  const offer = checkCents("offerPriceCents", input.offerPriceCents);

  if (promotion.type === "UNKNOWN") {
    if (offer === null) return fail("unknown-promotion");
    return ok({ totalCents: quantity * offer, assumed: true });
  }
  const totalCents = computeTotal(promotion, regular, offer, quantity);
  if (totalCents === null) {
    return fail(promotion.type === "PRICE_CUT" ? "missing-offer-price" : "missing-regular-price");
  }
  return ok({ totalCents, assumed: false });
}

/** Effective price of one item in integer cents: the total divided by quantity, half up. */
export function effectiveUnitCents(input: DealInput): Result<DealUnit, DealReason> {
  const total = effectiveTotalCents(input);
  if (!total.ok) return total;
  return ok({
    unitCents: roundHalfUp(total.value.totalCents, input.quantity),
    assumed: total.value.assumed,
  });
}

/**
 * Discount against the regular price as a whole percent, rounded half up.
 * Null when the regular price is unknown or not higher than the effective price.
 */
export function discountPercent(regularCents: number | null, effectiveUnitCents: number): number | null {
  if (regularCents === null || regularCents <= effectiveUnitCents) return null;
  return roundHalfUp((regularCents - effectiveUnitCents) * 100, regularCents);
}

/** Fewest items to buy for the deal to apply; null for an UNKNOWN promotion. */
export function minimumQuantityForDeal(promotion: Promotion): number | null {
  switch (promotion.type) {
    case "X_PLUS_Y_FREE":
      return promotion.buy + promotion.free;
    case "NTH_HALF_PRICE":
      return promotion.n;
    case "X_FOR_PRICE":
      return promotion.quantity;
    case "PERCENT_OFF":
    case "PRICE_CUT":
      return 1;
    case "UNKNOWN":
      return null;
  }
}
