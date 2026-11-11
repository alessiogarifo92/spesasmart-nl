import { describe, expect, it } from "vitest";
import { describeOffer, type OfferFacts } from "./describe";

const today = "2026-11-11";
const base: OfferFacts = {
  promotion: { type: "PRICE_CUT" },
  currentPriceCents: 349,
  regularPriceCents: 499,
  validFrom: "2026-11-09",
  validUntil: "2026-11-15",
};

describe("describeOffer: state", () => {
  it("is running between its dates, with the days left", () => {
    expect(describeOffer(base, today)).toMatchObject({ state: "running", daysLeft: 4, startsInDays: null });
  });

  it("ends today on its last day, which is still valid", () => {
    expect(describeOffer({ ...base, validUntil: today }, today)).toMatchObject({ state: "ends-today", daysLeft: 0 });
  });

  it("counts the first day as running", () => {
    expect(describeOffer({ ...base, validFrom: today }, today).state).toBe("running");
  });

  it("is upcoming before its first day", () => {
    expect(describeOffer({ ...base, validFrom: "2026-11-16", validUntil: "2026-11-22" }, today)).toMatchObject({
      state: "upcoming",
      startsInDays: 5,
      daysLeft: 11,
    });
  });

  it("is expired the day after its last day", () => {
    expect(describeOffer({ ...base, validUntil: "2026-11-10" }, today)).toMatchObject({ state: "expired", daysLeft: -1 });
  });

  it("has unknown validity without an end date, even with a start", () => {
    expect(describeOffer({ ...base, validUntil: null }, today)).toMatchObject({
      state: "unknown-validity",
      daysLeft: null,
      startsInDays: null,
    });
  });

  it("treats a missing start as already started", () => {
    expect(describeOffer({ ...base, validFrom: null }, today).state).toBe("running");
  });

  it("counts days across a month and year boundary", () => {
    expect(describeOffer({ ...base, validFrom: "2026-12-28", validUntil: "2027-01-03" }, "2026-12-30").daysLeft).toBe(4);
  });
});

describe("describeOffer: estimates", () => {
  it("gives the discount of a plain price cut", () => {
    expect(describeOffer(base, today)).toMatchObject({
      shownPriceCents: 349,
      dealQuantity: 1,
      dealUnitCents: 349,
      discountPercent: 30,
    });
  });

  it("prices 1+1 gratis per item at two items and keeps the shelf price as the shown price", () => {
    const summary = describeOffer(
      { ...base, promotion: { type: "X_PLUS_Y_FREE", buy: 1, free: 1 }, currentPriceCents: null, regularPriceCents: 219 },
      today,
    );
    expect(summary).toMatchObject({ shownPriceCents: 219, dealQuantity: 2, dealUnitCents: 110, discountPercent: 50 });
  });

  it("prices 2e halve prijs per item at two items", () => {
    const summary = describeOffer(
      { ...base, promotion: { type: "NTH_HALF_PRICE", n: 2 }, currentPriceCents: null, regularPriceCents: 1199 },
      today,
    );
    // 1199 + 600 (half, rounded up) = 1799 for two; 899.5 per item rounds half up to 900.
    expect(summary).toMatchObject({ dealQuantity: 2, dealUnitCents: 900, discountPercent: 25 });
  });

  it("prices 2 voor 11,00 per item", () => {
    const summary = describeOffer(
      {
        ...base,
        promotion: { type: "X_FOR_PRICE", quantity: 2, totalCents: 1100 },
        currentPriceCents: null,
        regularPriceCents: 749,
      },
      today,
    );
    expect(summary).toMatchObject({ dealQuantity: 2, dealUnitCents: 550, discountPercent: 27 });
  });

  it("gives no estimate when the regular price a mechanic needs is unknown", () => {
    const summary = describeOffer(
      { ...base, promotion: { type: "X_PLUS_Y_FREE", buy: 1, free: 1 }, currentPriceCents: null, regularPriceCents: null },
      today,
    );
    expect(summary).toMatchObject({ shownPriceCents: null, dealUnitCents: null, discountPercent: null });
  });

  it("gives no discount when the regular price is unknown or not higher", () => {
    expect(describeOffer({ ...base, regularPriceCents: null }, today)).toMatchObject({
      dealUnitCents: 349,
      discountPercent: null,
    });
    expect(describeOffer({ ...base, regularPriceCents: 349 }, today).discountPercent).toBeNull();
  });

  it("never estimates an unrecognised mechanic, but still shows a stated price", () => {
    const summary = describeOffer({ ...base, promotion: { type: "UNKNOWN", text: "Actie!" } }, today);
    expect(summary).toMatchObject({ shownPriceCents: 349, dealUnitCents: null, discountPercent: null });
  });
});
