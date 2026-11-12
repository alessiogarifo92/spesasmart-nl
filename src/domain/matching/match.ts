import { normalizeEan, type Quantity, type UnitPrice } from "@/domain/pricing";
import { normalizeName } from "@/domain/search";
import { coreTokens, nameSimilarity } from "./tokens";
import type { Match, MatchProduct, MatchSignal, MatchType } from "./types";

/** From this confidence a link is shown without review. */
export const AUTO_THRESHOLD = 0.7;
/** Under this confidence no link is made at all. */
export const MIN_CONFIDENCE = 0.45;

/** Lowest name score for SAME without a shared barcode. */
export const SAME_NAME_THRESHOLD = 0.8;
/** Lowest name score for SIMILAR. */
export const SIMILAR_NAME_THRESHOLD = 0.6;
/** Lowest name score for ALTERNATIVE. */
export const ALTERNATIVE_NAME_THRESHOLD = 0.5;

/** Sizes whose larger total is at most this fraction above the smaller are equal. */
export const SIZE_EQUAL_TOLERANCE = 0.02;
/** Larger total at most this many times the smaller: close in size. */
export const SIZE_CLOSE_RATIO = 1.25;
/** An ALTERNATIVE may be at most this many times the size of the other product. */
export const ALTERNATIVE_MAX_SIZE_RATIO = 4;
/** A dearer unit price more than this many times the cheaper one suggests a different product. */
export const PRICE_GAP_RATIO = 3;
/** Subtracted from the confidence on a price gap. */
export const PRICE_GAP_PENALTY = 0.15;
/** Subtracted when both barcodes are known and differ: alike, but provably not the same article. */
export const EAN_DIFFERENT_PENALTY = 0.2;

/** Weights of the confidence components; they add up to 1. */
export const CONFIDENCE_WEIGHTS = { name: 0.55, brand: 0.15, size: 0.15, category: 0.1, organic: 0.05 } as const;
/** Score of each brand outcome inside its weight. Unknown sits between equal and different. */
export const BRAND_SCORES = { equal: 1, unknown: 0.5, different: 0 } as const;
/** Score of each size outcome inside its weight. Unknown scores above a known difference. */
export const SIZE_SCORES = { equal: 1, close: 0.6, different: 0.25, unknown: 0.4 } as const;
/** Score of each category outcome inside its weight; different categories never get this far. */
export const CATEGORY_SCORES = { equal: 1, unknown: 0.5 } as const;

const SIGNAL_ORDER: readonly MatchSignal[] = [
  "ean-equal",
  "ean-different",
  "brand-equal",
  "brand-different",
  "brand-unknown",
  "size-equal",
  "size-close",
  "size-different",
  "size-unknown",
  "category-equal",
  "category-unknown",
  "organic-different",
  "price-gap",
];

const TYPE_RANK: Record<MatchType, number> = { SAME: 0, SIMILAR: 1, ALTERNATIVE: 2 };

/** Integer hundredths of a 0..1 value, so every comparison and sum below is exact. */
function hundredths(value: number): number {
  return Math.round(value * 100);
}

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

/** Throws RangeError when the product cannot be compared: no identity, or a size or price out of range. */
function assertProduct(product: MatchProduct): void {
  if (product.id === "") throw new RangeError("product id must not be empty");
  if (product.retailerId === "") throw new RangeError(`retailerId of product ${product.id} must not be empty`);
  const { quantity, unitPrice } = product;
  if (quantity !== null) {
    for (const field of ["amount", "count", "totalAmount"] as const) {
      if (!isPositiveInteger(quantity[field])) {
        throw new RangeError(
          `quantity.${field} of product ${product.id} must be a positive integer, got ${quantity[field]}`,
        );
      }
    }
  }
  if (unitPrice !== null && !(Number.isSafeInteger(unitPrice.cents) && unitPrice.cents >= 0)) {
    throw new RangeError(
      `unitPrice.cents of product ${product.id} must be non-negative integer cents, got ${unitPrice.cents}`,
    );
  }
}

/** The barcode in EAN-13/EAN-8 form, or null when missing or invalid: an invalid barcode proves nothing. */
function validEan(ean: string | null): string | null {
  if (ean === null) return null;
  const normalized = normalizeEan(ean);
  return normalized.ok ? normalized.value : null;
}

/** Normalised brand, or null when missing or empty after normalisation. */
function brandKey(brand: string | null): string | null {
  if (brand === null) return null;
  const normalized = normalizeName(brand);
  return normalized === "" ? null : normalized;
}

function categoryKey(slug: string | null): string | null {
  return slug === null || slug.trim() === "" ? null : slug;
}

/** larger / smaller ≤ ratio, in integers: `ratio` has at most two decimals. */
function withinRatio(smaller: number, larger: number, ratio: number): boolean {
  return larger * 100 <= smaller * hundredths(ratio);
}

type SizeOutcome = "equal" | "close" | "different" | "unknown";

function sizeOutcome(a: Quantity | null, b: Quantity | null): SizeOutcome {
  if (a === null || b === null) return "unknown";
  // Only reachable with equal barcodes: grams against millilitres are not comparable.
  if (a.unit !== b.unit) return "different";
  const smaller = Math.min(a.totalAmount, b.totalAmount);
  const larger = Math.max(a.totalAmount, b.totalAmount);
  if (withinRatio(smaller, larger, 1 + SIZE_EQUAL_TOLERANCE)) return "equal";
  if (withinRatio(smaller, larger, SIZE_CLOSE_RATIO)) return "close";
  return "different";
}

function hasPriceGap(a: UnitPrice | null, b: UnitPrice | null): boolean {
  if (a === null || b === null || a.basis !== b.basis) return false;
  const cheaper = Math.min(a.cents, b.cents);
  const dearer = Math.max(a.cents, b.cents);
  return dearer * 100 > cheaper * hundredths(PRICE_GAP_RATIO);
}

/**
 * How two listings of different chains relate, or null when they should not be linked:
 * the same listing, two listings of one chain, known different categories or units (unless
 * the barcodes are equal), or too little in common. Symmetric in its arguments.
 */
export function matchProducts(a: MatchProduct, b: MatchProduct): Match | null {
  assertProduct(a);
  assertProduct(b);
  // Two listings of one chain are two products, however alike they look.
  if (a.id === b.id || a.retailerId === b.retailerId) return null;

  const eanA = validEan(a.ean);
  const eanB = validEan(b.ean);
  const eanEqual = eanA !== null && eanA === eanB;
  const categoryA = categoryKey(a.categorySlug);
  const categoryB = categoryKey(b.categorySlug);
  if (!eanEqual && categoryA !== null && categoryB !== null && categoryA !== categoryB) return null;
  if (!eanEqual && a.quantity !== null && b.quantity !== null && a.quantity.unit !== b.quantity.unit) return null;

  const signals = new Set<MatchSignal>();
  if (eanA !== null && eanB !== null) signals.add(eanEqual ? "ean-equal" : "ean-different");

  const brandA = brandKey(a.brand);
  const brandB = brandKey(b.brand);
  const brand = brandA === null || brandB === null ? "unknown" : brandA === brandB ? "equal" : "different";
  signals.add(`brand-${brand}`);

  const size = sizeOutcome(a.quantity, b.quantity);
  signals.add(`size-${size}`);

  // Different categories only get here with equal barcodes; they carry no category signal.
  const category = categoryA === null || categoryB === null ? "unknown" : categoryA === categoryB ? "equal" : null;
  if (category !== null) signals.add(`category-${category}`);

  const organicDifferent = a.isOrganic !== b.isOrganic;
  if (organicDifferent) signals.add("organic-different");
  const priceGap = hasPriceGap(a.unitPrice, b.unitPrice);
  if (priceGap) signals.add("price-gap");

  // Thresholds and confidence use the rounded score, so the reported numbers explain the result.
  const name = hundredths(nameSimilarity(coreTokens(a.name, a.brand), coreTokens(b.name, b.brand)));
  const nameScore = name / 100;
  const ordered = SIGNAL_ORDER.filter((s) => signals.has(s));

  if (eanEqual) return { type: "SAME", confidence: 1, status: "AUTO", nameScore, signals: ordered };

  let type: MatchType | null = null;
  if (
    brand === "equal" &&
    name >= hundredths(SAME_NAME_THRESHOLD) &&
    size === "equal" &&
    !organicDifferent &&
    !signals.has("ean-different")
  ) {
    type = "SAME";
  } else if (
    name >= hundredths(SIMILAR_NAME_THRESHOLD) &&
    (size === "equal" || size === "close") &&
    !organicDifferent &&
    brand !== "different"
  ) {
    type = "SIMILAR";
  } else if (
    name >= hundredths(ALTERNATIVE_NAME_THRESHOLD) &&
    category === "equal" &&
    (a.quantity === null ||
      b.quantity === null ||
      withinRatio(
        Math.min(a.quantity.totalAmount, b.quantity.totalAmount),
        Math.max(a.quantity.totalAmount, b.quantity.totalAmount),
        ALTERNATIVE_MAX_SIZE_RATIO,
      ))
  ) {
    type = "ALTERNATIVE";
  }
  if (type === null) return null;

  // Ten-thousandths: weight (hundredths) × score (hundredths), summed as integers so the
  // rounding at x.xx5 is half up and never off by floating-point drift.
  const components: [number, number][] = [
    [CONFIDENCE_WEIGHTS.name, nameScore],
    [CONFIDENCE_WEIGHTS.brand, BRAND_SCORES[brand]],
    [CONFIDENCE_WEIGHTS.size, SIZE_SCORES[size]],
    [CONFIDENCE_WEIGHTS.category, CATEGORY_SCORES[category ?? "unknown"]],
    [CONFIDENCE_WEIGHTS.organic, organicDifferent ? 0 : 1],
  ];
  let total = components.reduce((sum, [weight, score]) => sum + hundredths(weight) * hundredths(score), 0);
  if (priceGap) total -= hundredths(PRICE_GAP_PENALTY) * 100;
  if (signals.has("ean-different")) total -= hundredths(EAN_DIFFERENT_PENALTY) * 100;
  total = Math.min(10000, Math.max(0, total));
  const confidence = Math.round(total / 100) / 100;
  if (confidence < MIN_CONFIDENCE) return null;

  return {
    type,
    confidence,
    status: confidence >= AUTO_THRESHOLD ? "AUTO" : "NEEDS_REVIEW",
    nameScore,
    signals: ordered,
  };
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Every product in `pool` that `product` links to, best first: SAME, SIMILAR, ALTERNATIVE,
 * then confidence descending, then product id. The pool may contain `product` itself and
 * listings of its own chain; they never match.
 */
export function findMatches(product: MatchProduct, pool: MatchProduct[]): { product: MatchProduct; match: Match }[] {
  assertProduct(product);
  const result: { product: MatchProduct; match: Match }[] = [];
  for (const candidate of pool) {
    const match = matchProducts(product, candidate);
    if (match !== null) result.push({ product: candidate, match });
  }
  return result.sort(
    (x, y) =>
      TYPE_RANK[x.match.type] - TYPE_RANK[y.match.type] ||
      y.match.confidence - x.match.confidence ||
      compareText(x.product.id, y.product.id),
  );
}
