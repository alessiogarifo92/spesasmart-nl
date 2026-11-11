import { describe, expect, it } from "vitest";
import { isValidEan, normalizeEan } from "./ean";

describe("isValidEan", () => {
  it.each([
    ["8710400000006", "EAN-13"],
    ["4006381333931", "EAN-13"],
    ["8710400000013", "EAN-13 with check digit 3"],
    ["96385074", "EAN-8"],
    ["73513537", "EAN-8"],
  ])("accepts %s (%s)", (text) => {
    expect(isValidEan(text)).toBe(true);
  });

  it.each([
    ["8710400000007", "wrong check digit"],
    ["96385075", "wrong EAN-8 check digit"],
    ["871040000000", "12 digits (UPC-A is not an EAN until normalised)"],
    ["87104000000061", "14 digits"],
    ["1234567", "7 digits"],
    ["", "empty"],
    ["8710 4000 0000 6", "spaces (not normalised)"],
    ["871040000000X", "non-digit"],
    ["-871040000006", "sign"],
  ])("rejects %s (%s)", (text) => {
    expect(isValidEan(text)).toBe(false);
  });
});

describe("normalizeEan", () => {
  it("returns a valid EAN-13 unchanged", () => {
    expect(normalizeEan("8710400000006")).toEqual({ ok: true, value: "8710400000006" });
  });

  it("strips spaces, including non-breaking ones", () => {
    expect(normalizeEan(" 8710 4000\u00a00000 6 ")).toEqual({
      ok: true,
      value: "8710400000006",
    });
  });

  it("pads a 12-digit UPC-A to 13 digits with a leading zero", () => {
    expect(normalizeEan("036000291452")).toEqual({ ok: true, value: "0036000291452" });
  });

  it("keeps an EAN-8 as 8 digits", () => {
    expect(normalizeEan("9638 5074")).toEqual({ ok: true, value: "96385074" });
  });

  it("rejects empty input", () => {
    expect(normalizeEan("   ")).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects non-digits instead of dropping them", () => {
    expect(normalizeEan("8710-4000-0000-6")).toEqual({ ok: false, reason: "non-digit" });
    expect(normalizeEan("871040000000X")).toEqual({ ok: false, reason: "non-digit" });
  });

  it("rejects lengths other than 8, 12 or 13", () => {
    expect(normalizeEan("1234567")).toEqual({ ok: false, reason: "length" });
    expect(normalizeEan("87104000000061")).toEqual({ ok: false, reason: "length" });
  });

  it("rejects a wrong check digit, also after padding a UPC-A", () => {
    expect(normalizeEan("8710400000007")).toEqual({ ok: false, reason: "checksum" });
    expect(normalizeEan("036000291453")).toEqual({ ok: false, reason: "checksum" });
  });
});
