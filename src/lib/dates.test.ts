import { describe, expect, it } from "vitest";
import { addDays, amsterdamToday, daysBetween, dbDateToIso, isIsoDate, isoToDbDate } from "./dates";

describe("isIsoDate", () => {
  it("accepts real calendar dates", () => {
    expect(isIsoDate("2026-11-11")).toBe(true);
    expect(isIsoDate("2028-02-29")).toBe(true);
  });

  it("rejects impossible dates and other formats", () => {
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("11-11-2026")).toBe(false);
    expect(isIsoDate("2026-11-11T00:00:00Z")).toBe(false);
    expect(isIsoDate("")).toBe(false);
  });
});

describe("amsterdamToday", () => {
  it("uses the Amsterdam calendar day, not the UTC one", () => {
    // 23:30 UTC in winter is already the next day in Amsterdam (UTC+1).
    expect(amsterdamToday(new Date("2026-11-11T23:30:00Z"))).toBe("2026-11-12");
    expect(amsterdamToday(new Date("2026-11-11T22:30:00Z"))).toBe("2026-11-11");
  });

  it("follows summer time (UTC+2)", () => {
    expect(amsterdamToday(new Date("2026-07-01T22:30:00Z"))).toBe("2026-07-02");
    expect(amsterdamToday(new Date("2026-07-01T21:30:00Z"))).toBe("2026-07-01");
  });
});

describe("addDays and daysBetween", () => {
  it("crosses month and year boundaries", () => {
    expect(addDays("2026-11-28", 4)).toBe("2026-12-02");
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-11-11", 0)).toBe("2026-11-11");
  });

  it("is not thrown off by the summer-time switch", () => {
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30");
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
  });

  it("counts whole days in both directions", () => {
    expect(daysBetween("2026-11-11", "2026-11-15")).toBe(4);
    expect(daysBetween("2026-11-15", "2026-11-11")).toBe(-4);
    expect(daysBetween("2026-11-11", "2026-11-11")).toBe(0);
  });

  it("refuses a value that is not a calendar date", () => {
    expect(() => addDays("tomorrow", 1)).toThrow(RangeError);
    expect(() => daysBetween("2026-02-30", "2026-03-01")).toThrow(RangeError);
  });
});

describe("database conversion", () => {
  it("round-trips through UTC midnight", () => {
    const stored = isoToDbDate("2026-11-11");
    expect(stored.toISOString()).toBe("2026-11-11T00:00:00.000Z");
    expect(dbDateToIso(stored)).toBe("2026-11-11");
  });

  it("refuses an invalid date", () => {
    expect(() => isoToDbDate("2026-11-31")).toThrow(RangeError);
  });
});
