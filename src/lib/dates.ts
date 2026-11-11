/**
 * Calendar dates as ISO strings (`YYYY-MM-DD`). Offer validity is a pair of
 * inclusive calendar dates in Europe/Amsterdam, so it is never a timestamp.
 */
export type IsoDate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written as `YYYY-MM-DD`. */
export function isIsoDate(value: string): value is IsoDate {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function assertIsoDate(value: string): void {
  if (!isIsoDate(value)) throw new RangeError(`Not a calendar date: "${value}"`);
}

/** The calendar date in Europe/Amsterdam at the given instant. */
export function amsterdamToday(now: Date): IsoDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Adds (or subtracts) whole days to a calendar date. */
export function addDays(date: IsoDate, days: number): IsoDate {
  return dbDateToIso(new Date(isoToDbDate(date).getTime() + days * 86_400_000));
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((isoToDbDate(to).getTime() - isoToDbDate(from).getTime()) / 86_400_000);
}

/** The value to store in a PostgreSQL `date` column: UTC midnight of that day. */
export function isoToDbDate(date: IsoDate): Date {
  assertIsoDate(date);
  return new Date(`${date}T00:00:00.000Z`);
}

/** Reads a PostgreSQL `date` column (returned as UTC midnight) back as a calendar date. */
export function dbDateToIso(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

/** ISO 8601 week number (weeks start on Monday; week 1 holds the first Thursday). */
export function isoWeek(date: IsoDate): number {
  const day = isoToDbDate(date);
  // Move to the Thursday of this week: its year is the ISO week-numbering year.
  const thursday = new Date(day.getTime() + (3 - ((day.getUTCDay() + 6) % 7)) * 86_400_000);
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  return Math.floor((thursday.getTime() - yearStart) / (7 * 86_400_000)) + 1;
}
