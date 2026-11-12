import { describe, expect, it } from "vitest";
import { optimizeBasket } from "./optimize";
import type { Candidate, ListItem, MatchTier } from "./types";

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

const CHAINS = ["ah", "dirk", "jumbo", "lidl", "vomar"];
const TIERS: MatchTier[] = ["EXACT", "SAME", "SIMILAR", "ALTERNATIVE"];

type Random = ReturnType<typeof generator>;

function integer(random: Random, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

/** Random list with price cuts only, so the reference below can price it on its own. */
function randomList(random: Random): ListItem[] {
  const chains = CHAINS.slice(0, integer(random, 1, CHAINS.length));
  return Array.from({ length: integer(random, 1, 6) }, (_, index) => {
    const candidates: Candidate[] = [];
    for (const retailerId of chains) {
      if (random() < 0.4) continue;
      for (let n = integer(random, 1, 2); n > 0; n--) {
        const regular = random() < 0.1 ? null : integer(random, 50, 500);
        const hasOffer = random() < 0.3;
        candidates.push({
          productId: `${retailerId}-${index}-${n}`,
          retailerId,
          name: "Product",
          tier: TIERS[integer(random, 0, 3)],
          regularPriceCents: regular,
          offer: hasOffer
            ? {
                offerId: `${retailerId}-${index}-${n}-offer`,
                promotion: { type: "PRICE_CUT" },
                offerPriceCents: random() < 0.1 ? null : integer(random, 30, 550),
                verified: random() < 0.8,
                daysLeft: integer(random, 0, 6),
              }
            : null,
          quantity: null,
          isOrganic: false,
        });
      }
    }
    const pinnedRetailerId = random() < 0.15 ? chains[integer(random, 0, chains.length - 1)] : null;
    return { id: `item-${index}`, label: `item ${index}`, quantity: integer(random, 1, 3), pinnedRetailerId, candidates };
  });
}

// --- Brute-force reference, written without the library's helpers. ---

function referencePrice(candidate: Candidate, quantity: number): number | null {
  const prices: number[] = [];
  if (candidate.regularPriceCents !== null) prices.push(candidate.regularPriceCents * quantity);
  const offer = candidate.offer;
  if (offer !== null && offer.verified && offer.offerPriceCents !== null) prices.push(offer.offerPriceCents * quantity);
  return prices.length === 0 ? null : Math.min(...prices);
}

type ReferenceSet = { chains: string[]; covered: number; total: number };

function referenceSets(items: ListItem[], maxStores: number): ReferenceSet[] {
  const usable = items.map((item) =>
    item.candidates
      .map((candidate) => ({ candidate, price: referencePrice(candidate, item.quantity) }))
      .filter((o): o is { candidate: Candidate; price: number } => o.price !== null)
      .filter((o) => item.pinnedRetailerId === null || o.candidate.retailerId === item.pinnedRetailerId),
  );
  const forced = new Set<string>();
  items.forEach((item, i) => {
    if (item.pinnedRetailerId !== null && usable[i].length > 0) forced.add(item.pinnedRetailerId);
  });
  const chains = [...new Set(usable.flat().map((o) => o.candidate.retailerId))];

  const subsets: string[][] = [];
  if (forced.size > maxStores) subsets.push([...forced]);
  else {
    for (let mask = 1; mask < 1 << chains.length; mask++) {
      const subset = chains.filter((_, bit) => mask & (1 << bit));
      if (subset.length <= maxStores && [...forced].every((f) => subset.includes(f))) subsets.push(subset);
    }
  }

  return subsets.map((subset) => {
    let covered = 0;
    let total = 0;
    for (const options of usable) {
      const inSet = options.filter((o) => subset.includes(o.candidate.retailerId));
      if (inSet.length === 0) continue;
      const bestTier = Math.min(...inSet.map((o) => TIERS.indexOf(o.candidate.tier)));
      const price = Math.min(...inSet.filter((o) => TIERS.indexOf(o.candidate.tier) === bestTier).map((o) => o.price));
      covered++;
      total += price;
    }
    return { chains: subset, covered, total };
  });
}

describe("optimizeBasket: property check against a brute-force reference", () => {
  it("never chooses a set of chains costing more than another set with the same coverage", () => {
    const random = generator(20261111);
    for (let run = 0; run < 400; run++) {
      const items = randomList(random);
      const maxStores = ([1, 2, 3] as const)[integer(random, 0, 2)];
      const plan = optimizeBasket(items, { maxStores, mode: "max-savings" });
      const sets = referenceSets(items, maxStores);
      const context = JSON.stringify({ run, maxStores, items });

      const bestCoverage = Math.max(0, ...sets.map((s) => s.covered));
      expect(plan.coveredCount, context).toBe(bestCoverage);
      for (const set of sets.filter((s) => s.covered === plan.coveredCount)) {
        expect(plan.totalCents, context).toBeLessThanOrEqual(set.total);
      }
      if (!plan.maxStoresExceeded) expect(plan.stops.length, context).toBeLessThanOrEqual(maxStores);
      expect(plan.stops.every((s) => s.lines.length > 0), context).toBe(true);
      expect(plan.comparison === null || plan.comparison.savingCents >= 0, context).toBe(true);
    }
  });

  it("gives the same plan when every item's candidates are reversed", () => {
    const random = generator(7);
    for (let run = 0; run < 100; run++) {
      const items = randomList(random);
      const options = { maxStores: 3, mode: "max-savings" } as const;
      const reversed = items.map((i) => ({ ...i, candidates: [...i.candidates].reverse() }));
      expect(optimizeBasket(reversed, options)).toEqual(optimizeBasket(items, options));
    }
  });
});
