import { describe, expect, it } from "vitest";
import {
  daysUntilEnd,
  isActiveOn,
  isIsoDate,
  isoDateInAmsterdam,
  isUpcoming,
  parseValidity,
  type Validity,
} from "./validity";

// Wednesday 11 November 2026, ISO week 46.
const today = "2026-11-11";

function range(start: string | null, end: string, approximate = false): Validity {
  return { start, end, approximate };
}

describe("parseValidity", () => {
  it.each<[string, Validity]>([
    ["wo 11 t/m di 17 nov", range("2026-11-11", "2026-11-17")],
    ["Wo 11 T/M Di 17 Nov", range("2026-11-11", "2026-11-17")],
    ["wo. 11 t/m di. 17 nov.", range("2026-11-11", "2026-11-17")],
    ["geldig van wo 11 t/m di 17 nov", range("2026-11-11", "2026-11-17")],
    ["t/m di 17 nov", range(null, "2026-11-17")],
    ["tot en met dinsdag 17 nov", range(null, "2026-11-17")],
    ["geldig t/m 17 november", range(null, "2026-11-17")],
    ["zondag 8 t/m zaterdag 14 november", range("2026-11-08", "2026-11-14")],
    ["ma 16 – zo 22 nov", range("2026-11-16", "2026-11-22")],
    ["ma 16 - zo 22 nov", range("2026-11-16", "2026-11-22")],
    ["16-22 nov", range("2026-11-16", "2026-11-22")],
    ["ma 30 nov t/m zo 6 dec", range("2026-11-30", "2026-12-06")],
    ["28 dec t/m 3 jan", range("2026-12-28", "2027-01-03")],
    ["11 nov", range("2026-11-11", "2026-11-11")],
    ["woensdag 11 november", range("2026-11-11", "2026-11-11")],
    ["do 11 t/m wo 17 nov 2027", range("2027-11-11", "2027-11-17")],
    ["alleen vandaag", range(today, today)],
    ["Vandaag", range(today, today)],
    ["week 46", range("2026-11-09", "2026-11-15", true)],
    ["Week 47", range("2026-11-16", "2026-11-22", true)],
    ["week 53", range("2026-12-28", "2027-01-03", true)],
  ])("reads %j", (text, expected) => {
    expect(parseValidity(text, { today })).toEqual({ ok: true, value: expected });
  });

  describe("year inference", () => {
    it("puts a date more than six months in the past into next year", () => {
      expect(parseValidity("3 jan", { today: "2026-12-20" })).toEqual({
        ok: true,
        value: range("2027-01-03", "2027-01-03"),
      });
      expect(parseValidity("week 2", { today })).toEqual({
        ok: true,
        value: range("2027-01-11", "2027-01-17", true),
      });
    });

    it("puts a date more than six months in the future into last year", () => {
      expect(parseValidity("31 dec", { today: "2027-01-02" })).toEqual({
        ok: true,
        value: range("2026-12-31", "2026-12-31"),
      });
    });

    it("keeps a recently ended offer in the current year", () => {
      expect(parseValidity("t/m 1 nov", { today })).toEqual({ ok: true, value: range(null, "2026-11-01") });
    });

    it("spans the year boundary from either side", () => {
      const expected = { ok: true, value: range("2026-12-28", "2027-01-03") };
      expect(parseValidity("28 dec t/m 3 jan", { today: "2026-12-20" })).toEqual(expected);
      expect(parseValidity("28 dec t/m 3 jan", { today: "2027-01-02" })).toEqual(expected);
    });

    it("finds a leap day in the next leap year", () => {
      expect(parseValidity("29 feb", { today: "2027-11-11" })).toEqual({
        ok: true,
        value: range("2028-02-29", "2028-02-29"),
      });
    });

    it("finds week 53 of last year when this year has none", () => {
      expect(parseValidity("week 53", { today: "2027-03-01" })).toEqual({
        ok: true,
        value: range("2026-12-28", "2027-01-03", true),
      });
    });
  });

  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["binnenkort", "unrecognised"],
    ["t/m 17", "unrecognised"],
    ["11 nov t/m", "unrecognised"],
    ["tot 17 nov", "unrecognised"],
    ["11 t/m 17", "unrecognised"],
    ["11 t/m 17 t/m 20 nov", "unrecognised"],
    ["11 foo", "unrecognised"],
    ["vr 11 nov", "weekday-mismatch"],
    ["di 11 t/m di 17 nov", "weekday-mismatch"],
    ["wo 11 t/m wo 17 nov", "weekday-mismatch"],
    ["17 t/m 11 nov", "start-after-end"],
    ["17 nov t/m 11 nov", "start-after-end"],
    ["31 nov", "invalid-date"],
    ["29 feb", "invalid-date"],
    ["0 nov", "invalid-date"],
    ["week 0", "invalid-date"],
    ["week 54", "invalid-date"],
  ])("does not recognise %j (%s)", (text, reason) => {
    expect(parseValidity(text, { today })).toEqual({ ok: false, reason });
  });

  it("refuses a malformed today", () => {
    expect(() => parseValidity("11 nov", { today: "11-11-2026" })).toThrow(RangeError);
  });
});

describe("isActiveOn", () => {
  const week = range("2026-11-11", "2026-11-17");

  it("includes both the first and the last day", () => {
    expect(isActiveOn(week, "2026-11-11")).toBe(true);
    expect(isActiveOn(week, "2026-11-14")).toBe(true);
    expect(isActiveOn(week, "2026-11-17")).toBe(true);
  });

  it("excludes days outside the range", () => {
    expect(isActiveOn(week, "2026-11-10")).toBe(false);
    expect(isActiveOn(week, "2026-11-18")).toBe(false);
  });

  it("treats an unstated start as already started", () => {
    expect(isActiveOn(range(null, "2026-11-17"), "2026-01-01")).toBe(true);
    expect(isActiveOn(range(null, "2026-11-17"), "2026-11-18")).toBe(false);
  });

  it("refuses a malformed date", () => {
    expect(() => isActiveOn(week, "2026-13-01")).toThrow(RangeError);
  });
});

describe("daysUntilEnd", () => {
  const week = range("2026-11-11", "2026-11-17");

  it("counts whole days to the last day", () => {
    expect(daysUntilEnd(week, "2026-11-11")).toBe(6);
    expect(daysUntilEnd(week, "2026-11-17")).toBe(0);
    expect(daysUntilEnd(week, "2026-11-19")).toBe(-2);
  });

  it("counts across the year boundary and a DST change", () => {
    expect(daysUntilEnd(range("2026-12-28", "2027-01-03"), "2026-12-28")).toBe(6);
    expect(daysUntilEnd(range(null, "2026-03-30"), "2026-03-28")).toBe(2);
  });
});

describe("isUpcoming", () => {
  const week = range("2026-11-11", "2026-11-17");

  it("is true only before the first day", () => {
    expect(isUpcoming(week, "2026-11-10")).toBe(true);
    expect(isUpcoming(week, "2026-11-11")).toBe(false);
    expect(isUpcoming(week, "2026-11-20")).toBe(false);
  });

  it("is false when the start is not stated", () => {
    expect(isUpcoming(range(null, "2026-11-17"), "2026-11-01")).toBe(false);
  });
});

describe("isIsoDate", () => {
  it.each(["2026-11-11", "2028-02-29", "2026-01-01"])("accepts %j", (text) => {
    expect(isIsoDate(text)).toBe(true);
  });

  it.each(["2026-02-29", "2026-13-01", "2026-11-31", "2026-1-1", "20261111", "", "2026-11-11T00:00"])(
    "rejects %j",
    (text) => {
      expect(isIsoDate(text)).toBe(false);
    },
  );
});

describe("isoDateInAmsterdam", () => {
  it("uses the Amsterdam calendar day in winter time (UTC+1)", () => {
    expect(isoDateInAmsterdam(new Date("2026-11-10T23:30:00Z"))).toBe("2026-11-11");
    expect(isoDateInAmsterdam(new Date("2026-11-10T22:59:00Z"))).toBe("2026-11-10");
  });

  it("uses the Amsterdam calendar day in summer time (UTC+2)", () => {
    expect(isoDateInAmsterdam(new Date("2026-07-01T22:30:00Z"))).toBe("2026-07-02");
    expect(isoDateInAmsterdam(new Date("2026-07-01T21:59:00Z"))).toBe("2026-07-01");
  });

  it("refuses an invalid Date", () => {
    expect(() => isoDateInAmsterdam(new Date("nope"))).toThrow(RangeError);
  });
});
