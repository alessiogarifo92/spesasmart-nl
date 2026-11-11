import { fail, ok, type Result } from "./result";

/** A calendar date as "YYYY-MM-DD", in the Europe/Amsterdam calendar. */
export type IsoDate = string;

/** Offer validity, both ends inclusive. */
export type Validity = {
  /** First day; null when the text states only an end ("t/m di 17 nov"). */
  start: IsoDate | null;
  end: IsoDate;
  /** True for a calendar-week label ("week 46"): retailer weeks do not start on Monday. */
  approximate: boolean;
};

export type ValidityReason =
  | "empty"
  | "unrecognised"
  | "invalid-date"
  | "weekday-mismatch"
  | "start-after-end";

const DAY_MS = 86_400_000;
/** Dates without a year are placed within about six months of today. */
const HALF_YEAR_DAYS = 183;

const WEEKDAYS: Record<string, number> = {
  ma: 1, maandag: 1,
  di: 2, dinsdag: 2,
  wo: 3, woensdag: 3,
  do: 4, donderdag: 4,
  vr: 5, vrijdag: 5,
  za: 6, zaterdag: 6,
  zo: 7, zondag: 7,
};

const MONTHS: Record<string, number> = {
  jan: 1, januari: 1,
  feb: 2, februari: 2,
  mrt: 3, maart: 3,
  apr: 4, april: 4,
  mei: 5,
  jun: 6, juni: 6,
  jul: 7, juli: 7,
  aug: 8, augustus: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

// --- Day numbers: days since 1970-01-01, the internal arithmetic for calendar dates. ---

function dayNumber(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

function exists(year: number, month: number, day: number): boolean {
  const date = new Date(dayNumber(year, month, day) * DAY_MS);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function toIso(days: number): IsoDate {
  const date = new Date(days * DAY_MS);
  const pad = (n: number, width: number) => String(n).padStart(width, "0");
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}`;
}

/** 1 = Monday … 7 = Sunday (ISO 8601). Day 0 was a Thursday. */
function isoWeekday(days: number): number {
  return ((((days + 3) % 7) + 7) % 7) + 1;
}

function readIso(text: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return exists(year, month, day) ? { year, month, day } : null;
}

function isoToDays(text: IsoDate): number {
  const date = readIso(text);
  if (!date) throw new RangeError(`Expected a YYYY-MM-DD date, got ${JSON.stringify(text)}`);
  return dayNumber(date.year, date.month, date.day);
}

/** True for an existing calendar date written as "YYYY-MM-DD". */
export function isIsoDate(text: string): boolean {
  return readIso(text) !== null;
}

/** Explicit converter from an instant to its calendar date in Europe/Amsterdam. */
export function isoDateInAmsterdam(instant: Date): IsoDate {
  if (Number.isNaN(instant.getTime())) throw new RangeError("Invalid Date");
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

// --- Year and week inference ---

/** Shifts a year so the date lands within about six months of today. */
function nearestYear(year: number, candidateDays: number, todayDays: number): number {
  if (candidateDays < todayDays - HALF_YEAR_DAYS) return year + 1;
  if (candidateDays > todayDays + HALF_YEAR_DAYS) return year - 1;
  return year;
}

function weekOneMonday(isoYear: number): number {
  const january4 = dayNumber(isoYear, 1, 4);
  return january4 - (isoWeekday(january4) - 1);
}

function isoWeekYear(days: number): number {
  const thursday = days - isoWeekday(days) + 4;
  return new Date(thursday * DAY_MS).getUTCFullYear();
}

function weeksInIsoYear(isoYear: number): number {
  return (weekOneMonday(isoYear + 1) - weekOneMonday(isoYear)) / 7;
}

function weekValidity(week: number, todayDays: number): Result<Validity, ValidityReason> {
  if (week < 1 || week > 53) return fail("invalid-date");
  const todayYear = isoWeekYear(todayDays);
  const candidate = weekOneMonday(todayYear) + (week - 1) * 7;
  const year = nearestYear(todayYear, candidate, todayDays);
  if (week > weeksInIsoYear(year)) return fail("invalid-date");
  const monday = weekOneMonday(year) + (week - 1) * 7;
  return ok({ start: toIso(monday), end: toIso(monday + 6), approximate: true });
}

// --- Text parsing ---

type DatePart = { weekday?: number; day: number; month?: number; year?: number };

const DATE_PART = /^(?:([a-z]+) )?(\d{1,2})(?: ([a-z]+))?(?: (\d{4}))?$/;

function readDatePart(text: string): DatePart | null {
  const match = DATE_PART.exec(text);
  if (!match) return null;
  const [, weekdayWord, dayText, monthWord, yearText] = match;
  const part: DatePart = { day: Number(dayText) };
  if (weekdayWord !== undefined) {
    if (!(weekdayWord in WEEKDAYS)) return null;
    part.weekday = WEEKDAYS[weekdayWord];
  }
  if (monthWord !== undefined) {
    if (!(monthWord in MONTHS)) return null;
    part.month = MONTHS[monthWord];
  }
  if (yearText !== undefined) {
    if (part.month === undefined) return null;
    part.year = Number(yearText);
  }
  return part;
}

type Resolved = { days: number } | "invalid-date" | "weekday-mismatch";

function resolve(part: DatePart, month: number, year: number): Resolved {
  if (!exists(year, month, part.day)) return "invalid-date";
  const days = dayNumber(year, month, part.day);
  if (part.weekday !== undefined && part.weekday !== isoWeekday(days)) return "weekday-mismatch";
  return { days };
}

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^geldig (?:van )?/, "")
    .replace(/^van /, "");
}

/**
 * Parses Dutch validity text ("wo 11 t/m di 17 nov", "ma 16 – zo 22 nov", "week 46",
 * "alleen vandaag", "11 nov") into inclusive calendar dates. A missing year is taken from
 * `today` so the end date lands within about six months of it; a range whose start month is
 * after its end month ("28 dec t/m 3 jan") starts in the previous year. A stated weekday must
 * match the date. Bare "tot" (exclusive) is not recognised.
 */
export function parseValidity(text: string, context: { today: IsoDate }): Result<Validity, ValidityReason> {
  const todayDays = isoToDays(context.today);
  const todayYear = Number(context.today.slice(0, 4));
  const normalised = normalise(text);
  if (normalised === "") return fail("empty");

  if (/^(?:alleen )?vandaag$/.test(normalised)) {
    return ok({ start: context.today, end: context.today, approximate: false });
  }
  const week = /^(?:week|wk) (\d{1,2})$/.exec(normalised);
  if (week) return weekValidity(Number(week[1]), todayDays);

  const sides = normalised.replace(/ ?(?:t\/m|tot en met|-) ?/g, "|").split("|");
  if (sides.length > 2) return fail("unrecognised");
  const startText = sides.length === 2 ? sides[0].trim() : null;
  const endPart = readDatePart(sides[sides.length - 1].trim());
  if (!endPart || endPart.month === undefined) return fail("unrecognised");

  const endMonth = endPart.month;
  const endYear =
    endPart.year ?? nearestYear(todayYear, dayNumber(todayYear, endMonth, endPart.day), todayDays);
  const end = resolve(endPart, endMonth, endYear);
  if (typeof end === "string") return fail(end);

  // Single date, or an end date only ("t/m di 17 nov").
  if (startText === null) return ok({ start: toIso(end.days), end: toIso(end.days), approximate: false });
  if (startText === "") return ok({ start: null, end: toIso(end.days), approximate: false });

  const startPart = readDatePart(startText);
  if (!startPart) return fail("unrecognised");
  const startMonth = startPart.month ?? endMonth;
  const startYear = startPart.year ?? (startMonth > endMonth ? endYear - 1 : endYear);
  const start = resolve(startPart, startMonth, startYear);
  if (typeof start === "string") return fail(start);
  if (start.days > end.days) return fail("start-after-end");

  return ok({ start: toIso(start.days), end: toIso(end.days), approximate: false });
}

// --- Helpers on parsed validity ---

/** True when `date` falls within the validity. An unstated start counts as already started. */
export function isActiveOn(validity: Validity, date: IsoDate): boolean {
  const days = isoToDays(date);
  const started = validity.start === null || isoToDays(validity.start) <= days;
  return started && days <= isoToDays(validity.end);
}

/** Whole days from `today` to the last valid day: 0 on the last day, negative once ended. */
export function daysUntilEnd(validity: Validity, today: IsoDate): number {
  return isoToDays(validity.end) - isoToDays(today);
}

/** True when the validity starts after `today`. False when the start is not stated. */
export function isUpcoming(validity: Validity, today: IsoDate): boolean {
  return validity.start !== null && isoToDays(validity.start) > isoToDays(today);
}
