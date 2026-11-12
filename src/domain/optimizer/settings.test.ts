import { describe, expect, it } from "vitest";
import {
  budgetText,
  DEFAULT_PLAN_SETTINGS,
  MAX_BUDGET_CENTS,
  parseBudget,
  parsePlanSettings,
  planSettingsQuery,
  toOptions,
  type PlanSettings,
} from "./settings";

describe("parsePlanSettings", () => {
  it("gives the defaults without parameters", () => {
    expect(parsePlanSettings({})).toEqual(DEFAULT_PLAN_SETTINGS);
    expect(DEFAULT_PLAN_SETTINGS).toEqual({ maxStores: 2, mode: "max-savings", similar: true, budgetCents: null });
  });

  it("reads every setting", () => {
    expect(parsePlanSettings({ stores: "3", mode: "offers-only", similar: "0", budget: "60" })).toEqual({
      maxStores: 3,
      mode: "offers-only",
      similar: false,
      budgetCents: 6000,
    });
    expect(parsePlanSettings({ stores: "1", mode: "organic-only" })).toMatchObject({
      maxStores: 1,
      mode: "organic-only",
    });
    expect(parsePlanSettings({ mode: "fewest-stores" }).mode).toBe("fewest-stores");
  });

  it.each([
    [{ stores: "4" }],
    [{ stores: "0" }],
    [{ stores: "two" }],
    [{ stores: "" }],
    [{ mode: "cheapest" }],
    [{ mode: "" }],
    [{ similar: "no" }],
    [{ similar: "1" }],
    [{ budget: "abc" }],
    [{ budget: "-5" }],
    [{ budget: "0" }],
    [{ budget: "" }],
    [{ unknown: "x" }],
  ])("falls back to the default for %j", (params) => {
    expect(parsePlanSettings(params)).toEqual(DEFAULT_PLAN_SETTINGS);
  });

  it("takes the first value of a repeated parameter and trims it", () => {
    expect(parsePlanSettings({ stores: ["1", "3"], mode: [" fewest-stores "] })).toMatchObject({
      maxStores: 1,
      mode: "fewest-stores",
    });
  });
});

describe("parseBudget", () => {
  it.each([
    ["60", 6000],
    ["60,50", 6050],
    ["60.50", 6050],
    ["60,5", 6050],
    ["60.5", 6050],
    ["€ 45", 4500],
    ["0,99", 99],
    ["9999", MAX_BUDGET_CENTS],
  ])("reads %s as %i cents", (text, cents) => {
    expect(parseBudget(text)).toBe(cents);
  });

  it.each([
    [null],
    [""],
    ["  "],
    ["abc"],
    ["-10"],
    ["0"],
    ["0,00"],
    ["10000"],
    ["1e3"],
    ["12,345"],
    ["60,50,10"],
    ["1234567890123"],
  ])("gives no budget for %j", (text) => {
    expect(parseBudget(text)).toBeNull();
  });
});

describe("planSettingsQuery", () => {
  it("is empty for the defaults", () => {
    expect(planSettingsQuery(DEFAULT_PLAN_SETTINGS)).toBe("");
  });

  it("writes only what differs from the defaults, in a fixed order", () => {
    expect(planSettingsQuery({ maxStores: 3, mode: "fewest-stores", similar: false, budgetCents: 6050 })).toBe(
      "?stores=3&mode=fewest-stores&similar=0&budget=60.50",
    );
    expect(planSettingsQuery({ ...DEFAULT_PLAN_SETTINGS, budgetCents: 4000 })).toBe("?budget=40");
  });

  it("round-trips through parsePlanSettings", () => {
    const settings: PlanSettings[] = [
      DEFAULT_PLAN_SETTINGS,
      { maxStores: 1, mode: "offers-only", similar: false, budgetCents: 99 },
      { maxStores: 3, mode: "organic-only", similar: true, budgetCents: 12345 },
    ];
    for (const value of settings) {
      const params = Object.fromEntries(new URLSearchParams(planSettingsQuery(value)));
      expect(parsePlanSettings(params)).toEqual(value);
    }
  });
});

describe("budgetText", () => {
  it("drops the cents of a whole amount", () => {
    expect(budgetText(6000)).toBe("60");
    expect(budgetText(6050)).toBe("60.50");
    expect(budgetText(5)).toBe("0.05");
  });
});

describe("toOptions", () => {
  it("lets a very similar product compete on price only when allowed", () => {
    expect(toOptions(DEFAULT_PLAN_SETTINGS)).toEqual({
      maxStores: 2,
      mode: "max-savings",
      substitutes: "similar",
      budgetCents: null,
    });
    expect(toOptions({ ...DEFAULT_PLAN_SETTINGS, similar: false, budgetCents: 500 })).toMatchObject({
      substitutes: "same",
      budgetCents: 500,
    });
  });
});
