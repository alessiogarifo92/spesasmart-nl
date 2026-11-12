import { describe, expect, it } from "vitest";
import type { RetailerAdapter } from "./adapter";
import { adapterSwitch, parseEnabledAdapters } from "./switches";

function adapter(id: string, isMock: boolean): RetailerAdapter {
  const none = async () => [];
  const refuse = () => ({ ok: false as const, reason: "unused" });
  return {
    id,
    retailerSlug: "jumbo",
    isMock,
    fetchOffers: none,
    fetchUpcomingOffers: none,
    fetchStoreLocations: none,
    normalizeProduct: refuse,
    normalizeOffer: refuse,
  };
}

describe("parseEnabledAdapters", () => {
  it("reads a comma-separated list, ignoring blanks, spaces and case", () => {
    expect(parseEnabledAdapters(" Jumbo, dirk ,,vomar ")).toEqual(["jumbo", "dirk", "vomar"]);
  });

  it("is empty when the variable is empty or unset", () => {
    expect(parseEnabledAdapters("")).toEqual([]);
    expect(parseEnabledAdapters("  ")).toEqual([]);
    expect(parseEnabledAdapters(undefined)).toEqual([]);
  });
});

describe("adapterSwitch", () => {
  const real = adapter("jumbo", false);

  it("always runs a mock adapter", () => {
    expect(adapterSwitch({ adapter: adapter("mock:jumbo", true), enabledAdapters: [], retailerAdapterEnabled: false })).toEqual({
      run: true,
    });
  });

  it("runs a real adapter only when both switches are on", () => {
    expect(adapterSwitch({ adapter: real, enabledAdapters: ["jumbo"], retailerAdapterEnabled: true })).toEqual({ run: true });
  });

  it("stops a real adapter missing from the environment list", () => {
    const decision = adapterSwitch({ adapter: real, enabledAdapters: ["dirk"], retailerAdapterEnabled: true });
    expect(decision.run).toBe(false);
    expect(decision).toMatchObject({ reason: expect.stringMatching(/INGESTION_ENABLED_ADAPTERS/) });
  });

  it("stops a real adapter whose retailer switch is off", () => {
    const decision = adapterSwitch({ adapter: real, enabledAdapters: ["jumbo"], retailerAdapterEnabled: false });
    expect(decision.run).toBe(false);
    expect(decision).toMatchObject({ reason: expect.stringMatching(/adapterEnabled/) });
  });
});
