import { describe, expect, it } from "vitest";
import type { NormalizedOffer } from "./adapter";
import { validateOffer } from "./validate";

const today = "2026-11-11";

function offer(overrides: Partial<NormalizedOffer> = {}): NormalizedOffer {
  return {
    product: {
      externalId: "p1",
      name: "Kipfilet 500 g",
      brand: null,
      ean: null,
      quantity: { amount: 500, unit: "g", count: 1, totalAmount: 500, approximate: false },
      categorySlug: "vlees-vis",
      isOrganic: false,
      attributes: {},
    },
    title: "Kipfilet 500 g",
    kind: "WEEKLY",
    promotion: { type: "PRICE_CUT" },
    promoDescription: null,
    currentPriceCents: 349,
    regularPriceCents: 499,
    validity: { start: "2026-11-09", end: "2026-11-15", approximate: false },
    conditions: null,
    sourceUrl: "https://shop.example.test/aanbiedingen",
    rawPayload: {},
    ...overrides,
  };
}

const withProduct = (product: Partial<NormalizedOffer["product"]>) =>
  offer({ product: { ...offer().product, ...product } });

describe("validateOffer", () => {
  it("verifies a complete offer with full confidence", () => {
    expect(validateOffer(offer(), { today })).toEqual({ status: "VERIFIED", confidence: 1, issues: [] });
  });

  it("verifies an offer that starts later or ends today", () => {
    expect(
      validateOffer(offer({ validity: { start: "2026-11-16", end: "2026-11-22", approximate: false } }), { today })
        .status,
    ).toBe("VERIFIED");
    expect(validateOffer(offer({ validity: { start: today, end: today, approximate: false } }), { today }).status).toBe(
      "VERIFIED",
    );
  });

  describe("rejects", () => {
    it.each<[string, NormalizedOffer, string]>([
      ["an empty product name", withProduct({ name: "  " }), "product-name-empty"],
      ["an empty title", offer({ title: "" }), "title-empty"],
      ["a zero price", offer({ currentPriceCents: 0 }), "price-out-of-range"],
      ["a negative regular price", offer({ regularPriceCents: -10 }), "price-out-of-range"],
      [
        "a price above 1000 euros",
        offer({ currentPriceCents: 100_001, regularPriceCents: 120_000 }),
        "price-out-of-range",
      ],
      [
        "a zero deal total",
        offer({ promotion: { type: "X_FOR_PRICE", quantity: 2, totalCents: 0 }, currentPriceCents: null }),
        "price-out-of-range",
      ],
      [
        "an offer that already ended",
        offer({ validity: { start: "2026-11-02", end: "2026-11-10", approximate: false } }),
        "expired",
      ],
    ])("%s", (_, input, issue) => {
      const verdict = validateOffer(input, { today });
      expect(verdict.status).toBe("REJECTED");
      expect(verdict.issues).toContain(issue);
    });

    it("accepts the price boundary of 1000 euros", () => {
      expect(
        validateOffer(offer({ currentPriceCents: 100_000, regularPriceCents: 100_000 }), { today }).status,
      ).not.toBe("REJECTED");
    });
  });

  describe("marks as unverified", () => {
    it("an offer without validity, never as verified", () => {
      const verdict = validateOffer(offer({ validity: null }), { today });
      expect(verdict).toEqual({ status: "UNVERIFIED", confidence: 0.7, issues: ["validity-unknown"] });
    });

    it("a validity read from a week number", () => {
      const verdict = validateOffer(
        offer({ validity: { start: "2026-11-09", end: "2026-11-15", approximate: true } }),
        { today },
      );
      expect(verdict).toEqual({ status: "UNVERIFIED", confidence: 0.8, issues: ["validity-approximate"] });
    });

    it("an unknown promotion", () => {
      const verdict = validateOffer(offer({ promotion: { type: "UNKNOWN", text: "Bonus Box" } }), { today });
      expect(verdict).toEqual({ status: "UNVERIFIED", confidence: 0.7, issues: ["promotion-unknown"] });
    });

    it("an offer whose price cannot be computed", () => {
      const verdict = validateOffer(
        offer({
          promotion: { type: "X_PLUS_Y_FREE", buy: 1, free: 1 },
          currentPriceCents: null,
          regularPriceCents: null,
        }),
        { today },
      );
      expect(verdict.status).toBe("UNVERIFIED");
      expect(verdict.issues).toEqual(["price-unknown", "regular-price-unknown"]);
      expect(verdict.confidence).toBe(0.9);
    });

    it("an offer whose regular price is below the offer price", () => {
      const verdict = validateOffer(offer({ currentPriceCents: 499, regularPriceCents: 349 }), { today });
      expect(verdict).toEqual({ status: "UNVERIFIED", confidence: 0.8, issues: ["regular-below-offer"] });
    });
  });

  describe("confidence", () => {
    it("drops for an unknown quantity but stays verified", () => {
      expect(validateOffer(withProduct({ quantity: null }), { today })).toEqual({
        status: "VERIFIED",
        confidence: 0.85,
        issues: ["quantity-unknown"],
      });
    });

    it("drops for an unknown regular price but stays verified", () => {
      expect(validateOffer(offer({ regularPriceCents: null }), { today })).toEqual({
        status: "VERIFIED",
        confidence: 0.9,
        issues: ["regular-price-unknown"],
      });
    });

    it("drops for a discount above 80%", () => {
      expect(validateOffer(offer({ currentPriceCents: 99, regularPriceCents: 999 }), { today })).toEqual({
        status: "VERIFIED",
        confidence: 0.9,
        issues: ["discount-implausible"],
      });
    });

    it("prices a mechanic from the regular price", () => {
      const twoForOne = offer({ promotion: { type: "X_PLUS_Y_FREE", buy: 1, free: 1 }, currentPriceCents: null });
      expect(validateOffer(twoForOne, { today })).toEqual({ status: "VERIFIED", confidence: 1, issues: [] });
    });

    it("adds up and is rounded to two decimals", () => {
      const worst = offer({
        product: { ...offer().product, quantity: null },
        promotion: { type: "UNKNOWN", text: "?" },
        currentPriceCents: 499,
        regularPriceCents: 349,
        validity: null,
      });
      const verdict = validateOffer(worst, { today });
      expect(verdict.status).toBe("UNVERIFIED");
      expect(verdict.confidence).toBe(0.05);
      expect(verdict.issues).toEqual([
        "validity-unknown",
        "promotion-unknown",
        "quantity-unknown",
        "regular-below-offer",
      ]);
    });
  });
});
