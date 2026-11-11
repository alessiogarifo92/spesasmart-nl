import { roundHalfUp } from "./money";
import { fail, ok, type Result } from "./result";

/** Base units: grams, millilitres, pieces. */
export type QuantityUnit = "g" | "ml" | "piece";

export type Quantity = {
  /** Size of one pack in base units (330 for "6 x 330 ml"). Always a positive integer. */
  amount: number;
  unit: QuantityUnit;
  /** Packs in a multipack (6 for "6 x 330 ml"); 1 otherwise. */
  count: number;
  /** amount × count, in base units. */
  totalAmount: number;
  /** The text said "ca." / "circa" / "±". */
  approximate: boolean;
};

export type QuantityReason = "empty" | "range" | "zero" | "unrecognised";

/** Unit a price is expressed per: 1000 g, 1000 ml, or one piece. */
export type UnitBasis = "kg" | "l" | "piece";

export type UnitPrice = { cents: number; basis: UnitBasis };

const UNITS: Record<string, { unit: QuantityUnit; factor: number }> = {
  g: { unit: "g", factor: 1 },
  gr: { unit: "g", factor: 1 },
  gram: { unit: "g", factor: 1 },
  kg: { unit: "g", factor: 1000 },
  kilo: { unit: "g", factor: 1000 },
  kilogram: { unit: "g", factor: 1000 },
  ml: { unit: "ml", factor: 1 },
  milliliter: { unit: "ml", factor: 1 },
  cl: { unit: "ml", factor: 10 },
  centiliter: { unit: "ml", factor: 10 },
  l: { unit: "ml", factor: 1000 },
  ltr: { unit: "ml", factor: 1000 },
  liter: { unit: "ml", factor: 1000 },
  st: { unit: "piece", factor: 1 },
  stuk: { unit: "piece", factor: 1 },
  stuks: { unit: "piece", factor: 1 },
};

/** Packaging words that may precede the quantity ("tray 30 stuks"). */
const CONTAINER_PREFIX = /^(?:tray|doos|pak|zak|fles|blik|pot|bak|net|krat) /;
const APPROXIMATE_PREFIX = /^(?:ca\.|ca\b|circa\b|±) ?/;
const SINGLE = /^(\d+(?:[.,]\d+)?)? ?([a-z]+)\.?$/;
const MULTIPACK = /^(\d+) ?[x×] ?(.+)$/;

/** Multiplies a decimal string ("1,5") by a factor without floating-point drift. */
function decimalTimes(numberText: string, factor: number): number {
  const [whole, fraction = ""] = numberText.split(/[.,]/);
  return (Number(whole + fraction) * factor) / 10 ** fraction.length;
}

type Single = { amount: number; unit: QuantityUnit } | "zero" | null;

function parseSingle(text: string, perPrefix: boolean): Single {
  const match = SINGLE.exec(text);
  if (!match) return null;
  const [, numberText, unitWord] = match;
  const unit = UNITS[unitWord];
  if (!unit) return null;
  if (numberText === undefined && !perPrefix) return null;
  // "1.000 g" could be 1 g or 1000 g: not recognised.
  if (numberText !== undefined && /^\d+\.\d{3}$/.test(numberText)) return null;

  const amount = numberText === undefined ? unit.factor : decimalTimes(numberText, unit.factor);
  if (amount === 0) return "zero";
  if (!Number.isInteger(amount)) return null;
  return { amount, unit: unit.unit };
}

/**
 * Parses a pack size ("500 g", "1,5 L", "6 x 330 ml", "tray 30 stuks", "ca. 400 g") into
 * base units. Ranges ("386-410 gram") are not recognised: they are never averaged.
 */
export function parseQuantity(text: string): Result<Quantity, QuantityReason> {
  let rest = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (rest === "") return fail("empty");
  if (/\d ?[-–—] ?\d/.test(rest)) return fail("range");

  const approximate = APPROXIMATE_PREFIX.test(rest);
  rest = rest.replace(APPROXIMATE_PREFIX, "").replace(CONTAINER_PREFIX, "");
  const perPrefix = rest.startsWith("per ");
  if (perPrefix) rest = rest.slice(4);

  let count = 1;
  const multipack = MULTIPACK.exec(rest);
  if (multipack) {
    count = Number(multipack[1]);
    rest = multipack[2];
  }

  const single = parseSingle(rest, perPrefix);
  if (single === null) return fail("unrecognised");
  if (single === "zero" || count === 0) return fail("zero");

  return ok({ ...single, count, totalAmount: single.amount * count, approximate });
}

/**
 * Price per kg, per litre or per piece, in integer cents rounded half up.
 * `priceCents` is the price of the whole quantity (all packs of a multipack).
 */
export function unitPrice(priceCents: number, quantity: Quantity): UnitPrice {
  if (!Number.isSafeInteger(priceCents) || priceCents < 0) {
    throw new RangeError(`unitPrice expects non-negative integer cents, got ${priceCents}`);
  }
  if (!(quantity.totalAmount > 0)) {
    throw new RangeError(`unitPrice expects a positive quantity, got ${quantity.totalAmount}`);
  }
  if (quantity.unit === "piece") {
    return { cents: roundHalfUp(priceCents, quantity.totalAmount), basis: "piece" };
  }
  return {
    cents: roundHalfUp(priceCents * 1000, quantity.totalAmount),
    basis: quantity.unit === "g" ? "kg" : "l",
  };
}

const BASIS_LABELS: Record<string, Record<UnitBasis, string>> = {
  nl: { kg: "per kg", l: "per liter", piece: "per stuk" },
  en: { kg: "per kg", l: "per litre", piece: "per piece" },
  it: { kg: "al kg", l: "al litro", piece: "al pezzo" },
};

/** Label for a unit basis ("per kg", "per liter", "per stuk"); Dutch when the language has none. */
export function formatUnitBasis(basis: UnitBasis, locale = "nl"): string {
  const language = locale.split("-")[0].toLowerCase();
  return (BASIS_LABELS[language] ?? BASIS_LABELS.nl)[basis];
}
