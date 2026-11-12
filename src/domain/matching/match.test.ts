import { describe, expect, it } from "vitest";
import type { Quantity, UnitPrice } from "@/domain/pricing";
import { AUTO_THRESHOLD, findMatches, matchProducts, MIN_CONFIDENCE } from "./match";
import type { MatchProduct } from "./types";

// Valid barcodes: two EAN-13s, and a UPC-A that normalises to the zero-padded EAN-13 beside it.
const EAN_A = "4006381333931";
const EAN_B = "5901234123457";
const UPC = "036000291452";
const UPC_AS_EAN = "0036000291452";
/** EAN_A with a wrong check digit. */
const EAN_BAD = "4006381333932";

function size(totalAmount: number, unit: Quantity["unit"] = "g", count = 1): Quantity {
  return { amount: totalAmount / count, unit, count, totalAmount, approximate: false };
}

function perKg(cents: number): UnitPrice {
  return { cents, basis: "kg" };
}

type Extras = Partial<Omit<MatchProduct, "id" | "retailerId">>;

function product(id: string, retailerId: string, extras: Extras = {}): MatchProduct {
  return {
    id,
    retailerId,
    name: "Appel peer",
    brand: null,
    ean: null,
    categorySlug: "groente-fruit",
    quantity: size(1000),
    isOrganic: false,
    unitPrice: null,
    ...extras,
  };
}

/** Matches an AH listing against a Jumbo listing; both start from the defaults above. */
function pair(a: Extras, b: Extras = {}) {
  return matchProducts(product("a", "ah", a), product("b", "jumbo", b));
}

describe("matchProducts: products that are never compared", () => {
  it("returns null for the same id", () => {
    const listing = product("a", "ah", { ean: EAN_A });
    expect(matchProducts(listing, listing)).toBeNull();
    expect(matchProducts(listing, { ...listing, retailerId: "jumbo" })).toBeNull();
  });

  it("returns null for two listings of the same chain, even with one barcode", () => {
    expect(matchProducts(product("a", "ah", { ean: EAN_A }), product("b", "ah", { ean: EAN_A }))).toBeNull();
  });
});

describe("matchProducts: barcode", () => {
  it("links equal barcodes as SAME with confidence 1, whatever else differs", () => {
    const match = pair(
      {
        ean: EAN_A,
        name: "Kipfilet",
        brand: "Molenhof",
        categorySlug: "vlees-vis",
        quantity: size(500),
        isOrganic: true,
      },
      {
        ean: EAN_A,
        name: "Halfvolle melk",
        brand: "Bruisbron",
        categorySlug: "zuivel-eieren",
        quantity: size(1000, "ml"),
      },
    );
    expect(match).toEqual({
      type: "SAME",
      confidence: 1,
      status: "AUTO",
      nameScore: 0,
      signals: ["ean-equal", "brand-different", "size-different", "organic-different"],
    });
  });

  it("compares normalised barcodes: a UPC-A equals its zero-padded EAN-13", () => {
    expect(pair({ ean: UPC }, { ean: UPC_AS_EAN })?.signals).toContain("ean-equal");
    expect(pair({ ean: " 4006 3813 33931 " }, { ean: EAN_A })?.signals).toContain("ean-equal");
  });

  it("marks two valid, different barcodes", () => {
    expect(pair({ ean: EAN_A }, { ean: EAN_B })?.signals).toContain("ean-different");
    // Two known, different barcodes cost 0.2 of confidence; one unknown barcode costs nothing.
    const known = pair({ ean: EAN_A }, { ean: EAN_B });
    const unknown = pair({ ean: EAN_A }, {});
    expect(Math.round((unknown!.confidence - known!.confidence) * 100)).toBe(20);
  });

  it("treats an invalid barcode as unknown, even when both carry the same invalid string", () => {
    const match = pair({ ean: EAN_BAD }, { ean: EAN_BAD });
    expect(match?.signals.some((s) => s.startsWith("ean-"))).toBe(false);
    expect(match?.type).not.toBe("SAME");
    expect(pair({ ean: EAN_BAD }, { ean: EAN_A })?.signals.some((s) => s.startsWith("ean-"))).toBe(false);
  });

  it("gives no barcode signal when one side has none", () => {
    expect(pair({ ean: EAN_A }, { ean: null })?.signals.some((s) => s.startsWith("ean-"))).toBe(false);
  });
});

describe("matchProducts: signals", () => {
  it("compares brands after normalisation", () => {
    expect(pair({ brand: "Molenhof" }, { brand: " MOLENHOF" })?.signals).toContain("brand-equal");
    expect(pair({ brand: "Café Noir" }, { brand: "cafe noir" })?.signals).toContain("brand-equal");
    expect(pair({ brand: "Molenhof" }, { brand: "Bruisbron" })?.signals).toContain("brand-different");
    expect(pair({ brand: "Molenhof" }, { brand: null })?.signals).toContain("brand-unknown");
    expect(pair({ brand: null }, { brand: null })?.signals).toContain("brand-unknown");
    // A brand with nothing left after normalisation is not a brand.
    expect(pair({ brand: "–" }, { brand: "!" })?.signals).toContain("brand-unknown");
  });

  it("calls sizes within 2% equal", () => {
    expect(pair({ quantity: size(1000) }, { quantity: size(1000) })?.signals).toContain("size-equal");
    expect(pair({ quantity: size(1000) }, { quantity: size(1020) })?.signals).toContain("size-equal");
    expect(pair({ quantity: size(1021) }, { quantity: size(1000) })?.signals).toContain("size-close");
  });

  it("compares the total of a multipack", () => {
    expect(pair({ quantity: size(1980, "ml", 6) }, { quantity: size(1980, "ml", 1) })?.signals).toContain("size-equal");
  });

  it("calls sizes up to 1.25 times apart close, and further apart different", () => {
    expect(pair({ quantity: size(1000) }, { quantity: size(1250) })?.signals).toContain("size-close");
    expect(pair({ quantity: size(1000) }, { quantity: size(1251) })?.signals).toContain("size-different");
  });

  it("marks a size unknown when either side has none", () => {
    expect(pair({ quantity: null }, { quantity: size(1000) })?.signals).toContain("size-unknown");
    expect(pair({ quantity: null }, { quantity: null })?.signals).toContain("size-unknown");
  });

  it("marks categories equal, or unknown when either is missing", () => {
    expect(pair({}, {})?.signals).toContain("category-equal");
    expect(pair({ categorySlug: null }, {})?.signals).toContain("category-unknown");
    expect(pair({ categorySlug: null }, { categorySlug: null })?.signals).toContain("category-unknown");
  });

  it("marks a difference in organic", () => {
    expect(pair({ isOrganic: true }, { isOrganic: false })?.signals).toContain("organic-different");
    expect(pair({ isOrganic: true }, { isOrganic: true })?.signals).not.toContain("organic-different");
  });

  it("marks a price gap when the dearer unit price is more than 3 times the cheaper", () => {
    expect(pair({ unitPrice: perKg(100) }, { unitPrice: perKg(301) })?.signals).toContain("price-gap");
    expect(pair({ unitPrice: perKg(0) }, { unitPrice: perKg(1) })?.signals).toContain("price-gap");
    expect(pair({ unitPrice: perKg(100) }, { unitPrice: perKg(300) })?.signals).not.toContain("price-gap");
    expect(pair({ unitPrice: perKg(0) }, { unitPrice: perKg(0) })?.signals).not.toContain("price-gap");
    expect(pair({ unitPrice: null }, { unitPrice: perKg(900) })?.signals).not.toContain("price-gap");
    const otherBasis = pair(
      { quantity: null, unitPrice: perKg(100) },
      { quantity: null, unitPrice: { cents: 900, basis: "l" } },
    );
    expect(otherBasis?.signals).not.toContain("price-gap");
  });

  it("lists signals in the fixed order", () => {
    const match = pair(
      { ean: EAN_A, brand: "Molenhof", quantity: size(1000), isOrganic: true, unitPrice: perKg(100) },
      { ean: EAN_B, brand: "Molenhof", quantity: size(1100), unitPrice: perKg(400) },
    );
    expect(match?.signals).toEqual([
      "ean-different",
      "brand-equal",
      "size-close",
      "category-equal",
      "organic-different",
      "price-gap",
    ]);
  });
});

describe("matchProducts: hard stops", () => {
  it("never links two known, different categories", () => {
    expect(pair({ categorySlug: "groente-fruit" }, { categorySlug: "voorraadkast" })).toBeNull();
  });

  it("links different categories when the barcodes are equal, without a category signal", () => {
    const match = pair({ ean: EAN_A, categorySlug: "groente-fruit" }, { ean: EAN_A, categorySlug: "voorraadkast" });
    expect(match?.type).toBe("SAME");
    expect(match?.signals.some((s) => s.startsWith("category-"))).toBe(false);
  });

  it("never links grams with millilitres or pieces", () => {
    expect(pair({ quantity: size(1000, "g") }, { quantity: size(1000, "ml") })).toBeNull();
    expect(pair({ quantity: size(10, "piece") }, { quantity: size(10, "g") })).toBeNull();
  });

  it("links different units when the barcodes are equal, as a size difference", () => {
    const match = pair({ ean: EAN_A, quantity: size(1000, "g") }, { ean: EAN_A, quantity: size(1000, "ml") });
    expect(match?.type).toBe("SAME");
    expect(match?.signals).toContain("size-different");
  });
});

// Token sets with a known name score. The words share no prefix, compound or close trigrams,
// except "scharreleieren"/"eieren" (0.8). Every test asserts the score it relies on.
const NAMES = {
  "4/5": ["Appel peer kiwi mango banaan", "Appel peer kiwi mango citroen"],
  "3/4": ["Appel peer kiwi mango", "Appel peer kiwi citroen"],
  "4/6": ["Appel peer kiwi mango banaan citroen", "Appel peer kiwi mango druif ananas"],
  "2.8/4": ["Appel peer scharreleieren kiwi", "Appel peer eieren mango"],
  "3/5": ["Appel peer kiwi mango banaan", "Appel peer kiwi citroen druif"],
  "4/7": ["Appel peer kiwi mango banaan citroen druif", "Appel peer kiwi mango ananas perzik limoen"],
  "3/6": ["Appel peer kiwi mango banaan citroen", "Appel peer kiwi druif ananas perzik"],
  "1/2": ["Appel peer", "Appel citroen"],
  "1.8/4": ["Appel scharreleieren peer kiwi", "Appel eieren mango citroen"],
} as const;

function named(key: keyof typeof NAMES, a: Extras = {}, b: Extras = {}) {
  const [nameA, nameB] = NAMES[key];
  return pair({ ...a, name: nameA }, { ...b, name: nameB });
}

describe("matchProducts: type", () => {
  it("is SAME for one brand, a name score from 0.8 and an equal size", () => {
    const brand = { brand: "Molenhof" };
    const match = named("4/5", brand, brand);
    expect(match?.nameScore).toBe(0.8);
    expect(match?.type).toBe("SAME");
  });

  it("is not SAME just under a name score of 0.8", () => {
    const brand = { brand: "Molenhof" };
    const match = named("3/4", brand, brand);
    expect(match?.nameScore).toBe(0.75);
    expect(match?.type).toBe("SIMILAR");
  });

  it("is not SAME without an equal brand, an equal size, the same organic flag or with different barcodes", () => {
    const brand = { brand: "Molenhof" };
    expect(pair({ brand: "Molenhof" }, {})?.type).toBe("SIMILAR");
    expect(pair({ ...brand, quantity: size(1000) }, { ...brand, quantity: size(1100) })?.type).toBe("SIMILAR");
    expect(pair({ ...brand, isOrganic: true }, brand)?.type).toBe("ALTERNATIVE");
    expect(pair({ ...brand, ean: EAN_A }, { ...brand, ean: EAN_B })?.type).toBe("SIMILAR");
  });

  it("is SIMILAR from a name score of 0.6 with an equal or close size", () => {
    expect(named("3/5")).toMatchObject({ nameScore: 0.6, type: "SIMILAR" });
    expect(named("3/5", { quantity: size(1000) }, { quantity: size(1250) })).toMatchObject({ type: "SIMILAR" });
  });

  it("is not SIMILAR just under a name score of 0.6", () => {
    expect(named("4/7")).toMatchObject({ nameScore: 0.57, type: "ALTERNATIVE" });
  });

  it("is not SIMILAR with a different or unknown size, a different organic flag or different brands", () => {
    expect(pair({ quantity: size(1000) }, { quantity: size(1300) })?.type).toBe("ALTERNATIVE");
    expect(pair({ quantity: null }, {})?.type).toBe("ALTERNATIVE");
    expect(pair({ isOrganic: true }, {})?.type).toBe("ALTERNATIVE");
    expect(pair({ brand: "Molenhof" }, { brand: "Bruisbron" })?.type).toBe("ALTERNATIVE");
  });

  it("is ALTERNATIVE from a name score of 0.5 in the same category", () => {
    expect(named("1/2")).toMatchObject({ nameScore: 0.5, type: "ALTERNATIVE" });
  });

  it("is nothing just under a name score of 0.5", () => {
    const match = matchProducts(
      product("a", "ah", { name: NAMES["1.8/4"][0] }),
      product("b", "jumbo", { name: NAMES["1.8/4"][1], ean: null }),
    );
    expect(match).toBeNull();
  });

  it("is nothing as an alternative when the category is unknown", () => {
    expect(named("1/2", { categorySlug: null })).toBeNull();
    // A SIMILAR match does not need the category.
    expect(pair({ categorySlug: null }, {})?.type).toBe("SIMILAR");
  });

  it("is ALTERNATIVE up to 4 times the size, and nothing beyond", () => {
    expect(pair({ quantity: size(500) }, { quantity: size(2000) })?.type).toBe("ALTERNATIVE");
    expect(pair({ quantity: size(500) }, { quantity: size(2001) })).toBeNull();
  });
});

describe("matchProducts: confidence", () => {
  it("weighs name, brand, size, category and organic", () => {
    // 0.55 × 1 + 0.15 × 0.5 + 0.15 × 1 + 0.10 × 1 + 0.05 × 1 = 0.925, rounded half up.
    expect(pair({}, {})).toEqual({
      type: "SIMILAR",
      confidence: 0.93,
      status: "AUTO",
      nameScore: 1,
      signals: ["brand-unknown", "size-equal", "category-equal"],
    });
    // 0.55 + 0.15 × 1 + 0.15 × 0.6 + 0.10 × 0.5 + 0.05 = 0.89.
    expect(
      pair({ brand: "X", categorySlug: null, quantity: size(1000) }, { brand: "x", quantity: size(1100) })?.confidence,
    ).toBe(0.89);
    // 0.55 + 0 + 0.15 × 0.25 + 0.10 + 0 = 0.6875 → 0.69.
    expect(
      pair({ brand: "X", quantity: size(1000), isOrganic: true }, { brand: "Y", quantity: size(2000) })?.confidence,
    ).toBe(0.69);
    // Unknown size counts 0.4: 0.55 + 0.075 + 0.06 + 0.10 + 0.05 = 0.835 → 0.84.
    expect(pair({ quantity: null }, {})?.confidence).toBe(0.84);
  });

  it("subtracts 0.15 for a price gap", () => {
    // 0.925 − 0.15 = 0.775 → 0.78.
    expect(pair({ unitPrice: perKg(100) }, { unitPrice: perKg(301) })).toMatchObject({
      confidence: 0.78,
      type: "SIMILAR",
    });
  });

  it("is AUTO from AUTO_THRESHOLD", () => {
    expect(AUTO_THRESHOLD).toBe(0.7);
    // 0.55 × 0.7 + 0.075 + 0.15 × 0.6 + 0.10 + 0.05 = 0.70 exactly.
    const at = named("2.8/4", { quantity: size(1000) }, { quantity: size(1100) });
    expect(at).toMatchObject({ nameScore: 0.7, confidence: 0.7, status: "AUTO", type: "SIMILAR" });
  });

  it("needs review just under AUTO_THRESHOLD", () => {
    // 0.55 × 0.67 + 0.075 + 0.15 + 0.05 + 0.05 = 0.6935 → 0.69.
    const below = named("4/6", { categorySlug: null });
    expect(below).toMatchObject({ nameScore: 0.67, confidence: 0.69, status: "NEEDS_REVIEW", type: "SIMILAR" });
  });

  it("keeps a match at MIN_CONFIDENCE", () => {
    expect(MIN_CONFIDENCE).toBe(0.45);
    // 0.55 × 0.5 + 0.075 + 0.15 + 0.10 + 0 − 0.15 = 0.45 exactly.
    const at = named("3/6", { isOrganic: true, unitPrice: perKg(100) }, { unitPrice: perKg(400) });
    expect(at).toMatchObject({ nameScore: 0.5, confidence: 0.45, status: "NEEDS_REVIEW", type: "ALTERNATIVE" });
  });

  it("drops a match just under MIN_CONFIDENCE", () => {
    // 0.55 × 0.5 + 0 + 0.15 × 0.4 + 0.10 + 0 = 0.435 → 0.44: an ALTERNATIVE by type, dropped by confidence.
    const brands = named("3/6", { brand: "Molenhof", quantity: null, isOrganic: true }, { brand: "Bruisbron" });
    expect(brands).toBeNull();
    // The same pair with one brand unknown reaches 0.51.
    expect(named("3/6", { quantity: null, isOrganic: true }, { brand: "Bruisbron" })).toMatchObject({
      confidence: 0.51,
      type: "ALTERNATIVE",
    });
  });
});

describe("matchProducts: arguments", () => {
  const valid = product("a", "ah");
  const cases: [string, Extras & { id?: string; retailerId?: string }][] = [
    ["empty id", { id: "" }],
    ["empty retailerId", { retailerId: "" }],
    ["zero amount", { quantity: { ...size(1000), amount: 0 } }],
    ["fractional amount", { quantity: { ...size(1000), amount: 1.5 } }],
    ["zero count", { quantity: { ...size(1000), count: 0 } }],
    ["negative count", { quantity: { ...size(1000), count: -1 } }],
    ["fractional totalAmount", { quantity: { ...size(1000), totalAmount: 999.5 } }],
    ["NaN totalAmount", { quantity: { ...size(1000), totalAmount: Number.NaN } }],
    ["negative unit price", { unitPrice: perKg(-1) }],
    ["fractional unit price", { unitPrice: perKg(1.5) }],
    ["infinite unit price", { unitPrice: perKg(Number.POSITIVE_INFINITY) }],
  ];

  it.each(cases)("throws RangeError for %s, on either side", (_, extras) => {
    const bad = { ...product("b", "jumbo"), ...extras };
    expect(() => matchProducts(bad, valid)).toThrow(RangeError);
    expect(() => matchProducts(valid, bad)).toThrow(RangeError);
    expect(() => findMatches(bad, [])).toThrow(RangeError);
    expect(() => findMatches(valid, [bad])).toThrow(RangeError);
  });

  it("checks the arguments before deciding they are the same product", () => {
    const bad = product("a", "ah", { unitPrice: perKg(-1) });
    expect(() => matchProducts(bad, bad)).toThrow(RangeError);
  });
});

describe("findMatches", () => {
  const base = product("p", "ah", { name: "Appel peer kiwi mango", brand: "Molenhof" });
  const pool: MatchProduct[] = [
    base,
    product("same-chain", "ah", { name: "Appel peer kiwi mango", brand: "Molenhof" }),
    product("alt", "dirk", { name: "Appel peer citroen druif", brand: "Molenhof" }),
    product("similar-b", "jumbo", { name: "Appel peer kiwi mango" }),
    product("similar-a", "vomar", { name: "Appel peer kiwi mango" }),
    product("similar-low", "lidl", { name: "Appel peer kiwi citroen" }),
    product("same", "dirk", { name: "Appel peer kiwi mango", brand: "Molenhof" }),
    product("other", "jumbo", { name: "Kipfilet", categorySlug: "vlees-vis" }),
  ];

  it("orders by type, then confidence, then product id, without itself or its own chain", () => {
    const result = findMatches(base, pool);
    expect(result.map((r) => [r.product.id, r.match.type, r.match.confidence])).toEqual([
      ["same", "SAME", 1],
      ["similar-a", "SIMILAR", 0.93],
      ["similar-b", "SIMILAR", 0.93],
      ["similar-low", "SIMILAR", 0.79],
      ["alt", "ALTERNATIVE", 0.73],
    ]);
  });

  it("returns the pool entries themselves", () => {
    expect(findMatches(base, pool)[0].product).toBe(pool[6]);
  });

  it("returns an empty list for an empty pool", () => {
    expect(findMatches(base, [])).toEqual([]);
  });
});
