import {
  discountPercent,
  effectiveUnitCents,
  minimumQuantityForDeal,
  type IsoDate,
  type Promotion,
} from "@/domain/pricing";

export type OfferFacts = {
  promotion: Promotion;
  /** Price of one item under the offer, when the source states one. */
  currentPriceCents: number | null;
  regularPriceCents: number | null;
  validFrom: IsoDate | null;
  validUntil: IsoDate | null;
};

export type OfferState = "running" | "ends-today" | "upcoming" | "expired" | "unknown-validity";

export type OfferSummary = {
  state: OfferState;
  /** Days until the last valid day (0 = today); null when the end is unknown. */
  daysLeft: number | null;
  /** Days until the first valid day, for an upcoming offer; otherwise null. */
  startsInDays: number | null;
  /** The price printed large: the stated offer price, else the regular price. A fact, not an estimate. */
  shownPriceCents: number | null;
  /** Items to buy for the mechanic to apply; 1 for a plain price; null when unknown. */
  dealQuantity: number | null;
  /** Estimate: price per item when buying `dealQuantity`. */
  dealUnitCents: number | null;
  /** Estimate: whole-percent discount against the regular price at `dealQuantity`. */
  discountPercent: number | null;
};

function dayNumber(date: IsoDate): number {
  return Date.parse(`${date}T00:00:00Z`) / 86_400_000;
}

function stateOf(facts: OfferFacts, today: IsoDate): OfferState {
  if (facts.validUntil === null) return "unknown-validity";
  if (facts.validUntil < today) return "expired";
  if (facts.validFrom !== null && facts.validFrom > today) return "upcoming";
  return facts.validUntil === today ? "ends-today" : "running";
}

/** Everything the interface derives from an offer: its state today and the labelled estimates. */
export function describeOffer(facts: OfferFacts, today: IsoDate): OfferSummary {
  const state = stateOf(facts, today);
  const dealQuantity = minimumQuantityForDeal(facts.promotion);
  const deal =
    dealQuantity === null
      ? null
      : effectiveUnitCents({
          promotion: facts.promotion,
          regularPriceCents: facts.regularPriceCents,
          offerPriceCents: facts.currentPriceCents,
          quantity: dealQuantity,
        });
  const dealUnitCents = deal?.ok && !deal.value.assumed ? deal.value.unitCents : null;

  return {
    state,
    daysLeft: facts.validUntil === null ? null : Math.round(dayNumber(facts.validUntil) - dayNumber(today)),
    startsInDays:
      state === "upcoming" && facts.validFrom !== null
        ? Math.round(dayNumber(facts.validFrom) - dayNumber(today))
        : null,
    shownPriceCents: facts.currentPriceCents ?? facts.regularPriceCents,
    dealQuantity,
    dealUnitCents,
    discountPercent: dealUnitCents === null ? null : discountPercent(facts.regularPriceCents, dealUnitCents),
  };
}
