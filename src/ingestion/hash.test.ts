import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { NormalizedOffer } from "./adapter";
import { dedupeKeyHash, offerContentHash } from "./hash";

function offer(overrides: Partial<NormalizedOffer> = {}): NormalizedOffer {
  return {
    product: {
      externalId: "p1",
      name: "Kipfilet 500 g",
      brand: null,
      ean: null,
      quantity: null,
      categorySlug: null,
      isOrganic: false,
      attributes: {},
    },
    title: "Kipfilet 500 g",
    kind: "WEEKLY",
    promotion: { type: "X_FOR_PRICE", quantity: 2, totalCents: 500 },
    promoDescription: "2 voor 5,00",
    currentPriceCents: null,
    regularPriceCents: 349,
    validity: { start: "2026-11-09", end: "2026-11-15", approximate: false },
    conditions: null,
    sourceUrl: "https://shop.example.test/aanbiedingen",
    rawPayload: { collectedFrom: "page 1" },
    ...overrides,
  };
}

describe("offerContentHash", () => {
  it("is a SHA-256 hex digest", () => {
    expect(offerContentHash("jumbo", offer())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is the same for the same offer collected twice", () => {
    const again = offer({
      title: "  KIPFILET 500 g ",
      promotion: { totalCents: 500, quantity: 2, type: "X_FOR_PRICE" },
      sourceUrl: "https://shop.example.test/aanbiedingen?page=2",
      rawPayload: { collectedFrom: "page 2" },
      promoDescription: "2 VOOR 5,00",
      conditions: "Op = op",
    });
    expect(offerContentHash("jumbo", again)).toBe(offerContentHash("jumbo", offer()));
  });

  it.each<[string, Partial<NormalizedOffer>]>([
    ["the regular price", { regularPriceCents: 399 }],
    ["the current price", { currentPriceCents: 299 }],
    ["the mechanic", { promotion: { type: "X_FOR_PRICE", quantity: 3, totalCents: 500 } }],
    ["the validity start", { validity: { start: "2026-11-10", end: "2026-11-15", approximate: false } }],
    ["the validity end", { validity: { start: "2026-11-09", end: "2026-11-16", approximate: false } }],
    ["a missing validity", { validity: null }],
    ["the kind", { kind: "DAILY" }],
    ["the title", { title: "Kipfilet 1 kg" }],
  ])("changes with %s", (_, change) => {
    expect(offerContentHash("jumbo", offer(change))).not.toBe(offerContentHash("jumbo", offer()));
  });

  it("changes with the product and the retailer", () => {
    const other = offer({ product: { ...offer().product, externalId: "p2" } });
    expect(offerContentHash("jumbo", other)).not.toBe(offerContentHash("jumbo", offer()));
    expect(offerContentHash("dirk", offer())).not.toBe(offerContentHash("jumbo", offer()));
  });

  it("uses only the retailer and the dedupe key when one is set", () => {
    const keyed = offer({ dedupeKey: "offer-42" });
    const expected = createHash("sha256").update("jumbo:offer-42").digest("hex");
    expect(offerContentHash("jumbo", keyed)).toBe(expected);
    expect(offerContentHash("jumbo", { ...keyed, regularPriceCents: 999, validity: null })).toBe(expected);
    expect(dedupeKeyHash("jumbo", "offer-42")).toBe(expected);
  });
});
