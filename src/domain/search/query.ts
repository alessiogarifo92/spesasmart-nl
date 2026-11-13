import { normalizeEan, parseQuantity, type Quantity } from "@/domain/pricing";
import { normalizeName } from "./normalize";
import { FLAG_WORDS, PRODUCT_SYNONYMS, STOP_WORDS } from "./synonyms";

export type SearchContext = {
  /** Brand names known to the catalogue. */
  brands?: string[];
  /** Categories with the names they go by in each language. */
  categories?: { slug: string; names: string[] }[];
};

export type ParsedQuery = {
  /** The query as typed, trimmed. */
  raw: string;
  /** A valid EAN when the whole query is a barcode; everything else is then empty. */
  ean: string | null;
  /** Words to match against product names, after synonyms; Dutch where a synonym exists. */
  terms: string[];
  /** Package size named in the query ("1 liter", "500 gram", "6 x 330 ml"). */
  quantity: Quantity | null;
  /** A known brand named in the query, in the catalogue's spelling. */
  brand: string | null;
  /** A known category named in the query. */
  categorySlug: string | null;
  organic: boolean;
  /** "goedkoop", "cheap", "economico": sort by price instead of by relevance. */
  cheapestFirst: boolean;
  /** Dietary attributes asked for (`glutenFree`, `vegan`, `lactoseFree`). */
  attributes: string[];
};

const UNIT =
  "(?:kg|kilo|kilogram|g|gr|gram|grammi|l|lt|liter|litre|litri|litro|ml|cl|dl|stuks?|st|pezzi|pieces?|rollen|rol)";
const QUANTITY = new RegExp(`(?:^| )((?:\\d+ ?x ?)?\\d+(?:,\\d+)? ?${UNIT})(?= |$)`);

/** Italian and English unit words rewritten to the Dutch ones `parseQuantity` reads. */
const UNIT_WORDS: [RegExp, string][] = [
  [/\b(litre|litri|litro|lt)\b/, "liter"],
  [/\b(grammi|gr)\b/, "gram"],
  [/\b(pezzi|pieces?|rollen|rol|st)\b/, "stuks"],
];

/** Replaces every whole-word occurrence of a phrase; longest phrases first. */
function replacePhrases(text: string, table: Record<string, string>, onMatch?: (value: string) => void): string {
  let result = ` ${text} `;
  for (const phrase of Object.keys(table).sort((a, b) => b.length - a.length)) {
    const needle = ` ${phrase} `;
    while (result.includes(needle)) {
      const replacement = onMatch ? "" : table[phrase];
      onMatch?.(table[phrase]);
      result = result.replace(needle, ` ${replacement} `);
    }
  }
  return result.replace(/\s+/g, " ").trim();
}

/** Removes the first known name found as whole words; returns what was matched. */
function takeKnown<T>(text: string, known: { key: string; value: T }[]): { text: string; value: T | null } {
  const padded = ` ${text} `;
  for (const { key, value } of [...known].sort((a, b) => b.key.length - a.key.length)) {
    if (key && padded.includes(` ${key} `)) {
      return { text: padded.replace(` ${key} `, " ").replace(/\s+/g, " ").trim(), value };
    }
  }
  return { text, value: null };
}

const EMPTY: Omit<ParsedQuery, "raw"> = {
  ean: null,
  terms: [],
  quantity: null,
  brand: null,
  categorySlug: null,
  organic: false,
  cheapestFirst: false,
  attributes: [],
};

/** Words of a query that are searched; each one is a condition in the search query, so the rest is dropped. */
export const MAX_TERMS = 8;

/**
 * Splits a free-text search into what it asks for. Nothing is guessed: a part
 * that is not recognised as a barcode, size, brand, category or flag stays a
 * search term.
 */
export function parseQuery(input: string, context: SearchContext = {}): ParsedQuery {
  const raw = input.trim().slice(0, 120);
  const digits = raw.replace(/[\s-]/g, "");
  if (/^\d{8,14}$/.test(digits)) {
    const ean = normalizeEan(digits);
    // A number that is not a valid barcode is searched as text, not silently dropped.
    return { ...EMPTY, raw, ean: ean.ok ? ean.value : null, terms: ean.ok ? [] : [digits] };
  }

  let text = normalizeName(raw);

  let quantity: Quantity | null = null;
  const sized = QUANTITY.exec(text);
  if (sized) {
    const wording = UNIT_WORDS.reduce((value, [pattern, dutch]) => value.replace(pattern, dutch), sized[1]);
    const parsed = parseQuantity(wording);
    if (parsed.ok) {
      quantity = parsed.value;
      text = text.replace(sized[1], " ").replace(/\s+/g, " ").trim();
    }
  }

  const flags = new Set<string>();
  text = replacePhrases(text, FLAG_WORDS, (flag) => flags.add(flag));

  const brand = takeKnown(
    text,
    (context.brands ?? []).map((name) => ({ key: normalizeName(name), value: name })),
  );
  text = brand.text;

  // A category name narrows the search but stays a term too: "melk" is both a word and a shelf.
  const category = takeKnown(
    text,
    (context.categories ?? []).flatMap(({ slug, names }) =>
      names.map((name) => ({ key: normalizeName(name), value: slug })),
    ),
  );
  if (category.value !== null && category.text !== "") text = category.text;

  text = replacePhrases(text, PRODUCT_SYNONYMS);
  const terms = [...new Set(text.split(" ").filter((word) => word !== "" && !STOP_WORDS.has(word)))].slice(
    0,
    MAX_TERMS,
  );

  return {
    raw,
    ean: null,
    terms,
    quantity,
    brand: brand.value,
    categorySlug: category.value !== null && category.text !== "" ? category.value : null,
    organic: flags.has("organic"),
    cheapestFirst: flags.has("cheap"),
    attributes: ["glutenFree", "vegan", "lactoseFree"].filter((flag) => flags.has(flag)),
  };
}

/** True when the query asks for nothing at all (empty, or only stop words). */
export function isEmptyQuery(query: ParsedQuery): boolean {
  return (
    query.ean === null &&
    query.terms.length === 0 &&
    query.brand === null &&
    query.categorySlug === null &&
    !query.organic &&
    query.attributes.length === 0
  );
}
