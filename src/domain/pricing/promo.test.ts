import { describe, expect, it } from "vitest";
import {
  discountPercent,
  effectiveTotalCents,
  effectiveUnitCents,
  minimumQuantityForDeal,
  parsePromotion,
  type Promotion,
} from "./promo";

const ONE_PLUS_ONE: Promotion = { type: "X_PLUS_Y_FREE", buy: 1, free: 1 };
const TWO_PLUS_ONE: Promotion = { type: "X_PLUS_Y_FREE", buy: 2, free: 1 };
const SECOND_HALF_PRICE: Promotion = { type: "NTH_HALF_PRICE", n: 2 };
const TWO_FOR_300: Promotion = { type: "X_FOR_PRICE", quantity: 2, totalCents: 300 };

describe("parsePromotion", () => {
  it.each<[string, Promotion]>([
    ["1+1 gratis", ONE_PLUS_ONE],
    ["1 + 1 GRATIS", ONE_PLUS_ONE],
    ["1+1 DIEPVRIES GRATIS", ONE_PLUS_ONE],
    ["2+1 gratis", TWO_PLUS_ONE],
    ["3+1 gratis", { type: "X_PLUS_Y_FREE", buy: 3, free: 1 }],
    ["2e gratis", ONE_PLUS_ONE],
    ["3de gratis", TWO_PLUS_ONE],
    ["2 halen, 1 betalen", ONE_PLUS_ONE],
    ["3 halen 2 betalen", TWO_PLUS_ONE],
    ["2e halve prijs", SECOND_HALF_PRICE],
    ["2e HALVE PRIJS", SECOND_HALF_PRICE],
    ["2de halve prijs", SECOND_HALF_PRICE],
    ["Tweede halve prijs", SECOND_HALF_PRICE],
    ["2e artikel halve prijs", SECOND_HALF_PRICE],
    ["2 voor 3,00", TWO_FOR_300],
    ["2 voor € 3,00", TWO_FOR_300],
    ["3 voor € 5", { type: "X_FOR_PRICE", quantity: 3, totalCents: 500 }],
    ["3 voor 5 euro", { type: "X_FOR_PRICE", quantity: 3, totalCents: 500 }],
    ["3 stuks 5.-", { type: "X_FOR_PRICE", quantity: 3, totalCents: 500 }],
    ["2 voor 2,50", { type: "X_FOR_PRICE", quantity: 2, totalCents: 250 }],
    ["2 pakken voor 4.-", { type: "X_FOR_PRICE", quantity: 2, totalCents: 400 }],
    ["25% korting", { type: "PERCENT_OFF", percent: 25 }],
    ["50% KORTING", { type: "PERCENT_OFF", percent: 50 }],
    ["25 % korting", { type: "PERCENT_OFF", percent: 25 }],
    ["12,5% korting", { type: "PERCENT_OFF", percent: 12.5 }],
    ["30% extra korting", { type: "PERCENT_OFF", percent: 30 }],
    ["Actieprijs", { type: "PRICE_CUT" }],
    ["van 2,49 voor 1,99", { type: "PRICE_CUT" }],
    ["  1+1 gratis  ", ONE_PLUS_ONE],
  ])("reads %j", (text, expected) => {
    expect(parsePromotion(text)).toEqual(expected);
  });

  it.each([
    ["", "empty"],
    ["op=op", "no mechanic"],
    ["1 euro korting", "amount off is not a known mechanic"],
    ["25% korting op de 2e", "a second-item discount, not per item"],
    ["1+1 gratis en 2e halve prijs", "two mechanics"],
    ["2 voor 2,00 of 3 voor 2,50", "two offers"],
    ["0+1 gratis", "buy nothing"],
    ["1+0 gratis", "nothing free"],
    ["1e gratis", "first item free"],
    ["1e halve prijs", "first item half price"],
    ["2 halen 2 betalen", "nothing free"],
    ["0% korting", "zero percent"],
    ["100% korting", "free"],
    ["120% korting", "over 100 percent"],
    ["0 voor 3,00", "zero items"],
    ["2 voor 1,2", "unreadable price"],
    ["2 voor 0,00", "zero price"],
    ["van 2 voor 1,99", "price cut or two-for-price"],
    ["van 2,4 voor 1,99", "unreadable regular price"],
    ["1+1", "no gratis"],
  ])("returns UNKNOWN with the original text for %j (%s)", (text) => {
    expect(parsePromotion(text)).toEqual({ type: "UNKNOWN", text });
  });
});

describe("effectiveTotalCents", () => {
  const regular = 199;

  function total(promotion: Promotion, quantity: number, prices = {}) {
    return effectiveTotalCents({ promotion, regularPriceCents: regular, quantity, ...prices });
  }

  it.each([
    [1, 199],
    [2, 199],
    [3, 398],
    [4, 398],
  ])("1+1 gratis for %i items costs %i", (quantity, cents) => {
    expect(total(ONE_PLUS_ONE, quantity)).toEqual({ ok: true, value: { totalCents: cents, assumed: false } });
  });

  it.each([
    [1, 199],
    [2, 398],
    [3, 398],
    [4, 597],
    [6, 796],
  ])("2+1 gratis for %i items costs %i", (quantity, cents) => {
    expect(total(TWO_PLUS_ONE, quantity)).toEqual({ ok: true, value: { totalCents: cents, assumed: false } });
  });

  it.each([
    [1, 199],
    [2, 299],
    [3, 498],
    [4, 597],
  ])("2e halve prijs for %i items costs %i (1, 1.5, 2.5, 3 times, half up)", (quantity, cents) => {
    expect(total(SECOND_HALF_PRICE, quantity)).toEqual({
      ok: true,
      value: { totalCents: cents, assumed: false },
    });
  });

  it("2e halve prijs is exact on an even price", () => {
    expect(effectiveTotalCents({ promotion: SECOND_HALF_PRICE, regularPriceCents: 200, quantity: 3 })).toEqual({
      ok: true,
      value: { totalCents: 500, assumed: false },
    });
  });

  it.each([
    [1, 199],
    [2, 300],
    [3, 499],
    [4, 600],
  ])("2 voor 3,00 for %i items costs %i", (quantity, cents) => {
    expect(total(TWO_FOR_300, quantity)).toEqual({ ok: true, value: { totalCents: cents, assumed: false } });
  });

  it("X voor P needs no regular price for complete groups", () => {
    expect(effectiveTotalCents({ promotion: TWO_FOR_300, quantity: 4 })).toEqual({
      ok: true,
      value: { totalCents: 600, assumed: false },
    });
  });

  it("X voor P needs the regular price for leftovers", () => {
    expect(effectiveTotalCents({ promotion: TWO_FOR_300, quantity: 3 })).toEqual({
      ok: false,
      reason: "missing-regular-price",
    });
  });

  it("applies a percentage per item, rounding each item half up", () => {
    const quarterOff: Promotion = { type: "PERCENT_OFF", percent: 25 };
    const halfOff: Promotion = { type: "PERCENT_OFF", percent: 50 };
    // 199 × 0.75 = 149.25 → 149 per item
    expect(total(quarterOff, 2)).toEqual({ ok: true, value: { totalCents: 298, assumed: false } });
    // 199 × 0.5 = 99.5 → 100 per item
    expect(total(halfOff, 3)).toEqual({ ok: true, value: { totalCents: 300, assumed: false } });
    // 199 × 0.875 = 174.125 → 174
    expect(total({ type: "PERCENT_OFF", percent: 12.5 }, 1)).toEqual({
      ok: true,
      value: { totalCents: 174, assumed: false },
    });
  });

  it("uses the offer price per item for a price cut", () => {
    expect(total({ type: "PRICE_CUT" }, 3, { offerPriceCents: 149 })).toEqual({
      ok: true,
      value: { totalCents: 447, assumed: false },
    });
  });

  it("treats an unknown promotion with an offer price as a price cut, flagged as assumed", () => {
    expect(total({ type: "UNKNOWN", text: "op=op" }, 2, { offerPriceCents: 149 })).toEqual({
      ok: true,
      value: { totalCents: 298, assumed: true },
    });
  });

  it("cannot compute an unknown promotion without an offer price", () => {
    expect(total({ type: "UNKNOWN", text: "op=op" }, 2)).toEqual({ ok: false, reason: "unknown-promotion" });
  });

  it.each<[Promotion, string]>([
    [ONE_PLUS_ONE, "1+1"],
    [SECOND_HALF_PRICE, "2e halve prijs"],
    [{ type: "PERCENT_OFF", percent: 25 }, "percent off"],
  ])("needs the regular price for %s even when an offer price is known", (promotion) => {
    expect(
      effectiveTotalCents({ promotion, regularPriceCents: null, offerPriceCents: 149, quantity: 2 }),
    ).toEqual({ ok: false, reason: "missing-regular-price" });
  });

  it("needs the offer price for a price cut", () => {
    expect(total({ type: "PRICE_CUT" }, 1)).toEqual({ ok: false, reason: "missing-offer-price" });
    expect(total({ type: "PRICE_CUT" }, 1, { offerPriceCents: null })).toEqual({
      ok: false,
      reason: "missing-offer-price",
    });
  });

  it("refuses an invalid quantity or price", () => {
    expect(() => total(ONE_PLUS_ONE, 0)).toThrow(RangeError);
    expect(() => total(ONE_PLUS_ONE, 1.5)).toThrow(RangeError);
    expect(() => total(ONE_PLUS_ONE, -1)).toThrow(RangeError);
    expect(() => effectiveTotalCents({ promotion: ONE_PLUS_ONE, regularPriceCents: 1.5, quantity: 1 })).toThrow(
      RangeError,
    );
    expect(() => total({ type: "PRICE_CUT" }, 1, { offerPriceCents: -1 })).toThrow(RangeError);
  });
});

describe("effectiveUnitCents", () => {
  it("divides the total by the quantity, rounding half up", () => {
    // 1+1 on 199: 199 for 2 = 99.5 → 100
    expect(effectiveUnitCents({ promotion: ONE_PLUS_ONE, regularPriceCents: 199, quantity: 2 })).toEqual({
      ok: true,
      value: { unitCents: 100, assumed: false },
    });
    // 2 voor 3,00: 150 each
    expect(effectiveUnitCents({ promotion: TWO_FOR_300, quantity: 2 })).toEqual({
      ok: true,
      value: { unitCents: 150, assumed: false },
    });
  });

  it("carries the assumed flag", () => {
    expect(
      effectiveUnitCents({ promotion: { type: "UNKNOWN", text: "?" }, offerPriceCents: 149, quantity: 1 }),
    ).toEqual({ ok: true, value: { unitCents: 149, assumed: true } });
  });

  it("passes on a not-computable result", () => {
    expect(effectiveUnitCents({ promotion: ONE_PLUS_ONE, quantity: 2 })).toEqual({
      ok: false,
      reason: "missing-regular-price",
    });
  });
});

describe("discountPercent", () => {
  it.each([
    [200, 150, 25],
    [199, 100, 50],
    [199, 149, 25],
    [300, 299, 0],
    [199, 0, 100],
  ])("from %i to %i cents is %i%%", (regular, effective, percent) => {
    expect(discountPercent(regular, effective)).toBe(percent);
  });

  it.each<[number | null, number, string]>([
    [null, 100, "regular price missing"],
    [100, 100, "no discount"],
    [100, 150, "more expensive"],
    [0, 0, "regular price zero"],
  ])("is null for %j → %j (%s)", (regular, effective) => {
    expect(discountPercent(regular, effective)).toBeNull();
  });
});

describe("minimumQuantityForDeal", () => {
  it.each<[Promotion, number | null]>([
    [ONE_PLUS_ONE, 2],
    [TWO_PLUS_ONE, 3],
    [{ type: "X_PLUS_Y_FREE", buy: 3, free: 1 }, 4],
    [SECOND_HALF_PRICE, 2],
    [TWO_FOR_300, 2],
    [{ type: "X_FOR_PRICE", quantity: 3, totalCents: 500 }, 3],
    [{ type: "PERCENT_OFF", percent: 25 }, 1],
    [{ type: "PRICE_CUT" }, 1],
    [{ type: "UNKNOWN", text: "op=op" }, null],
  ])("is right for %j", (promotion, expected) => {
    expect(minimumQuantityForDeal(promotion)).toBe(expected);
  });
});
