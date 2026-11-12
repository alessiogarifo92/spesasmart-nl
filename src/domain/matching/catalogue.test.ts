import { describe, expect, it } from "vitest";
import { unitPrice, type Quantity } from "@/domain/pricing";
// Test data only: the demo catalogue is plain data with no imports of its own.
import { DEMO_PRODUCTS, demoEan, type DemoRetailerSlug } from "@/ingestion/adapters/mock/catalogue";
import { matchProducts } from "./match";
import type { MatchProduct } from "./types";

const UNITS = { G: "g", ML: "ml", PIECE: "piece" } as const;

/** One chain's listing of a demo concept, as the matcher would receive it from the database. */
function listing(concept: string, retailer: DemoRetailerSlug, overrides: Partial<MatchProduct> = {}): MatchProduct {
  const demo = DEMO_PRODUCTS.find((p) => p.concept === concept);
  const variant = demo?.variants[retailer];
  if (!demo || !variant) throw new Error(`no demo listing ${concept} at ${retailer}`);
  const count = demo.packageCount ?? 1;
  const quantity: Quantity = {
    amount: demo.packageAmount,
    unit: UNITS[demo.unit],
    count,
    totalAmount: demo.packageAmount * count,
    approximate: false,
  };
  return {
    id: `${retailer}:${concept}`,
    retailerId: retailer,
    name: variant.name,
    brand: demo.brand ?? null,
    ean: demo.ean ?? null,
    categorySlug: demo.category,
    quantity,
    isOrganic: demo.isOrganic ?? false,
    unitPrice: unitPrice(variant.regularCents, quantity),
    ...overrides,
  };
}

function chainsOf(concept: string): DemoRetailerSlug[] {
  const demo = DEMO_PRODUCTS.find((p) => p.concept === concept);
  return Object.keys(demo?.variants ?? {}) as DemoRetailerSlug[];
}

function litres(totalAmount: number): Quantity {
  return { amount: totalAmount, unit: "ml", count: 1, totalAmount, approximate: false };
}

describe("matchProducts on the demo catalogue", () => {
  it("Molenhof koffiebonen AH vs Jumbo: one barcode, so SAME with confidence 1", () => {
    expect(
      matchProducts(listing("molenhof-koffiebonen-1kg", "ah"), listing("molenhof-koffiebonen-1kg", "jumbo")),
    ).toEqual({
      type: "SAME",
      confidence: 1,
      status: "AUTO",
      nameScore: 1,
      signals: ["ean-equal", "brand-equal", "size-equal", "category-equal"],
    });
  });

  it("Molenhof 'Aroma bonen' at Dirk: the barcode decides; 'bonen' inside 'koffiebonen' scores 0.8, so the name is 0.9", () => {
    const match = matchProducts(listing("molenhof-koffiebonen-1kg", "dirk"), listing("molenhof-koffiebonen-1kg", "ah"));
    expect(match).toMatchObject({ type: "SAME", confidence: 1, nameScore: 0.9 });
  });

  it("Bruisbron cola 6 x 330 ml at AH, Jumbo and Vomar: the multipack forms all reduce to 'cola', one barcode", () => {
    const ah = listing("bruisbron-cola-6x330ml", "ah");
    for (const other of [listing("bruisbron-cola-6x330ml", "jumbo"), listing("bruisbron-cola-6x330ml", "vomar")]) {
      expect(matchProducts(ah, other)).toEqual({
        type: "SAME",
        confidence: 1,
        status: "AUTO",
        nameScore: 1,
        signals: ["ean-equal", "brand-equal", "size-equal", "category-equal"],
      });
    }
  });

  it("'Halfvolle melk 1 L' (AH) vs 'Melk halfvol 1 liter' (Jumbo): full name score but no brand, so SIMILAR 0.93, AUTO", () => {
    // 0.55 × 1 + 0.15 × 0.5 + 0.15 + 0.10 + 0.05 = 0.925 → 0.93.
    expect(matchProducts(listing("halfvolle-melk-1l", "ah"), listing("halfvolle-melk-1l", "jumbo"))).toEqual({
      type: "SIMILAR",
      confidence: 0.93,
      status: "AUTO",
      nameScore: 1,
      signals: ["brand-unknown", "size-equal", "category-equal"],
    });
  });

  it("'Griekse yoghurt naturel' vs 'Yoghurt Griekse stijl': 2 of 3 words, so SIMILAR 0.74, AUTO", () => {
    // naturel and stijl do not match: 2/3 → 0.67; 0.55 × 0.67 + 0.075 + 0.15 + 0.10 + 0.05 = 0.7435.
    expect(
      matchProducts(listing("griekse-yoghurt-500g", "ah"), listing("griekse-yoghurt-500g", "jumbo")),
    ).toMatchObject({
      type: "SIMILAR",
      confidence: 0.74,
      status: "AUTO",
      nameScore: 0.67,
    });
  });

  it("'Scharreleieren 10 stuks' vs 'Vrije uitloop eieren 10 stuks': only the compound 0.8 over 3 words, so no match", () => {
    // 0.8 / 3 = 0.27, under the ALTERNATIVE name score of 0.5. Barn and free-range eggs are different products.
    expect(matchProducts(listing("eieren-10", "jumbo"), listing("eieren-10", "ah"))).toBeNull();
  });

  it("'Eieren vrije uitloop M 10 st' (Vomar) vs 'Vrije uitloop eieren' (AH): 3 of 4 words, size letter M left over", () => {
    // 0.55 × 0.75 + 0.075 + 0.15 + 0.10 + 0.05 = 0.7875 → 0.79.
    expect(matchProducts(listing("eieren-10", "vomar"), listing("eieren-10", "ah"))).toMatchObject({
      type: "SIMILAR",
      confidence: 0.79,
      nameScore: 0.75,
    });
  });

  it("organic vs non-organic havermout is at most an ALTERNATIVE", () => {
    const organic = listing("bio-havermout-500g", "ah");
    // A non-organic havermout at Jumbo; not in the catalogue, which only has the organic one.
    const plain = listing("bio-havermout-500g", "jumbo", { name: "Havermout 500 gram", isOrganic: false });
    // "Biologische" is not part of the name, so the names are equal; the organic flag is what differs:
    // 0.55 + 0.075 + 0.15 + 0.10 + 0 = 0.875 → 0.88. Shown, but as an alternative.
    expect(matchProducts(organic, plain)).toEqual({
      type: "ALTERNATIVE",
      confidence: 0.88,
      status: "AUTO",
      nameScore: 1,
      signals: ["brand-unknown", "size-equal", "category-equal", "organic-different"],
    });
    // The same with an identical name.
    const sameName = listing("bio-havermout-500g", "jumbo", { name: organic.name, isOrganic: false });
    expect(matchProducts(organic, sameName)).toMatchObject({ type: "ALTERNATIVE", confidence: 0.88 });
  });

  it("organic havermout at AH and Jumbo: 'biologische' and 'biologisch' are not part of the name, so SIMILAR 0.93", () => {
    expect(matchProducts(listing("bio-havermout-500g", "ah"), listing("bio-havermout-500g", "jumbo"))).toMatchObject({
      type: "SIMILAR",
      confidence: 0.93,
      nameScore: 1,
    });
  });

  it("kipfilet vs halfvolle melk: different categories, so no match", () => {
    expect(matchProducts(listing("kipfilet-500g", "ah"), listing("halfvolle-melk-1l", "jumbo"))).toBeNull();
  });

  it("halfvolle melk 1 L vs 2 L: same name, twice the size, so ALTERNATIVE 0.81", () => {
    const twoLitres = listing("halfvolle-melk-1l", "jumbo", {
      name: "Halfvolle melk 2 liter",
      quantity: litres(2000),
      unitPrice: unitPrice(219, litres(2000)),
    });
    // 0.55 + 0.075 + 0.15 × 0.25 + 0.10 + 0.05 = 0.8125 → 0.81.
    expect(matchProducts(listing("halfvolle-melk-1l", "ah"), twoLitres)).toEqual({
      type: "ALTERNATIVE",
      confidence: 0.81,
      status: "AUTO",
      nameScore: 1,
      signals: ["brand-unknown", "size-different", "category-equal"],
    });
  });

  it("same brand and name but a different barcode is never SAME", () => {
    const other = listing("molenhof-koffiebonen-1kg", "jumbo", { ean: demoEan(99) });
    const match = matchProducts(listing("molenhof-koffiebonen-1kg", "ah"), other);
    expect(match?.type).toBe("SIMILAR");
    expect(match?.signals).toEqual(["ean-different", "brand-equal", "size-equal", "category-equal"]);
    // Every component is at its maximum; two known, different barcodes take 0.2 off.
    expect(match?.confidence).toBe(0.8);
    expect(match?.status).toBe("AUTO");
  });

  it("bananas are never shown as a match for vine tomatoes", () => {
    // "tros" is not "trostomaten": the first half of a compound is not the same word.
    expect(matchProducts(listing("bananen-1kg", "jumbo"), listing("trostomaten-500g", "ah"))).toBeNull();
    for (const bananas of chainsOf("bananen-1kg")) {
      for (const tomatoes of chainsOf("trostomaten-500g")) {
        if (bananas === tomatoes) continue;
        const match = matchProducts(listing("bananen-1kg", bananas), listing("trostomaten-500g", tomatoes));
        // "Bananen tros" and "Tros tomaten" do share one word of two: that pair waits for a person.
        expect(match === null || match.status === "NEEDS_REVIEW", `${bananas} / ${tomatoes}`).toBe(true);
      }
    }
  });

  it("the same thing written differently is SIMILAR and shown without review", () => {
    // One word or two ("Trostomaten" / "Tros tomaten"), packaging ("bakje", "tube"), "per kilo".
    for (const concept of ["trostomaten-500g", "tandpasta-75ml", "volkoren-brood-800g"]) {
      const chains = chainsOf(concept);
      const pairs = chains.flatMap((a) => chains.filter((b) => a < b).map((b) => [a, b] as const));
      const outcomes = pairs.map(([a, b]) => matchProducts(listing(concept, a), listing(concept, b)));
      expect(
        outcomes.filter((match) => match?.type === "SIMILAR" && match.status === "AUTO").length,
        concept,
      ).toBeGreaterThan(0);
    }
    expect(matchProducts(listing("trostomaten-500g", "ah"), listing("trostomaten-500g", "vomar"))).toMatchObject({
      type: "SIMILAR",
      nameScore: 1,
      status: "AUTO",
    });
    expect(matchProducts(listing("bananen-1kg", "ah"), listing("bananen-1kg", "dirk"))).toMatchObject({
      type: "SIMILAR",
      nameScore: 1,
    });
  });

  it("never links listings of two different concepts as SAME", () => {
    const listings = DEMO_PRODUCTS.flatMap((demo) =>
      (Object.keys(demo.variants) as DemoRetailerSlug[]).map((retailer) => ({
        concept: demo.concept,
        product: listing(demo.concept, retailer),
      })),
    );
    for (const a of listings) {
      for (const b of listings) {
        if (a.concept === b.concept) continue;
        expect(matchProducts(a.product, b.product)?.type, `${a.product.id} / ${b.product.id}`).not.toBe("SAME");
      }
    }
  });
});
