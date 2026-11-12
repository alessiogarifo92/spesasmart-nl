import { describe, expect, it } from "vitest";
import { allAdapters, findAdapter, selectAdapters } from "./registry";

describe("registry", () => {
  it("lists the four mock adapters", () => {
    expect(allAdapters().map((adapter) => adapter.id)).toEqual(["mock:ah", "mock:jumbo", "mock:vomar", "mock:dirk"]);
  });

  it("finds an adapter by id", () => {
    expect(findAdapter("mock:dirk")?.retailerSlug).toBe("dirk");
    expect(findAdapter("dirk")).toBeUndefined();
  });

  it("selects one adapter or all of them", () => {
    expect(selectAdapters("all")).toHaveLength(4);
    expect(selectAdapters("mock:vomar").map((adapter) => adapter.id)).toEqual(["mock:vomar"]);
    expect(() => selectAdapters("lidl")).toThrow(/Unknown adapter "lidl".*mock:ah/);
  });
});
