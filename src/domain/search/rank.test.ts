import { describe, expect, it } from "vitest";
import { fuzzyThreshold, likePattern, markBest } from "./rank";

describe("fuzzyThreshold", () => {
  it("does not compare short words or numbers fuzzily", () => {
    expect(fuzzyThreshold("ei")).toBeNull();
    expect(fuzzyThreshold("kip")).toBeNull();
    expect(fuzzyThreshold("6")).toBeNull();
    expect(fuzzyThreshold("2000000000016")).toBeNull();
  });

  it("is stricter for words of four or five letters", () => {
    expect(fuzzyThreshold("melk")).toBe(0.65);
    expect(fuzzyThreshold("appel")).toBe(0.65);
    expect(fuzzyThreshold("yogurt")).toBe(0.45);
    expect(fuzzyThreshold("spagetti")).toBe(0.45);
  });
});

describe("likePattern", () => {
  it("wraps the term and escapes wildcards", () => {
    expect(likePattern("melk")).toBe("%melk%");
    expect(likePattern("100%")).toBe("%100\\%%");
    expect(likePattern("a_b\\c")).toBe("%a\\_b\\\\c%");
  });
});

describe("markBest", () => {
  const kg = (cents: number) => ({ cents, basis: "kg" as const });
  const litre = (cents: number) => ({ cents, basis: "l" as const });

  it("marks the lowest price and the best unit price", () => {
    expect(
      markBest([
        { priceCents: 349, unitPrice: kg(698) },
        { priceCents: 529, unitPrice: kg(1058) },
        { priceCents: 299, unitPrice: kg(997) },
      ]),
    ).toEqual([
      { lowestPrice: false, bestUnitPrice: true },
      { lowestPrice: false, bestUnitPrice: false },
      { lowestPrice: true, bestUnitPrice: false },
    ]);
  });

  it("marks every result in a tie", () => {
    expect(markBest([{ priceCents: 99, unitPrice: litre(99) }, { priceCents: 99, unitPrice: litre(99) }])).toEqual([
      { lowestPrice: true, bestUnitPrice: true },
      { lowestPrice: true, bestUnitPrice: true },
    ]);
  });

  it("marks nothing when there is nothing to compare with", () => {
    expect(markBest([])).toEqual([]);
    expect(markBest([{ priceCents: 99, unitPrice: litre(99) }])).toEqual([{ lowestPrice: false, bestUnitPrice: false }]);
    expect(markBest([{ priceCents: 99, unitPrice: null }, { priceCents: null, unitPrice: null }])).toEqual([
      { lowestPrice: false, bestUnitPrice: false },
      { lowestPrice: false, bestUnitPrice: false },
    ]);
  });

  it("compares unit prices only within the same basis", () => {
    expect(
      markBest([
        { priceCents: 100, unitPrice: kg(200) },
        { priceCents: 150, unitPrice: litre(150) },
        { priceCents: 180, unitPrice: kg(360) },
      ]).map((flags) => flags.bestUnitPrice),
    ).toEqual([true, false, false]);
  });

  it("ignores unknown prices without treating them as zero", () => {
    expect(
      markBest([
        { priceCents: null, unitPrice: null },
        { priceCents: 200, unitPrice: null },
        { priceCents: 150, unitPrice: null },
      ]).map((flags) => flags.lowestPrice),
    ).toEqual([false, false, true]);
  });
});
