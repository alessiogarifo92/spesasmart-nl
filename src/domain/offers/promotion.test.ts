import { describe, expect, it } from "vitest";
import { promotionFromStored } from "./promotion";

describe("promotionFromStored", () => {
  it("rebuilds every mechanic from its stored parameters", () => {
    expect(promotionFromStored("PRICE_CUT", {}, null)).toEqual({ type: "PRICE_CUT" });
    expect(promotionFromStored("X_PLUS_Y_FREE", { buy: 1, free: 1 }, "1+1 gratis")).toEqual({ type: "X_PLUS_Y_FREE", buy: 1, free: 1 });
    expect(promotionFromStored("NTH_HALF_PRICE", { n: 2 }, null)).toEqual({ type: "NTH_HALF_PRICE", n: 2 });
    expect(promotionFromStored("X_FOR_PRICE", { quantity: 2, totalCents: 1100 }, null)).toEqual({ type: "X_FOR_PRICE", quantity: 2, totalCents: 1100 });
    expect(promotionFromStored("PERCENT_OFF", { percent: 25 }, null)).toEqual({ type: "PERCENT_OFF", percent: 25 });
  });

  it("falls back to UNKNOWN with the stored wording when parameters do not fit", () => {
    expect(promotionFromStored("X_PLUS_Y_FREE", { buy: 1 }, "1+1 gratis")).toEqual({ type: "UNKNOWN", text: "1+1 gratis" });
    expect(promotionFromStored("X_FOR_PRICE", { quantity: 0, totalCents: 100 }, null)).toEqual({ type: "UNKNOWN", text: "" });
    expect(promotionFromStored("PERCENT_OFF", { percent: 120 }, null)).toMatchObject({ type: "UNKNOWN" });
    expect(promotionFromStored("NTH_HALF_PRICE", null, null)).toMatchObject({ type: "UNKNOWN" });
    expect(promotionFromStored("PERCENT_OFF", "25", null)).toMatchObject({ type: "UNKNOWN" });
  });

  it("keeps UNKNOWN and unheard-of types unknown", () => {
    expect(promotionFromStored("UNKNOWN", {}, "Actie")).toEqual({ type: "UNKNOWN", text: "Actie" });
    expect(promotionFromStored("BOGOF", {}, null)).toEqual({ type: "UNKNOWN", text: "" });
  });
});
