import { describe, expect, it } from "vitest";
import * as pricing from "./index";

describe("pricing public API", () => {
  it("re-exports every module's functions", () => {
    expect(Object.keys(pricing).sort()).toEqual(
      [
        "daysUntilEnd",
        "discountPercent",
        "effectiveTotalCents",
        "effectiveUnitCents",
        "fail",
        "formatCents",
        "formatUnitBasis",
        "isActiveOn",
        "isIsoDate",
        "isUpcoming",
        "isValidEan",
        "isoDateInAmsterdam",
        "minimumQuantityForDeal",
        "normalizeEan",
        "ok",
        "parsePriceCents",
        "parsePromotion",
        "parseQuantity",
        "parseValidity",
        "roundHalfUp",
        "unitPrice",
      ].sort(),
    );
  });
});
