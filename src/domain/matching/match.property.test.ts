import { describe, expect, it } from "vitest";
import type { Quantity, UnitBasis } from "@/domain/pricing";
import { findMatches, matchProducts } from "./match";
import type { MatchProduct, MatchSignal } from "./types";

/** mulberry32: a small seeded generator, so every run checks the same inputs. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Random = ReturnType<typeof generator>;

function integer(random: Random, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

function pick<T>(random: Random, values: readonly T[]): T {
  return values[integer(random, 0, values.length - 1)];
}

const CHAINS = ["ah", "dirk", "jumbo", "vomar"];
// A small vocabulary, so names often overlap, plus sizes and packaging that coreTokens drops.
const WORDS = [
  "halfvolle",
  "halfvol",
  "melk",
  "scharreleieren",
  "eieren",
  "vrije",
  "uitloop",
  "haverdrink",
  "haverdrank",
  "griekse",
  "yoghurt",
  "naturel",
  "kaas",
  "kaasplank",
  "pak",
  "500 g",
  "6x330ml",
  "1,5 L",
];
const BRANDS = [null, "Molenhof", "molenhof", "Bruisbron", "–"];
const CATEGORIES = [null, "zuivel-eieren", "zuivel-eieren", "voorraadkast"];
// Two valid barcodes, a UPC-A form of a third, that third, and one with a wrong check digit.
const EANS = [null, null, "4006381333931", "5901234123457", "036000291452", "0036000291452", "4006381333932"];
const UNITS: Quantity["unit"][] = ["g", "g", "ml", "piece"];
const BASES: UnitBasis[] = ["kg", "kg", "l", "piece"];

function randomProduct(random: Random, index: number): MatchProduct {
  const name = Array.from({ length: integer(random, 1, 4) }, () => pick(random, WORDS)).join(" ");
  let quantity: Quantity | null = null;
  if (random() < 0.8) {
    const count = random() < 0.2 ? integer(random, 2, 6) : 1;
    const amount = pick(random, [250, 500, 500, 510, 600, 1000, 2000, 2100]);
    quantity = { amount, unit: pick(random, UNITS), count, totalAmount: amount * count, approximate: false };
  }
  return {
    id: `p${index}`,
    retailerId: pick(random, CHAINS),
    name,
    brand: pick(random, BRANDS),
    ean: pick(random, EANS),
    categorySlug: pick(random, CATEGORIES),
    quantity,
    isOrganic: random() < 0.2,
    unitPrice: random() < 0.3 ? null : { cents: integer(random, 0, 1500), basis: pick(random, BASES) },
  };
}

const ORDER: MatchSignal[] = [
  "ean-equal",
  "ean-different",
  "brand-equal",
  "brand-different",
  "brand-unknown",
  "size-equal",
  "size-close",
  "size-different",
  "size-unknown",
  "category-equal",
  "category-unknown",
  "organic-different",
  "price-gap",
];

function shuffled<T>(random: Random, values: T[]): T[] {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = integer(random, 0, i);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

describe("matchProducts: property check over random products", () => {
  it("is symmetric, bounded and keeps its invariants", () => {
    const random = generator(20261112);
    let matched = 0;
    for (let run = 0; run < 3000; run++) {
      const a = randomProduct(random, 2 * run);
      const b = randomProduct(random, 2 * run + 1);
      const match = matchProducts(a, b);
      const context = JSON.stringify({ run, a, b, match });

      expect(matchProducts(b, a), context).toEqual(match);
      expect(matchProducts(a, b), context).toEqual(match);
      if (match === null) continue;
      matched++;

      expect(a.retailerId, context).not.toBe(b.retailerId);
      expect(match.confidence, context).toBeGreaterThanOrEqual(0.45);
      expect(match.confidence, context).toBeLessThanOrEqual(1);
      expect(Math.round(match.confidence * 100) / 100, context).toBe(match.confidence);
      expect(match.nameScore, context).toBeGreaterThanOrEqual(0);
      expect(match.nameScore, context).toBeLessThanOrEqual(1);
      expect(Math.round(match.nameScore * 100) / 100, context).toBe(match.nameScore);
      expect(match.status, context).toBe(match.confidence >= 0.7 ? "AUTO" : "NEEDS_REVIEW");

      const positions = match.signals.map((s) => ORDER.indexOf(s));
      expect(positions, context).toEqual([...new Set(positions)].sort((x, y) => x - y));
      if (match.type === "SAME" && !match.signals.includes("ean-equal")) {
        expect(match.signals, context).toContain("brand-equal");
        expect(match.signals, context).not.toContain("brand-different");
        expect(match.signals, context).not.toContain("ean-different");
      }
      if (match.signals.includes("ean-equal")) expect(match, context).toMatchObject({ type: "SAME", confidence: 1 });
    }
    // The generator must actually produce matches, or the checks above prove nothing.
    expect(matched).toBeGreaterThan(300);
  });
});

describe("findMatches: property check over random pools", () => {
  it("gives the same result whatever the order of the pool", () => {
    const random = generator(42);
    for (let run = 0; run < 200; run++) {
      const pool = Array.from({ length: integer(random, 0, 25) }, (_, i) => randomProduct(random, i));
      const product = pool.length > 0 && random() < 0.5 ? pool[0] : randomProduct(random, 1000);
      const result = findMatches(product, pool);
      expect(findMatches(product, [...pool].reverse())).toEqual(result);
      expect(findMatches(product, shuffled(random, pool))).toEqual(result);
      expect(result.every((r) => r.product.id !== product.id && r.product.retailerId !== product.retailerId)).toBe(
        true,
      );
    }
  });
});
