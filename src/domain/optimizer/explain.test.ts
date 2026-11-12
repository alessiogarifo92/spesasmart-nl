import { describe, expect, it } from "vitest";
import { explainPlan } from "./explain";
import { optimizeBasket } from "./optimize";
import type { Candidate, ListItem, Options } from "./types";

const TWO: Options = { maxStores: 2, mode: "max-savings" };

function at(
  retailerId: string,
  regularPriceCents: number,
  offerPriceCents?: number,
  daysLeft: number | null = 3,
): Candidate {
  return {
    productId: `${retailerId}-${regularPriceCents}`,
    retailerId,
    name: "Product",
    tier: "EXACT",
    regularPriceCents,
    offer:
      offerPriceCents === undefined
        ? null
        : {
            offerId: `${retailerId}-offer`,
            promotion: { type: "PRICE_CUT" },
            offerPriceCents,
            verified: true,
            daysLeft,
          },
    quantity: null,
    isOrganic: false,
  };
}

function item(id: string, candidates: Candidate[], quantity = 1): ListItem {
  return { id, label: id, quantity, pinnedRetailerId: null, candidates };
}

describe("explainPlan", () => {
  it("says nothing about an empty plan", () => {
    expect(explainPlan(optimizeBasket([], TWO))).toEqual([]);
    expect(explainPlan(optimizeBasket([item("tahin", [])], TWO))).toEqual([]);
  });

  it("leads with what the route saves against the best single chain", () => {
    const plan = optimizeBasket(
      [item("kip", [at("ah", 499), at("dirk", 349)]), item("melk", [at("ah", 99), at("dirk", 119)])],
      TWO,
    );
    expect(plan.totalCents).toBe(448);
    expect(explainPlan(plan)[0]).toEqual({
      code: "saves-vs-single",
      retailerId: "dirk",
      singleTotalCents: 468,
      savingCents: 20,
    });
  });

  it("says one chain is the best single stop when the plan is that chain", () => {
    const plan = optimizeBasket([item("kip", [at("ah", 499), at("dirk", 349)])], TWO);
    expect(explainPlan(plan)[0]).toEqual({ code: "one-store", retailerId: "dirk" });
  });

  it("claims no saving against a single chain when there is none", () => {
    // No single chain sells both, so there is nothing to compare the route with.
    const plan = optimizeBasket([item("kip", [at("dirk", 349)]), item("melk", [at("ah", 99)])], TWO);
    expect(plan.comparison).toBeNull();
    expect(explainPlan(plan).map((note) => note.code)).not.toContain("saves-vs-single");
    expect(explainPlan(plan).map((note) => note.code)).not.toContain("one-store");
  });

  it("lists the lines that save the most, largest first, offers and price differences alike", () => {
    const plan = optimizeBasket(
      [
        item("kip", [at("ah", 499), at("dirk", 499, 349, 4)]),
        item("melk", [at("ah", 99), at("dirk", 119)]),
        item("koffie", [at("ah", 1299), at("dirk", 1149)]),
      ],
      TWO,
    );
    expect(explainPlan(plan).slice(1)).toEqual([
      { code: "offer", label: "kip", retailerId: "dirk", savingCents: 150, daysLeft: 4 },
      { code: "cheaper", label: "koffie", retailerId: "dirk", nextRetailerId: "ah", differenceCents: 150 },
    ]);
    expect(explainPlan(plan, 3).at(-1)).toEqual({
      code: "cheaper",
      label: "melk",
      retailerId: "ah",
      nextRetailerId: "dirk",
      differenceCents: 20,
    });
  });

  it("honours the limit on line notes", () => {
    const plan = optimizeBasket(
      [item("kip", [at("ah", 499), at("dirk", 349)]), item("melk", [at("ah", 99), at("dirk", 119)])],
      TWO,
    );
    expect(explainPlan(plan, 0)).toHaveLength(1);
    expect(explainPlan(plan, 1)).toHaveLength(2);
    expect(explainPlan(plan, -1)).toHaveLength(1);
  });

  it("skips an offer whose saving is unknown and a line that is no cheaper than the next chain", () => {
    const unknownRegular: Candidate = { ...at("ah", 0, 199), regularPriceCents: null };
    const plan = optimizeBasket([item("kaas", [unknownRegular]), item("brood", [at("ah", 150), at("dirk", 150)])], {
      maxStores: 1,
      mode: "max-savings",
    });
    expect(explainPlan(plan).filter((note) => note.code === "offer" || note.code === "cheaper")).toEqual([]);
  });

  it("counts the saving of an offer for the quantity on the list", () => {
    const plan = optimizeBasket([item("kip", [at("dirk", 499, 349, 0), at("ah", 499)], 2)], TWO);
    expect(explainPlan(plan)).toContainEqual({
      code: "offer",
      label: "kip",
      retailerId: "dirk",
      savingCents: 300,
      daysLeft: 0,
    });
  });
});
