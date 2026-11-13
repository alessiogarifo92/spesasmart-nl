import { describe, expect, it } from "vitest";
import { allAdapters, findAdapter, REAL_ADAPTERS, selectAdapters } from "./registry";

describe("registry", () => {
  it("lists the four mock adapters, then the real ones", () => {
    expect(allAdapters().map((adapter) => adapter.id)).toEqual([
      "mock:ah",
      "mock:jumbo",
      "mock:vomar",
      "mock:dirk",
      "ah",
      "jumbo",
      "vomar",
      "dirk",
    ]);
  });

  it("real adapters are not mocks, have unique ids and at most a few runs a day", () => {
    expect(REAL_ADAPTERS.every((adapter) => !adapter.isMock && (adapter.maxRunsPerDay ?? 1) <= 3)).toBe(true);
    expect(new Set(allAdapters().map((adapter) => adapter.id)).size).toBe(allAdapters().length);
  });

  it("finds an adapter by id", () => {
    expect(findAdapter("mock:dirk")?.retailerSlug).toBe("dirk");
    expect(findAdapter("jumbo")?.isMock).toBe(false);
    expect(findAdapter("lidl")).toBeUndefined();
  });

  it("selects one adapter or all of them", () => {
    expect(selectAdapters("all")).toHaveLength(allAdapters().length);
    expect(selectAdapters("mock:vomar").map((adapter) => adapter.id)).toEqual(["mock:vomar"]);
    expect(() => selectAdapters("lidl")).toThrow(/Unknown adapter "lidl".*mock:ah/);
  });
});
