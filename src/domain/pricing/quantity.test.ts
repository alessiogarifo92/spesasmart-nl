import { describe, expect, it } from "vitest";
import { formatUnitBasis, parseQuantity, unitPrice, type Quantity } from "./quantity";

function quantity(
  amount: number,
  unit: Quantity["unit"],
  count = 1,
  approximate = false,
): Quantity {
  return { amount, unit, count, totalAmount: amount * count, approximate };
}

describe("parseQuantity", () => {
  it.each([
    ["500 g", quantity(500, "g")],
    ["500g", quantity(500, "g")],
    ["500 gram", quantity(500, "g")],
    ["500 gr", quantity(500, "g")],
    ["500 GRAM", quantity(500, "g")],
    ["1 kg", quantity(1000, "g")],
    ["1,5 kg", quantity(1500, "g")],
    ["1.5 kilo", quantity(1500, "g")],
    ["1,1 kg", quantity(1100, "g")],
    ["1 l", quantity(1000, "ml")],
    ["1 liter", quantity(1000, "ml")],
    ["1,5 L", quantity(1500, "ml")],
    ["0,75 ltr", quantity(750, "ml")],
    ["330 ml", quantity(330, "ml")],
    ["75 cl", quantity(750, "ml")],
    ["6 x 330 ml", quantity(330, "ml", 6)],
    ["6x330ml", quantity(330, "ml", 6)],
    ["6 × 33 cl", quantity(330, "ml", 6)],
    ["4x125g", quantity(125, "g", 4)],
    ["2 x 1,5 liter", quantity(1500, "ml", 2)],
    ["per stuk", quantity(1, "piece")],
    ["1 stuk", quantity(1, "piece")],
    ["3 stuks", quantity(3, "piece")],
    ["tray 30 stuks", quantity(30, "piece")],
    ["10 st.", quantity(10, "piece")],
    ["2 x 3 stuks", quantity(3, "piece", 2)],
    ["per kilo", quantity(1000, "g")],
    ["per 100 gram", quantity(100, "g")],
    ["ca. 400 g", quantity(400, "g", 1, true)],
    ["circa 1 kg", quantity(1000, "g", 1, true)],
    ["± 250 gram", quantity(250, "g", 1, true)],
    ["  500  g  ", quantity(500, "g")],
  ])("reads %j", (text, expected) => {
    expect(parseQuantity(text)).toEqual({ ok: true, value: expected });
  });

  it.each(["386-410 gram", "386 - 410 g", "386–410 gram", "1-1,5 kg"])(
    "refuses to average the range %j",
    (text) => {
      expect(parseQuantity(text)).toEqual({ ok: false, reason: "range" });
    },
  );

  it.each(["", "   "])("rejects the empty %j", (text) => {
    expect(parseQuantity(text)).toEqual({ ok: false, reason: "empty" });
  });

  it.each(["0 g", "0 x 330 ml", "6 x 0 ml", "per 0 stuks"])("rejects the zero %j", (text) => {
    expect(parseQuantity(text)).toEqual({ ok: false, reason: "zero" });
  });

  it.each([
    ["500", "no unit"],
    ["kg", "no number"],
    ["500 ounces", "unknown unit"],
    ["doos 500 g extra", "trailing words"],
    ["bos", "a bunch has no number"],
    ["1,2,3 kg", "garbled number"],
    ["6 x 330", "multipack without unit"],
    ["x 330 ml", "multipack without count"],
    ["1,5 stuks", "fractional pieces"],
    ["2 x 3 x 100 g", "nested multipack"],
    ["1.000 g", "dot thousands could be 1 g or 1000 g"],
    ["1,2345 kg", "not a whole number of grams"],
  ])("rejects %j (%s)", (text) => {
    expect(parseQuantity(text)).toEqual({ ok: false, reason: "unrecognised" });
  });
});

describe("unitPrice", () => {
  it("gives the price per kg for grams", () => {
    expect(unitPrice(199, quantity(500, "g"))).toEqual({ cents: 398, basis: "kg" });
  });

  it("gives the price per litre for millilitres", () => {
    expect(unitPrice(549, quantity(330, "ml", 6))).toEqual({ cents: 277, basis: "l" });
  });

  it("gives the price per piece for pieces", () => {
    expect(unitPrice(399, quantity(30, "piece"))).toEqual({ cents: 13, basis: "piece" });
  });

  it("rounds half up to whole cents", () => {
    // 199 cents for 400 g = 497.5 cents per kg
    expect(unitPrice(199, quantity(400, "g"))).toEqual({ cents: 498, basis: "kg" });
    // 1 cent for 3 pieces = 0.33 cents per piece
    expect(unitPrice(1, quantity(3, "piece"))).toEqual({ cents: 0, basis: "piece" });
    // 5 cents for 2 pieces = 2.5 cents per piece
    expect(unitPrice(5, quantity(2, "piece"))).toEqual({ cents: 3, basis: "piece" });
  });

  it("accepts a zero price", () => {
    expect(unitPrice(0, quantity(1, "piece"))).toEqual({ cents: 0, basis: "piece" });
  });

  it("refuses invalid arguments", () => {
    expect(() => unitPrice(1.5, quantity(500, "g"))).toThrow(RangeError);
    expect(() => unitPrice(-1, quantity(500, "g"))).toThrow(RangeError);
    expect(() => unitPrice(100, quantity(0, "g"))).toThrow(RangeError);
  });
});

describe("formatUnitBasis", () => {
  it.each([
    ["kg", "nl", "per kg"],
    ["l", "nl", "per liter"],
    ["piece", "nl", "per stuk"],
    ["kg", "en", "per kg"],
    ["l", "en", "per litre"],
    ["piece", "en", "per piece"],
    ["kg", "it", "al kg"],
    ["l", "it", "al litro"],
    ["piece", "it", "al pezzo"],
  ] as const)("formats %s in %s as %j", (basis, locale, expected) => {
    expect(formatUnitBasis(basis, locale)).toBe(expected);
  });

  it("accepts region-tagged locales and defaults to Dutch", () => {
    expect(formatUnitBasis("l", "en-GB")).toBe("per litre");
    expect(formatUnitBasis("l", "nl-NL")).toBe("per liter");
    expect(formatUnitBasis("l")).toBe("per liter");
  });

  it("falls back to Dutch for a locale without labels", () => {
    expect(formatUnitBasis("piece", "pl")).toBe("per stuk");
  });
});
