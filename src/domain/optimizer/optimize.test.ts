import { describe, expect, it } from "vitest";
import type { Promotion } from "@/domain/pricing";
import { optimizeBasket } from "./optimize";
import type { Candidate, ListItem, MatchTier, Options, Plan } from "./types";

const PRICE_CUT: Promotion = { type: "PRICE_CUT" };
const ONE_PLUS_ONE: Promotion = { type: "X_PLUS_Y_FREE", buy: 1, free: 1 };

const MAX_SAVINGS_1: Options = { maxStores: 1, mode: "max-savings" };
const MAX_SAVINGS_2: Options = { maxStores: 2, mode: "max-savings" };
const MAX_SAVINGS_3: Options = { maxStores: 3, mode: "max-savings" };

type CandidateExtras = Partial<Omit<Candidate, "retailerId" | "regularPriceCents">>;

function candidate(retailerId: string, regularPriceCents: number | null, extras: CandidateExtras = {}): Candidate {
  return {
    productId: `${retailerId}-${extras.tier ?? "SAME"}-${regularPriceCents}`,
    retailerId,
    name: "Product",
    tier: "SAME",
    regularPriceCents,
    offer: null,
    quantity: null,
    isOrganic: false,
    ...extras,
  };
}

function tiered(retailerId: string, regularPriceCents: number, tier: MatchTier): Candidate {
  return candidate(retailerId, regularPriceCents, { tier });
}

function onOffer(
  retailerId: string,
  regularPriceCents: number | null,
  promotion: Promotion,
  offerPriceCents: number | null = null,
  extras: { verified?: boolean; daysLeft?: number | null } = {},
): Candidate {
  return candidate(retailerId, regularPriceCents, {
    offer: {
      offerId: `${retailerId}-offer`,
      promotion,
      offerPriceCents,
      verified: extras.verified ?? true,
      daysLeft: extras.daysLeft === undefined ? 2 : extras.daysLeft,
    },
  });
}

function organic(retailerId: string, regularPriceCents: number): Candidate {
  return candidate(retailerId, regularPriceCents, { isOrganic: true, productId: `${retailerId}-bio` });
}

function item(
  id: string,
  candidates: Candidate[],
  extras: Partial<Omit<ListItem, "id" | "candidates">> = {},
): ListItem {
  return { id, label: id, quantity: 1, pinnedRetailerId: null, candidates, ...extras };
}

/** Item id → chain of its line, for compact assertions. */
function placement(plan: Plan): Record<string, string> {
  const result: Record<string, string> = {};
  for (const stop of plan.stops) for (const line of stop.lines) result[line.itemId] = stop.retailerId;
  return result;
}

function line(plan: Plan, itemId: string) {
  const found = plan.stops.flatMap((stop) => stop.lines).find((l) => l.itemId === itemId);
  if (!found) throw new Error(`no line for ${itemId}`);
  return found;
}

function missingReasons(plan: Plan): Record<string, string> {
  return Object.fromEntries(plan.missing.map((m) => [m.itemId, m.reason]));
}

/**
 * A week's shopping at the four chains. Prices in cents per item; kipfilet is 1+1 gratis at
 * Jumbo, Vomar has no kaas. Every candidate is the same product (tier SAME).
 *
 *                   ah    dirk  jumbo  vomar   quantity
 *   melk           129    115    125    119    1
 *   brood          249    199    229    219    1
 *   eieren         329    299    315    289    1
 *   kipfilet       749    699    699*   719    2   (* 1+1 gratis: 2 cost 699)
 *   bananen        199    169    189    179    1
 *   kaas           549    499    529     —     1
 *   pasta          139    119    129    109    2
 *   tomaten        249    229    239    219    1
 *   koffie         599    579    549    589    1
 *
 * Single chains: ah 4079, dirk 3725, jumbo 3132, vomar 3270 without kaas.
 * Best pair dirk + jumbo 2996; best triple dirk + jumbo + vomar 2956.
 */
function weeklyShop(): ListItem[] {
  const rows: [string, number, (number | null)[]][] = [
    ["melk", 1, [129, 115, 125, 119]],
    ["brood", 1, [249, 199, 229, 219]],
    ["eieren", 1, [329, 299, 315, 289]],
    ["kipfilet", 2, [749, 699, 699, 719]],
    ["bananen", 1, [199, 169, 189, 179]],
    ["kaas", 1, [549, 499, 529, null]],
    ["pasta", 2, [139, 119, 129, 109]],
    ["tomaten", 1, [249, 229, 239, 219]],
    ["koffie", 1, [599, 579, 549, 589]],
  ];
  const chains = ["ah", "dirk", "jumbo", "vomar"];
  return rows.map(([id, quantity, prices]) => {
    const candidates: Candidate[] = [];
    prices.forEach((price, index) => {
      if (price === null) return;
      const retailerId = chains[index];
      const productId = `${retailerId}-${id}`;
      if (id === "kipfilet" && retailerId === "jumbo") {
        candidates.push({ ...onOffer(retailerId, price, ONE_PLUS_ONE, null, { daysLeft: 3 }), productId });
      } else {
        candidates.push(candidate(retailerId, price, { productId }));
      }
    });
    return item(id, candidates, { quantity });
  });
}

/** Deterministic Fisher–Yates with a small linear congruential generator. */
function shuffled<T>(values: T[], seed: number): T[] {
  const result = [...values];
  let state = seed;
  for (let i = result.length - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const j = state % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

describe("optimizeBasket: the weekly shop", () => {
  it("costs 29,96 at Dirk and Jumbo, 1,36 less than Jumbo alone", () => {
    const plan = optimizeBasket(weeklyShop(), MAX_SAVINGS_2);

    expect(plan.totalCents).toBe(2996);
    expect(plan.stops.map((s) => [s.retailerId, s.subtotalCents])).toEqual([
      ["dirk", 1748],
      ["jumbo", 1248],
    ]);
    expect(plan.stops[1].lines.map((l) => l.itemId)).toEqual(["kipfilet", "koffie"]);
    expect(plan.itemCount).toBe(9);
    expect(plan.coveredCount).toBe(9);
    expect(plan.missing).toEqual([]);
    expect(plan.comparison).toEqual({ retailerId: "jumbo", totalCents: 3132, savingCents: 136 });
    expect(plan.offerSavingCents).toBe(699);
    expect(plan.maxStoresExceeded).toBe(false);
    expect(plan.overBudgetCents).toBeNull();
  });

  it("explains each line with codes and numbers", () => {
    const plan = optimizeBasket(weeklyShop(), MAX_SAVINGS_2);

    expect(line(plan, "kipfilet")).toMatchObject({
      quantity: 2,
      totalCents: 699,
      unitCents: 350,
      regularTotalCents: 1398,
      usedOffer: true,
      assumed: false,
      reason: { code: "offer", savingCents: 699, daysLeft: 3 },
      hint: null,
    });
    expect(line(plan, "melk").reason).toEqual({ code: "cheapest", nextRetailerId: "jumbo", differenceCents: 10 });
    expect(line(plan, "kaas").reason).toEqual({ code: "cheapest", nextRetailerId: "jumbo", differenceCents: 30 });
    expect(line(plan, "koffie").reason).toEqual({ code: "cheapest", nextRetailerId: "dirk", differenceCents: 30 });
    expect(line(plan, "pasta")).toMatchObject({ totalCents: 238, unitCents: 119, regularTotalCents: 238 });
  });

  it("gets no more expensive with each extra store allowed", () => {
    const totals = [MAX_SAVINGS_1, MAX_SAVINGS_2, MAX_SAVINGS_3].map((o) => optimizeBasket(weeklyShop(), o).totalCents);
    expect(totals).toEqual([3132, 2996, 2956]);
  });

  it("uses one chain when only one store is allowed", () => {
    const plan = optimizeBasket(weeklyShop(), MAX_SAVINGS_1);
    expect(plan.stops.map((s) => s.retailerId)).toEqual(["jumbo"]);
    expect(plan.comparison).toBeNull();
  });

  it("orders three stops by subtotal and leaves the chain that is never cheapest out", () => {
    const plan = optimizeBasket(weeklyShop(), MAX_SAVINGS_3);
    expect(plan.stops.map((s) => [s.retailerId, s.subtotalCents])).toEqual([
      ["jumbo", 1248],
      ["dirk", 982],
      ["vomar", 726],
    ]);
    expect(plan.comparison).toEqual({ retailerId: "jumbo", totalCents: 3132, savingCents: 176 });
  });

  it("lists every chain on its own, best coverage then cheapest first", () => {
    expect(optimizeBasket(weeklyShop(), MAX_SAVINGS_2).singleStores).toEqual([
      { retailerId: "jumbo", totalCents: 3132, coveredCount: 9, missingItemIds: [] },
      { retailerId: "dirk", totalCents: 3725, coveredCount: 9, missingItemIds: [] },
      { retailerId: "ah", totalCents: 4079, coveredCount: 9, missingItemIds: [] },
      { retailerId: "vomar", totalCents: 3270, coveredCount: 8, missingItemIds: ["kaas"] },
    ]);
  });

  it("returns the same plan whatever the order of the candidates", () => {
    const expected = optimizeBasket(weeklyShop(), MAX_SAVINGS_2);
    for (const seed of [1, 7, 42, 1234]) {
      const items = weeklyShop().map((i, index) => ({ ...i, candidates: shuffled(i.candidates, seed + index) }));
      expect(optimizeBasket(items, MAX_SAVINGS_2)).toEqual(expected);
    }
  });
});

describe("optimizeBasket: choosing a candidate", () => {
  it("keeps the closer match even when a less similar product is cheaper at the same chain", () => {
    const plan = optimizeBasket(
      [
        item("melk", [tiered("ah", 300, "EXACT"), tiered("ah", 100, "SIMILAR"), tiered("jumbo", 400, "SAME")]),
        item("brood", [candidate("ah", 100)]),
      ],
      MAX_SAVINGS_1,
    );
    expect(line(plan, "melk")).toMatchObject({ totalCents: 300, candidate: { tier: "EXACT", retailerId: "ah" } });
    expect(line(plan, "melk").reason).toEqual({ code: "closest-match" });
  });

  it("keeps the closer match at another chain in the chosen set", () => {
    const plan = optimizeBasket(
      [
        item("melk", [tiered("ah", 300, "EXACT"), tiered("jumbo", 100, "SIMILAR")]),
        item("brood", [candidate("ah", 50)]),
        item("kaas", [candidate("jumbo", 50)]),
      ],
      MAX_SAVINGS_2,
    );
    expect(placement(plan)).toEqual({ melk: "ah", brood: "ah", kaas: "jumbo" });
    expect(line(plan, "melk").reason).toEqual({ code: "closest-match" });
    expect(plan.totalCents).toBe(400);
  });

  it("prefers tiers in the order EXACT, SAME, SIMILAR, ALTERNATIVE", () => {
    const tiers: MatchTier[] = ["ALTERNATIVE", "SIMILAR", "SAME", "EXACT"];
    for (let best = 0; best < tiers.length; best++) {
      // Each closer tier costs more: the tier has to win over the price.
      const candidates = tiers.slice(0, best + 1).map((tier, index) => tiered("ah", 100 + index, tier));
      const plan = optimizeBasket([item("x", candidates)], MAX_SAVINGS_1);
      expect(line(plan, "x").candidate.tier).toBe(tiers[best]);
    }
  });

  it("breaks a price tie between chains on the retailer id", () => {
    const plan = optimizeBasket([item("x", [candidate("jumbo", 100), candidate("ah", 100)])], MAX_SAVINGS_2);
    expect(placement(plan)).toEqual({ x: "ah" });
  });

  it("ignores a candidate that cannot be priced", () => {
    const plan = optimizeBasket([item("x", [candidate("ah", null), candidate("jumbo", 300)])], MAX_SAVINGS_2);
    expect(placement(plan)).toEqual({ x: "jumbo" });
    expect(line(plan, "x").reason).toEqual({ code: "only-store" });
    expect(plan.singleStores.map((s) => [s.retailerId, s.coveredCount])).toEqual([
      ["jumbo", 1],
      ["ah", 0],
    ]);
  });

  it("does not use an unverified offer", () => {
    const plan = optimizeBasket(
      [item("x", [onOffer("ah", 300, PRICE_CUT, 100, { verified: false }), candidate("jumbo", 250)])],
      MAX_SAVINGS_1,
    );
    expect(placement(plan)).toEqual({ x: "jumbo" });
    expect(plan.offerSavingCents).toBe(0);
  });

  it("explains a cheapest line with no other chain at the same tier in the chosen set", () => {
    const plan = optimizeBasket(
      [item("x", [candidate("ah", 100), tiered("jumbo", 300, "SIMILAR")]), item("y", [candidate("jumbo", 100)])],
      MAX_SAVINGS_2,
    );
    expect(line(plan, "x").reason).toEqual({ code: "cheapest", nextRetailerId: null, differenceCents: null });
  });

  it("reports an offer saving as unknown when the regular price is unknown", () => {
    const plan = optimizeBasket(
      [item("x", [onOffer("ah", null, PRICE_CUT, 150, { daysLeft: 0 }), candidate("jumbo", 300)])],
      MAX_SAVINGS_1,
    );
    expect(line(plan, "x")).toMatchObject({
      totalCents: 150,
      regularTotalCents: null,
      reason: { code: "offer", savingCents: null, daysLeft: 0 },
    });
    expect(plan.offerSavingCents).toBe(0);
  });

  it("attaches a buy-more hint without changing the quantity", () => {
    const plan = optimizeBasket([item("x", [onOffer("ah", 300, ONE_PLUS_ONE)])], MAX_SAVINGS_1);
    expect(line(plan, "x")).toMatchObject({
      quantity: 1,
      totalCents: 300,
      usedOffer: false,
      hint: { code: "buy-more-for-deal", minimumQuantity: 2 },
    });
  });
});

describe("optimizeBasket: pinned items", () => {
  const pinnedList = () => [
    item("melk", [candidate("ah", 300), candidate("jumbo", 100)], { pinnedRetailerId: "ah" }),
    item("kaas", [candidate("jumbo", 100), candidate("dirk", 90)]),
  ];

  it("keeps a pinned item at its chain even when another is cheaper", () => {
    const plan = optimizeBasket(pinnedList(), MAX_SAVINGS_2);
    expect(placement(plan)).toEqual({ melk: "ah", kaas: "dirk" });
    expect(line(plan, "melk").reason).toEqual({ code: "pinned" });
    expect(plan.totalCents).toBe(390);
  });

  it("forces the pinned chain into a one-store plan", () => {
    const plan = optimizeBasket(pinnedList(), MAX_SAVINGS_1);
    expect(placement(plan)).toEqual({ melk: "ah" });
    expect(missingReasons(plan)).toEqual({ kaas: "not-in-chosen-stores" });
  });

  it("applies the pin rules to every chain on its own", () => {
    const plan = optimizeBasket(pinnedList(), MAX_SAVINGS_2);
    expect(plan.singleStores).toEqual([
      { retailerId: "dirk", totalCents: 90, coveredCount: 1, missingItemIds: ["melk"] },
      { retailerId: "jumbo", totalCents: 100, coveredCount: 1, missingItemIds: ["melk"] },
      { retailerId: "ah", totalCents: 300, coveredCount: 1, missingItemIds: ["kaas"] },
    ]);
    expect(plan.comparison).toBeNull();
  });

  it("marks a pinned item missing when its chain cannot supply it, and does not move it", () => {
    const plan = optimizeBasket(
      [
        item("melk", [candidate("ah", 100)], { pinnedRetailerId: "vomar" }),
        item("brood", [candidate("ah", 100), candidate("vomar", null)], { pinnedRetailerId: "vomar" }),
        item("kaas", [candidate("ah", 200)]),
      ],
      MAX_SAVINGS_2,
    );
    expect(missingReasons(plan)).toEqual({ melk: "pinned-unavailable", brood: "pinned-unavailable" });
    expect(placement(plan)).toEqual({ kaas: "ah" });
    expect(plan.maxStoresExceeded).toBe(false);
  });

  it("uses exactly the pinned chains when they are more than maxStores", () => {
    const plan = optimizeBasket(
      [
        item("melk", [candidate("ah", 100)], { pinnedRetailerId: "ah" }),
        item("brood", [candidate("jumbo", 100)], { pinnedRetailerId: "jumbo" }),
        item("kaas", [candidate("dirk", 50)]),
        item("eieren", [candidate("jumbo", 300), candidate("dirk", 200)]),
      ],
      MAX_SAVINGS_1,
    );
    expect(plan.maxStoresExceeded).toBe(true);
    expect(placement(plan)).toEqual({ melk: "ah", brood: "jumbo", eieren: "jumbo" });
    expect(missingReasons(plan)).toEqual({ kaas: "not-in-chosen-stores" });
    expect(plan.stops.map((s) => s.retailerId)).toEqual(["jumbo", "ah"]);
    expect(plan.totalCents).toBe(500);
  });
});

describe("optimizeBasket: modes", () => {
  const twoCheapChains = () => [
    item("melk", [candidate("ah", 500), candidate("jumbo", 300)]),
    item("kaas", [candidate("ah", 500), candidate("dirk", 300)]),
  ];

  it("fewest-stores picks one chain that covers everything even when two are cheaper", () => {
    const plan = optimizeBasket(twoCheapChains(), { maxStores: 2, mode: "fewest-stores" });
    expect(placement(plan)).toEqual({ melk: "ah", kaas: "ah" });
    expect(plan.totalCents).toBe(1000);
    expect(plan.comparison).toBeNull();
  });

  it("max-savings uses the two cheaper chains on the same list", () => {
    const plan = optimizeBasket(twoCheapChains(), MAX_SAVINGS_2);
    expect(placement(plan)).toEqual({ melk: "jumbo", kaas: "dirk" });
    expect(plan.totalCents).toBe(600);
    expect(plan.comparison).toEqual({ retailerId: "ah", totalCents: 1000, savingCents: 400 });
  });

  it("fewest-stores still puts coverage first", () => {
    const plan = optimizeBasket([item("melk", [candidate("ah", 500)]), item("kaas", [candidate("jumbo", 500)])], {
      maxStores: 2,
      mode: "fewest-stores",
    });
    expect(plan.coveredCount).toBe(2);
    expect(plan.stops).toHaveLength(2);
  });

  it("fewest-stores breaks a tie in store count on the total", () => {
    const plan = optimizeBasket([item("melk", [candidate("ah", 500), candidate("jumbo", 400)])], {
      maxStores: 2,
      mode: "fewest-stores",
    });
    expect(placement(plan)).toEqual({ melk: "jumbo" });
  });

  it("offers-only keeps candidates whose line uses an offer", () => {
    const plan = optimizeBasket(
      [
        item("melk", [candidate("ah", 100), onOffer("jumbo", 300, PRICE_CUT, 200)]),
        item("kaas", [candidate("ah", 100)]),
        item("cola", [onOffer("ah", 200, ONE_PLUS_ONE)]),
        item("thee", [onOffer("ah", 200, PRICE_CUT, 100, { verified: false })]),
      ],
      { maxStores: 2, mode: "offers-only" },
    );
    expect(placement(plan)).toEqual({ melk: "jumbo" });
    expect(line(plan, "melk").reason).toEqual({ code: "only-store" });
    expect(missingReasons(plan)).toEqual({ kaas: "filtered", cola: "filtered", thee: "filtered" });
    expect(plan.singleStores.map((s) => [s.retailerId, s.coveredCount])).toEqual([
      ["jumbo", 1],
      ["ah", 0],
    ]);
  });

  it("organic-only keeps organic candidates", () => {
    const plan = optimizeBasket(
      [item("melk", [candidate("ah", 100), organic("jumbo", 300)]), item("kaas", [candidate("ah", 100)])],
      { maxStores: 2, mode: "organic-only" },
    );
    expect(placement(plan)).toEqual({ melk: "jumbo" });
    expect(missingReasons(plan)).toEqual({ kaas: "filtered" });
  });

  it("reports a pinned item emptied by the filter as filtered", () => {
    const plan = optimizeBasket([item("melk", [candidate("ah", 100)], { pinnedRetailerId: "ah" })], {
      maxStores: 1,
      mode: "organic-only",
    });
    expect(missingReasons(plan)).toEqual({ melk: "filtered" });
  });

  it("reports a pinned item whose chain has nothing left after the filter as pinned-unavailable", () => {
    const plan = optimizeBasket(
      [item("melk", [candidate("ah", 100), organic("jumbo", 300)], { pinnedRetailerId: "ah" })],
      { maxStores: 1, mode: "organic-only" },
    );
    expect(missingReasons(plan)).toEqual({ melk: "pinned-unavailable" });
  });
});

describe("optimizeBasket: missing items and comparison", () => {
  it("reports items without any priceable candidate as not-found", () => {
    const plan = optimizeBasket(
      [item("melk", []), item("kaas", [candidate("ah", null)]), item("brood", [candidate("ah", 100)])],
      MAX_SAVINGS_1,
    );
    expect(missingReasons(plan)).toEqual({ melk: "not-found", kaas: "not-found" });
    expect(plan.missing[0]).toEqual({ itemId: "melk", label: "melk", reason: "not-found" });
    expect(plan.coveredCount).toBe(1);
    expect(plan.itemCount).toBe(3);
  });

  it("reports items outside the chosen chains as not-in-chosen-stores", () => {
    const plan = optimizeBasket(
      [item("melk", [candidate("ah", 300)]), item("kaas", [candidate("jumbo", 200)])],
      MAX_SAVINGS_1,
    );
    expect(placement(plan)).toEqual({ kaas: "jumbo" });
    expect(missingReasons(plan)).toEqual({ melk: "not-in-chosen-stores" });
  });

  it("has no comparison when no single chain covers the plan", () => {
    const plan = optimizeBasket(
      [item("melk", [candidate("ah", 300)]), item("kaas", [candidate("jumbo", 200)])],
      MAX_SAVINGS_2,
    );
    expect(plan.coveredCount).toBe(2);
    expect(plan.comparison).toBeNull();
  });

  it("orders stops with equal subtotals by retailer id and lines by list order", () => {
    const plan = optimizeBasket(
      [
        item("a", [candidate("jumbo", 100)]),
        item("b", [candidate("ah", 100)]),
        item("c", [candidate("jumbo", 100)]),
        item("d", [candidate("ah", 100)]),
      ],
      MAX_SAVINGS_2,
    );
    expect(plan.stops.map((s) => [s.retailerId, s.lines.map((l) => l.itemId)])).toEqual([
      ["ah", ["b", "d"]],
      ["jumbo", ["a", "c"]],
    ]);
  });
});

describe("optimizeBasket: budget", () => {
  const list = () => [item("melk", [candidate("ah", 300)])];

  it("reports how far the total exceeds the budget", () => {
    expect(optimizeBasket(list(), { ...MAX_SAVINGS_1, budgetCents: 250 }).overBudgetCents).toBe(50);
  });

  it.each([300, 1000, null, undefined])("reports nothing for budget %s", (budgetCents) => {
    expect(optimizeBasket(list(), { ...MAX_SAVINGS_1, budgetCents }).overBudgetCents).toBeNull();
  });
});

describe("optimizeBasket: edge cases", () => {
  it("returns an empty plan for an empty list", () => {
    expect(optimizeBasket([], { ...MAX_SAVINGS_3, budgetCents: 100 })).toEqual({
      stops: [],
      totalCents: 0,
      itemCount: 0,
      coveredCount: 0,
      missing: [],
      singleStores: [],
      comparison: null,
      offerSavingCents: 0,
      overBudgetCents: null,
      maxStoresExceeded: false,
    });
  });

  it("has no comparison when nothing is covered", () => {
    const plan = optimizeBasket([item("melk", [candidate("ah", 100)])], { maxStores: 1, mode: "organic-only" });
    expect(plan.stops).toEqual([]);
    expect(plan.comparison).toBeNull();
    expect(plan.singleStores).toEqual([{ retailerId: "ah", totalCents: 0, coveredCount: 0, missingItemIds: ["melk"] }]);
  });

  it.each<[string, () => unknown]>([
    ["quantity 0", () => optimizeBasket([item("x", [], { quantity: 0 })], MAX_SAVINGS_1)],
    ["a fractional quantity", () => optimizeBasket([item("x", [], { quantity: 1.5 })], MAX_SAVINGS_1)],
    ["negative cents", () => optimizeBasket([item("x", [candidate("ah", -1)])], MAX_SAVINGS_1)],
    ["fractional cents", () => optimizeBasket([item("x", [candidate("ah", 99.5)])], MAX_SAVINGS_1)],
    [
      "negative offer cents",
      () => optimizeBasket([item("x", [onOffer("ah", 100, PRICE_CUT, -1, { verified: false })])], MAX_SAVINGS_1),
    ],
    ["duplicate item ids", () => optimizeBasket([item("x", []), item("x", [])], MAX_SAVINGS_1)],
    ["a negative budget", () => optimizeBasket([], { ...MAX_SAVINGS_1, budgetCents: -1 })],
    ["a fractional budget", () => optimizeBasket([], { ...MAX_SAVINGS_1, budgetCents: 10.5 })],
    ["maxStores 4", () => optimizeBasket([], { maxStores: 4, mode: "max-savings" } as unknown as Options)],
    ["an unknown mode", () => optimizeBasket([], { maxStores: 1, mode: "cheapest" } as unknown as Options)],
    [
      "an unknown substitutes setting",
      () => optimizeBasket([], { ...MAX_SAVINGS_1, substitutes: "any" } as unknown as Options),
    ],
  ])("throws RangeError for %s", (_label, call) => {
    expect(call).toThrow(RangeError);
  });
});

describe("optimizeBasket: substitutes", () => {
  // One item pinned at each chain, so all three are always visited and only the
  // choice inside the set is under test.
  const anchors = (...chains: string[]) =>
    chains.map((chain) => item(`anchor-${chain}`, [tiered(chain, 100, "EXACT")], { pinnedRetailerId: chain }));
  // The shopper picked the product at AH; Vomar sells the same one, Dirk a very similar one.
  const milk = () =>
    item("milk", [tiered("ah", 119, "EXACT"), tiered("vomar", 109, "SAME"), tiered("dirk", 99, "SIMILAR")]);
  const basket = () => [milk(), ...anchors("ah", "vomar", "dirk")];

  it("keeps the picked product by default, whatever the others in the set cost", () => {
    const plan = optimizeBasket(basket(), MAX_SAVINGS_3);
    expect(placement(plan).milk).toBe("ah");
    expect(line(plan, "milk").reason).toEqual({ code: "closest-match" });
  });

  it("lets the same product at another chain compete on price", () => {
    const plan = optimizeBasket(basket(), { ...MAX_SAVINGS_3, substitutes: "same" });
    expect(placement(plan).milk).toBe("vomar");
    // Dirk is cheaper still, but a similar product does not compete under "same".
    expect(line(plan, "milk").reason).toEqual({ code: "closest-match" });
  });

  it("lets a very similar product compete on price too, and names the next-best chain", () => {
    const plan = optimizeBasket(basket(), { ...MAX_SAVINGS_3, substitutes: "similar" });
    expect(placement(plan).milk).toBe("dirk");
    expect(line(plan, "milk").reason).toEqual({ code: "cheapest", nextRetailerId: "vomar", differenceCents: 10 });
    expect(plan.totalCents).toBe(399);
  });

  it("never lets another size compete on price", () => {
    const items = [
      item("milk", [tiered("ah", 119, "EXACT"), tiered("dirk", 49, "ALTERNATIVE")]),
      ...anchors("ah", "dirk"),
    ];
    const plan = optimizeBasket(items, { ...MAX_SAVINGS_2, substitutes: "similar" });
    expect(placement(plan).milk).toBe("ah");
    expect(line(plan, "milk").reason).toEqual({ code: "closest-match" });
  });

  it("prefers the closer match at the same price", () => {
    const items = [item("milk", [tiered("dirk", 99, "SIMILAR"), tiered("ah", 99, "EXACT")]), ...anchors("ah", "dirk")];
    const plan = optimizeBasket(items, { ...MAX_SAVINGS_2, substitutes: "similar" });
    expect(placement(plan).milk).toBe("ah");
  });

  it("falls back to another size when the chosen chains have nothing closer", () => {
    const plan = optimizeBasket(
      [item("milk", [tiered("jumbo", 49, "ALTERNATIVE")]), item("bread", [tiered("jumbo", 150, "EXACT")])],
      { ...MAX_SAVINGS_1, substitutes: "similar" },
    );
    expect(placement(plan)).toEqual({ milk: "jumbo", bread: "jumbo" });
  });

  it("applies the setting to every chain on its own", () => {
    const items = () => [
      item("milk", [
        candidate("dirk", 120, { tier: "EXACT", productId: "dirk-brand" }),
        candidate("dirk", 99, { tier: "SIMILAR", productId: "dirk-own" }),
      ]),
    ];
    expect(optimizeBasket(items(), MAX_SAVINGS_1).singleStores[0].totalCents).toBe(120);
    const plan = optimizeBasket(items(), { ...MAX_SAVINGS_1, substitutes: "similar" });
    expect(plan.singleStores[0].totalCents).toBe(99);
    expect(line(plan, "milk").candidate.productId).toBe("dirk-own");
  });
});
