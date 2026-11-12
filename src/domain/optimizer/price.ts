import {
  effectiveTotalCents,
  fail,
  minimumQuantityForDeal,
  ok,
  roundHalfUp,
  unitPrice,
  type Result,
} from "@/domain/pricing";
import type { Candidate, CandidatePrice, DealHint } from "./types";

/** Throws RangeError unless `quantity` is a positive integer. */
export function assertQuantity(quantity: number): void {
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new RangeError(`quantity must be a positive integer, got ${quantity}`);
  }
}

/** Throws RangeError unless `value` is null or non-negative integer cents. */
export function assertCents(name: string, value: number | null | undefined): void {
  if (value === null || value === undefined) return;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be non-negative integer cents, got ${value}`);
  }
}

/** Throws RangeError when any amount of money on the candidate is not non-negative integer cents. */
export function assertCandidate(candidate: Candidate): void {
  assertCents("regularPriceCents", candidate.regularPriceCents);
  const { offer } = candidate;
  if (offer === null) return;
  assertCents("offerPriceCents", offer.offerPriceCents);
  if (offer.promotion.type === "X_FOR_PRICE") assertCents("promotion.totalCents", offer.promotion.totalCents);
}

type OfferTotal = { totalCents: number; assumed: boolean };

function offerTotal(candidate: Candidate, quantity: number): OfferTotal | null {
  const { offer } = candidate;
  if (offer === null || !offer.verified) return null;
  const total = effectiveTotalCents({
    promotion: offer.promotion,
    regularPriceCents: candidate.regularPriceCents,
    offerPriceCents: offer.offerPriceCents,
    quantity,
  });
  return total.ok ? total.value : null;
}

function dealHint(candidate: Candidate, quantity: number): DealHint | null {
  const { offer } = candidate;
  if (offer === null || !offer.verified) return null;
  const minimumQuantity = minimumQuantityForDeal(offer.promotion);
  return minimumQuantity !== null && quantity < minimumQuantity
    ? { code: "buy-more-for-deal", minimumQuantity }
    : null;
}

/**
 * Price in integer cents of `quantity` items of a candidate. The line costs the lower of the
 * verified offer's total (promotion maths from `effectiveTotalCents`, so a quantity deal counts
 * only when the quantity reaches it) and the regular price × quantity; an unverified offer is
 * never used. `unitCents` is the total / quantity rounded half up. Fails with "no-price" when
 * neither total is known. Throws RangeError for a bad quantity or bad cents on the candidate.
 */
export function priceCandidate(candidate: Candidate, quantity: number): Result<CandidatePrice, "no-price"> {
  assertQuantity(quantity);
  assertCandidate(candidate);

  const regularTotalCents = candidate.regularPriceCents === null ? null : candidate.regularPriceCents * quantity;
  const offer = offerTotal(candidate, quantity);
  const used = offer !== null && (regularTotalCents === null || offer.totalCents < regularTotalCents) ? offer : null;
  const totalCents = used === null ? regularTotalCents : used.totalCents;
  if (totalCents === null) return fail("no-price");

  const { quantity: pack } = candidate;
  return ok({
    totalCents,
    unitCents: roundHalfUp(totalCents, quantity),
    regularTotalCents,
    usedOffer: used !== null,
    assumed: used !== null && used.assumed,
    unitPrice: pack === null ? null : unitPrice(totalCents, { ...pack, totalAmount: pack.totalAmount * quantity }),
    hint: dealHint(candidate, quantity),
  });
}
