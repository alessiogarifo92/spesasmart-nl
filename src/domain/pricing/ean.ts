import { fail, ok, type Result } from "./result";

export type EanReason = "empty" | "non-digit" | "length" | "checksum";

/** GS1 check digit for the digits before it (weights 3 and 1, from the right). */
function checkDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const fromRight = body.length - i;
    sum += Number(body[i]) * (fromRight % 2 === 1 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

function hasValidCheckDigit(digits: string): boolean {
  return checkDigit(digits.slice(0, -1)) === Number(digits[digits.length - 1]);
}

/** True for exactly 8 or 13 digits with a correct check digit. No normalisation. */
export function isValidEan(text: string): boolean {
  return /^(\d{8}|\d{13})$/.test(text) && hasValidCheckDigit(text);
}

/**
 * Normalises a barcode to an EAN-8 or EAN-13 string: removes whitespace and pads a
 * 12-digit UPC-A with a leading zero. Any other character is rejected, never dropped.
 */
export function normalizeEan(text: string): Result<string, EanReason> {
  const compact = text.replace(/\s+/g, "");
  if (compact === "") return fail("empty");
  if (!/^\d+$/.test(compact)) return fail("non-digit");
  const digits = compact.length === 12 ? `0${compact}` : compact;
  if (digits.length !== 8 && digits.length !== 13) return fail("length");
  if (!hasValidCheckDigit(digits)) return fail("checksum");
  return ok(digits);
}
