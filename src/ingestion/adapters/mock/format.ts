import { addDays, isoToDbDate, type IsoDate } from "@/lib/dates";
import type { DemoProduct } from "./catalogue";

/**
 * Dutch page text as a chain's offer page prints it, generated from the demo catalogue
 * so that the real domain parsers read it back.
 */

const WEEKDAYS = ["zo", "ma", "di", "wo", "do", "vr", "za"];
const MONTHS = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

/** "3,49", or "349" for chains that print the cents as superscript digits. */
export function formatPrice(cents: number, impliedCents: boolean): string {
  if (impliedCents) return String(cents);
  return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}`;
}

/** Pack size: "500 g", "1 kg", "1 L", "75 ml", "10 stuks", "6 x 330 ml". */
export function formatSize(product: Pick<DemoProduct, "unit" | "packageAmount" | "packageCount">): string {
  const { unit, packageAmount: amount } = product;
  const single =
    unit === "PIECE"
      ? `${amount} stuks`
      : amount % 1000 === 0
        ? `${amount / 1000} ${unit === "G" ? "kg" : "L"}`
        : `${amount} ${unit === "G" ? "g" : "ml"}`;
  const count = product.packageCount ?? 1;
  return count > 1 ? `${count} x ${single}` : single;
}

function datePart(date: IsoDate, withMonth: boolean): string {
  const value = isoToDbDate(date);
  const text = `${WEEKDAYS[value.getUTCDay()]} ${value.getUTCDate()}`;
  return withMonth ? `${text} ${MONTHS[value.getUTCMonth()]}` : text;
}

/**
 * "wo 11 t/m di 17 nov", "vr 27 nov t/m do 3 dec", "t/m di 17 nov", "alleen vandaag",
 * or "" when the validity is unknown. Offsets are days from `today`.
 */
export function formatValidity(input: { today: IsoDate; fromOffset: number | null; untilOffset: number | null }): string {
  const { today, fromOffset, untilOffset } = input;
  if (untilOffset === null) return "";
  if (fromOffset === 0 && untilOffset === 0) return "alleen vandaag";
  const end = addDays(today, untilOffset);
  if (fromOffset === null) return `t/m ${datePart(end, true)}`;
  const start = addDays(today, fromOffset);
  if (start === end) return datePart(end, true);
  return `${datePart(start, start.slice(0, 7) !== end.slice(0, 7))} t/m ${datePart(end, true)}`;
}
