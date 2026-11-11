import { fail, ok, type Result } from "./result";

export type PriceReason = "empty" | "unrecognised" | "negative" | "zero" | "too-large";

export type PriceOptions = {
  /** Bare digits are cents ("198" = 198 cents), as on Dirk's and Vomar's pages. Default false. */
  impliedCents?: boolean;
  /** Accept a price of zero. Default false. */
  allowZero?: boolean;
};

const CURRENCY = /€|\beur\b/gi;

/** Reads the unsigned number part of a price; null when the shape is not a known one. */
function readCents(body: string, impliedCents: boolean): number | null {
  if (/^\d+$/.test(body)) {
    return impliedCents ? Number(body) : Number(body) * 100;
  }
  const wholeEuros = /^(\d+)[.,][-–]{1,2}$/.exec(body);
  if (wholeEuros) return Number(wholeEuros[1]) * 100;

  const withThousands = /^(\d{1,3}(?:\.\d{3})+),(\d{2})$/.exec(body);
  if (withThousands) {
    return Number(withThousands[1].replace(/\./g, "")) * 100 + Number(withThousands[2]);
  }
  const withDecimals = /^(\d+)[.,](\d{2})$/.exec(body);
  if (withDecimals) return Number(withDecimals[1]) * 100 + Number(withDecimals[2]);

  return null;
}

/**
 * Parses a Dutch retailer price ("€ 1,99", "1.99", "5.-", "1.299,00") into integer euro cents.
 * Bare digits mean whole euros unless `impliedCents` is set. A dot followed by three digits
 * without a decimal part ("1.299") is ambiguous and not recognised.
 */
export function parsePriceCents(text: string, options: PriceOptions = {}): Result<number, PriceReason> {
  let body = text.replace(/[  ]/g, " ").replace(CURRENCY, " ").trim();
  if (body === "") return fail("empty");

  const negative = /^[-−]/.test(body);
  if (negative) body = body.slice(1).trim();

  const cents = readCents(body, options.impliedCents === true);
  if (cents === null) return fail("unrecognised");
  if (!Number.isSafeInteger(cents)) return fail("too-large");
  if (negative && cents > 0) return fail("negative");
  if (cents === 0 && options.allowZero !== true) return fail("zero");
  return ok(cents);
}

/** Formats integer euro cents with `Intl` ("nl-NL" gives "€ 1,99" with a non-breaking space). */
export function formatCents(cents: number, locale = "nl-NL"): string {
  if (!Number.isInteger(cents)) {
    throw new RangeError(`formatCents expects integer cents, got ${cents}`);
  }
  return new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(cents / 100);
}

/**
 * numerator / denominator rounded to a whole number, halves rounded up.
 * Exact for integer inputs; expects numerator >= 0 and denominator > 0.
 */
export function roundHalfUp(numerator: number, denominator: number): number {
  if (!(denominator > 0) || !(numerator >= 0)) {
    throw new RangeError(`roundHalfUp expects numerator >= 0 and denominator > 0`);
  }
  if (Number.isSafeInteger(numerator) && Number.isSafeInteger(denominator)) {
    const remainder = numerator % denominator;
    const quotient = (numerator - remainder) / denominator;
    return remainder * 2 >= denominator ? quotient + 1 : quotient;
  }
  return Math.floor(numerator / denominator + 0.5);
}
