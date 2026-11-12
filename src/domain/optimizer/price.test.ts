import { describe, expect, it } from "vitest";
import type { Promotion, Quantity } from "@/domain/pricing";
import { priceCandidate } from "./price";
import type { Candidate, CandidatePrice } from "./types";

const ONE_PLUS_ONE: Promotion = { type: "X_PLUS_Y_FREE", buy: 1, free: 1 };
const TWO_PLUS_ONE: Promotion = { type: "X_PLUS_Y_FREE", buy: 2, free: 1 };
const SECOND_HALF_PRICE: Promotion = { type: "NTH_HALF_PRICE", n: 2 };
const TWO_FOR_300: Promotion = { type: "X_FOR_PRICE", quantity: 2, totalCents: 300 };
const QUARTER_OFF: Promotion = { type: "PERCENT_OFF", percent: 25 };
const PRICE_CUT: Promotion = { type: "PRICE_CUT" };

const GRAMS_500: Quantity = { amount: 500, unit: "g", count: 1, totalAmount: 500, approximate: false };

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    productId: "p1",
    retailerId: "ah",
    name: "Product",
    tier: "EXACT",
    regularPriceCents: 200,
    offer: null,
    quantity: null,
    isOrganic: false,
    ...overrides,
  };
}

function withOffer(
  promotion: Promotion,
  regularPriceCents: number | null,
  offerPriceCents: number | null = null,
  verified = true,
): Candidate {
  return candidate({
    regularPriceCents,
    offer: { offerId: "o1", promotion, offerPriceCents, verified, daysLeft: 2 },
  });
}

function priced(c: Candidate, quantity: number): CandidatePrice {
  const result = priceCandidate(c, quantity);
  if (!result.ok) throw new Error(`expected a price, got ${result.reason}`);
  return result.value;
}

describe("priceCandidate: promotion mechanics below, at and above the deal threshold", () => {
  it.each<[string, Candidate, number, number, boolean, number | null]>([
    // [label, candidate, quantity, totalCents, usedOffer, hint minimumQuantity]
    ["1+1 gratis below", withOffer(ONE_PLUS_ONE, 300), 1, 300, false, 2],
    ["1+1 gratis at", withOffer(ONE_PLUS_ONE, 300), 2, 300, true, null],
    ["1+1 gratis above", withOffer(ONE_PLUS_ONE, 300), 3, 600, true, null],
    ["2+1 gratis below", withOffer(TWO_PLUS_ONE, 100), 2, 200, false, 3],
    ["2+1 gratis at", withOffer(TWO_PLUS_ONE, 100), 3, 200, true, null],
    ["2+1 gratis above", withOffer(TWO_PLUS_ONE, 100), 4, 300, true, null],
    ["2e halve prijs below", withOffer(SECOND_HALF_PRICE, 199), 1, 199, false, 2],
    ["2e halve prijs at", withOffer(SECOND_HALF_PRICE, 199), 2, 299, true, null],
    ["2e halve prijs above", withOffer(SECOND_HALF_PRICE, 199), 3, 498, true, null],
    ["2 voor 3,00 below", withOffer(TWO_FOR_300, 199), 1, 199, false, 2],
    ["2 voor 3,00 at", withOffer(TWO_FOR_300, 199), 2, 300, true, null],
    ["2 voor 3,00 above", withOffer(TWO_FOR_300, 199), 3, 499, true, null],
    ["25% korting at", withOffer(QUARTER_OFF, 199), 1, 149, true, null],
    ["25% korting above", withOffer(QUARTER_OFF, 199), 2, 298, true, null],
    ["price cut at", withOffer(PRICE_CUT, 200, 150), 1, 150, true, null],
    ["price cut above", withOffer(PRICE_CUT, 200, 150), 3, 450, true, null],
  ])("%s", (_label, c, quantity, totalCents, usedOffer, minimumQuantity) => {
    const price = priced(c, quantity);
    expect(price.totalCents).toBe(totalCents);
    expect(price.usedOffer).toBe(usedOffer);
    expect(price.regularTotalCents).toBe(c.regularPriceCents === null ? null : c.regularPriceCents * quantity);
    expect(price.hint).toEqual(
      minimumQuantity === null ? null : { code: "buy-more-for-deal", minimumQuantity },
    );
  });
});

describe("priceCandidate", () => {
  it("prices a candidate without an offer at the regular price times the quantity", () => {
    expect(priced(candidate({ regularPriceCents: 125 }), 3)).toEqual({
      totalCents: 375,
      unitCents: 125,
      regularTotalCents: 375,
      usedOffer: false,
      assumed: false,
      unitPrice: null,
      hint: null,
    });
  });

  it("never lets an offer make a line more expensive than the regular price", () => {
    const price = priced(withOffer({ type: "X_FOR_PRICE", quantity: 2, totalCents: 500 }, 200), 2);
    expect(price).toMatchObject({ totalCents: 400, usedOffer: false });
  });

  it("does not count an offer that costs the same as the regular price", () => {
    expect(priced(withOffer(PRICE_CUT, 200, 200), 1)).toMatchObject({ totalCents: 200, usedOffer: false });
  });

  it("ignores an unverified offer for the price and for the hint", () => {
    expect(priced(withOffer(PRICE_CUT, 200, 150, false), 1)).toMatchObject({
      totalCents: 200,
      usedOffer: false,
      hint: null,
    });
    expect(priced(withOffer(ONE_PLUS_ONE, 300, null, false), 1).hint).toBeNull();
  });

  it("uses an offer when the regular price is unknown", () => {
    expect(priced(withOffer(PRICE_CUT, null, 150), 2)).toMatchObject({
      totalCents: 300,
      regularTotalCents: null,
      usedOffer: true,
    });
  });

  it("carries the assumed flag of an unknown promotion priced as a price cut", () => {
    const unknown: Promotion = { type: "UNKNOWN", text: "op=op" };
    expect(priced(withOffer(unknown, 200, 150), 1)).toMatchObject({ totalCents: 150, usedOffer: true, assumed: true });
    expect(priced(withOffer(unknown, 200, 250), 1)).toMatchObject({ totalCents: 200, usedOffer: false, assumed: false });
    expect(priced(withOffer(unknown, 200, null), 1)).toMatchObject({ totalCents: 200, hint: null });
  });

  it("rounds the unit price of a line half up", () => {
    expect(priced(withOffer(SECOND_HALF_PRICE, 199), 2).unitCents).toBe(150);
  });

  it("gives the price per kg, litre or piece of the whole line when the package size is known", () => {
    const c = { ...withOffer(SECOND_HALF_PRICE, 199), quantity: GRAMS_500 };
    expect(priced(c, 2).unitPrice).toEqual({ cents: 299, basis: "kg" });
  });

  it.each<[string, Candidate]>([
    ["no regular price and no offer", candidate({ regularPriceCents: null })],
    ["no regular price and an unverified offer", withOffer(PRICE_CUT, null, 150, false)],
    ["no regular price and an offer that needs one", withOffer(ONE_PLUS_ONE, null)],
  ])("cannot price a candidate with %s", (_label, c) => {
    expect(priceCandidate(c, 1)).toEqual({ ok: false, reason: "no-price" });
  });

  it.each<[string, () => unknown]>([
    ["quantity 0", () => priceCandidate(candidate(), 0)],
    ["a fractional quantity", () => priceCandidate(candidate(), 1.5)],
    ["a negative regular price", () => priceCandidate(candidate({ regularPriceCents: -1 }), 1)],
    ["a fractional regular price", () => priceCandidate(candidate({ regularPriceCents: 1.5 }), 1)],
    ["a negative offer price", () => priceCandidate(withOffer(PRICE_CUT, 200, -5), 1)],
    ["a negative offer price on an unverified offer", () => priceCandidate(withOffer(PRICE_CUT, 200, -5, false), 1)],
    [
      "a fractional deal total",
      () => priceCandidate(withOffer({ type: "X_FOR_PRICE", quantity: 2, totalCents: 2.5 }, 200), 1),
    ],
  ])("throws RangeError for %s", (_label, call) => {
    expect(call).toThrow(RangeError);
  });
});
