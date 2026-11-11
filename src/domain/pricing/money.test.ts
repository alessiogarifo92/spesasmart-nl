import { describe, expect, it } from "vitest";
import { formatCents, parsePriceCents, roundHalfUp } from "./money";

describe("parsePriceCents", () => {
  it.each([
    ["1,99", 199],
    ["€ 1,99", 199],
    ["€1,99", 199],
    ["€ 1,99", 199],
    ["1,99 €", 199],
    ["EUR 1,99", 199],
    ["1.99", 199],
    ["0,99", 99],
    ["0.05", 5],
    ["5.-", 500],
    ["5,-", 500],
    ["5,--", 500],
    ["5,–", 500],
    ["2", 200],
    ["199", 19900],
    ["1.299,00", 129900],
    ["12.345.678,90", 1234567890],
    ["  3,50  ", 350],
  ])("reads %j as %i cents", (text, cents) => {
    expect(parsePriceCents(text)).toEqual({ ok: true, value: cents });
  });

  describe("with impliedCents", () => {
    it.each([
      ["199", 199],
      ["198", 198],
      ["99", 99],
      ["5", 5],
      ["1299", 1299],
    ])("reads bare digits %j as %i cents", (text, cents) => {
      expect(parsePriceCents(text, { impliedCents: true })).toEqual({ ok: true, value: cents });
    });

    it("still honours an explicit separator", () => {
      expect(parsePriceCents("1,98", { impliedCents: true })).toEqual({ ok: true, value: 198 });
      expect(parsePriceCents("5.-", { impliedCents: true })).toEqual({ ok: true, value: 500 });
    });
  });

  describe("zero", () => {
    it.each(["0", "0,00", "0.-", "€ 0,00"])("rejects %j by default", (text) => {
      expect(parsePriceCents(text)).toEqual({ ok: false, reason: "zero" });
    });

    it("accepts zero when allowed", () => {
      expect(parsePriceCents("0,00", { allowZero: true })).toEqual({ ok: true, value: 0 });
      expect(parsePriceCents("0", { allowZero: true, impliedCents: true })).toEqual({
        ok: true,
        value: 0,
      });
    });
  });

  it.each(["-1,99", "- 1,99", "€ -1,99", "−1,99"])("rejects the negative %j", (text) => {
    expect(parsePriceCents(text)).toEqual({ ok: false, reason: "negative" });
  });

  it.each(["", "   ", "€"])("rejects the empty %j", (text) => {
    expect(parsePriceCents(text)).toEqual({ ok: false, reason: "empty" });
  });

  it.each([
    ["abc", "letters"],
    ["1,9", "one decimal"],
    ["1,999", "three decimals"],
    ["1.299", "dot thousands without decimals is ambiguous"],
    ["1,299.00", "English thousands"],
    ["1.2.3", "several dots"],
    [",99", "no euro digits"],
    ["1,99 per kg", "trailing words"],
    ["1 99", "space inside the number"],
    ["2 voor 3,00", "a promotion, not a price"],
    ["1e3", "exponent"],
    ["Infinity", "not a number"],
  ])("rejects %j (%s)", (text) => {
    expect(parsePriceCents(text)).toEqual({ ok: false, reason: "unrecognised" });
  });

  it("rejects amounts beyond safe integer cents", () => {
    expect(parsePriceCents("99999999999999999")).toEqual({ ok: false, reason: "too-large" });
  });
});

describe("formatCents", () => {
  it("formats Dutch prices with the euro sign first", () => {
    expect(formatCents(199, "nl-NL")).toBe("€ 1,99");
    expect(formatCents(129900, "nl-NL")).toBe("€ 1.299,00");
    expect(formatCents(0, "nl-NL")).toBe("€ 0,00");
  });

  it("defaults to nl-NL", () => {
    expect(formatCents(5)).toBe("€ 0,05");
  });

  it("follows the given locale", () => {
    expect(formatCents(199, "en-GB")).toBe("€1.99");
    expect(formatCents(199, "it-IT")).toBe("1,99 €");
  });

  it("formats negative amounts", () => {
    expect(formatCents(-250, "nl-NL")).toBe("€ -2,50");
  });

  it("refuses non-integer cents", () => {
    expect(() => formatCents(1.5, "nl-NL")).toThrow(RangeError);
    expect(() => formatCents(Number.NaN, "nl-NL")).toThrow(RangeError);
  });
});

describe("roundHalfUp", () => {
  it.each([
    [995, 2, 498],
    [994, 2, 497],
    [1, 3, 0],
    [2, 3, 1],
    [199000, 400, 498],
    [0, 7, 0],
    [17412.5, 100, 174],
  ])("rounds %d / %d to %i", (numerator, denominator, expected) => {
    expect(roundHalfUp(numerator, denominator)).toBe(expected);
  });

  it("refuses a non-positive denominator or a negative numerator", () => {
    expect(() => roundHalfUp(1, 0)).toThrow(RangeError);
    expect(() => roundHalfUp(1, -2)).toThrow(RangeError);
    expect(() => roundHalfUp(-1, 2)).toThrow(RangeError);
  });
});
