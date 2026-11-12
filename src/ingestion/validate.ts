import {
  daysUntilEnd,
  discountPercent,
  effectiveUnitCents,
  minimumQuantityForDeal,
  type IsoDate,
} from "@/domain/pricing";
import type { NormalizedOffer } from "./adapter";

/** Highest believable price of one item or one deal, in cents (1000 euros). */
export const MAX_PRICE_CENTS = 100_000;
/** Lowest confidence an offer can have and still be shown as verified. */
export const MIN_VERIFIED_CONFIDENCE = 0.6;
/** A discount above this percentage is suspicious, not impossible. */
export const IMPLAUSIBLE_DISCOUNT_PERCENT = 80;

/** Confidence lost per doubt. */
export const PENALTY = {
  validityUnknown: 0.3,
  validityApproximate: 0.2,
  promotionUnknown: 0.3,
  quantityUnknown: 0.15,
  regularPriceUnknown: 0.1,
  regularBelowOffer: 0.2,
  discountImplausible: 0.1,
} as const;

export type ValidationStatus = "VERIFIED" | "UNVERIFIED" | "REJECTED";

export type Verdict = { status: ValidationStatus; confidence: number; issues: string[] };

function priceOutOfRange(cents: number | null): boolean {
  return cents !== null && (cents <= 0 || cents > MAX_PRICE_CENTS);
}

/**
 * Decides whether a normalised offer is stored and how far it is trusted. REJECTED offers
 * are not stored; UNVERIFIED ones are shown as "to be verified"; VERIFIED needs a known,
 * exact validity and no doubt about the mechanic or the price.
 */
export function validateOffer(offer: NormalizedOffer, context: { today: IsoDate }): Verdict {
  const rejections: string[] = [];
  if (offer.product.name.trim() === "") rejections.push("product-name-empty");
  if (offer.title.trim() === "") rejections.push("title-empty");
  const dealTotal = offer.promotion.type === "X_FOR_PRICE" ? offer.promotion.totalCents : null;
  if ([offer.currentPriceCents, offer.regularPriceCents, dealTotal].some(priceOutOfRange)) {
    rejections.push("price-out-of-range");
  }
  if (offer.validity && daysUntilEnd(offer.validity, context.today) < 0) rejections.push("expired");

  const issues: string[] = [];
  let confidence = 1;
  let unverified = false;
  const flag = (issue: string, penalty: number, makesUnverified: boolean) => {
    issues.push(issue);
    confidence -= penalty;
    unverified ||= makesUnverified;
  };

  if (offer.validity === null) flag("validity-unknown", PENALTY.validityUnknown, true);
  else if (offer.validity.approximate) flag("validity-approximate", PENALTY.validityApproximate, true);
  if (offer.promotion.type === "UNKNOWN") flag("promotion-unknown", PENALTY.promotionUnknown, true);
  if (offer.product.quantity === null) flag("quantity-unknown", PENALTY.quantityUnknown, false);

  let offerPrice = offer.currentPriceCents;
  if (rejections.length === 0) {
    const deal = effectiveUnitCents({
      promotion: offer.promotion,
      regularPriceCents: offer.regularPriceCents,
      offerPriceCents: offer.currentPriceCents,
      quantity: minimumQuantityForDeal(offer.promotion) ?? 1,
    });
    if (deal.ok) offerPrice ??= deal.value.unitCents;
    else flag("price-unknown", 0, true);
  }

  if (offer.regularPriceCents === null) {
    flag("regular-price-unknown", PENALTY.regularPriceUnknown, false);
  } else if (offerPrice !== null && offer.regularPriceCents < offerPrice) {
    flag("regular-below-offer", PENALTY.regularBelowOffer, true);
  } else if (offerPrice !== null && (discountPercent(offer.regularPriceCents, offerPrice) ?? 0) > IMPLAUSIBLE_DISCOUNT_PERCENT) {
    flag("discount-implausible", PENALTY.discountImplausible, false);
  }

  confidence = Math.round(Math.min(1, Math.max(0, confidence)) * 100) / 100;
  if (rejections.length > 0) return { status: "REJECTED", confidence, issues: [...rejections, ...issues] };
  const status = !unverified && confidence >= MIN_VERIFIED_CONFIDENCE ? "VERIFIED" : "UNVERIFIED";
  return { status, confidence, issues };
}
