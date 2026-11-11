import { describe, expect, it } from "vitest";
import { hasFilters, NO_FILTERS, offerFiltersQuery, parseOfferFilters, toggleRetailer } from "./filters";

describe("parseOfferFilters", () => {
  it("returns no filters for no parameters", () => {
    expect(parseOfferFilters({})).toEqual(NO_FILTERS);
  });

  it("reads every filter", () => {
    expect(
      parseOfferFilters({ retailer: ["jumbo", "ah"], category: "zuivel-eieren", brand: "Molenhof", within: "3", organic: "1" }),
    ).toEqual({ retailers: ["ah", "jumbo"], category: "zuivel-eieren", brand: "Molenhof", within: 3, upcoming: false, organic: true });
  });

  it("accepts comma-separated and repeated chains, without duplicates", () => {
    expect(parseOfferFilters({ retailer: "dirk,ah,dirk" }).retailers).toEqual(["ah", "dirk"]);
  });

  it("ignores values it does not recognise", () => {
    expect(
      parseOfferFilters({ retailer: "AH'; DROP", category: "Not A Slug", within: "5", when: "yesterday", organic: "yes" }),
    ).toEqual(NO_FILTERS);
    expect(parseOfferFilters({ brand: "x".repeat(61) }).brand).toBeNull();
  });

  it("lets upcoming win over an expiry window", () => {
    expect(parseOfferFilters({ when: "upcoming", within: "3" })).toMatchObject({ upcoming: true, within: null });
  });
});

describe("offerFiltersQuery", () => {
  it("is empty without filters", () => {
    expect(offerFiltersQuery(NO_FILTERS)).toBe("");
    expect(hasFilters(NO_FILTERS)).toBe(false);
  });

  it("round-trips through parseOfferFilters", () => {
    const filters = { retailers: ["ah", "vomar"], category: "dranken", brand: "Bruis & Bron", within: 7 as const, upcoming: false, organic: true };
    const query = offerFiltersQuery(filters);
    expect(query).toBe("?retailer=ah&retailer=vomar&category=dranken&brand=Bruis+%26+Bron&within=7&organic=1");
    const params = new URLSearchParams(query);
    expect(
      parseOfferFilters({
        retailer: params.getAll("retailer"),
        category: params.get("category") ?? undefined,
        brand: params.get("brand") ?? undefined,
        within: params.get("within") ?? undefined,
        organic: params.get("organic") ?? undefined,
      }),
    ).toEqual(filters);
    expect(hasFilters(filters)).toBe(true);
  });

  it("writes upcoming instead of a window", () => {
    expect(offerFiltersQuery({ ...NO_FILTERS, upcoming: true, within: 3 })).toBe("?when=upcoming");
  });
});

describe("toggleRetailer", () => {
  it("adds a chain that is off and removes one that is on", () => {
    const withAh = toggleRetailer(NO_FILTERS, "ah");
    expect(withAh.retailers).toEqual(["ah"]);
    expect(toggleRetailer(withAh, "ah").retailers).toEqual([]);
    expect(NO_FILTERS.retailers).toEqual([]);
  });
});
