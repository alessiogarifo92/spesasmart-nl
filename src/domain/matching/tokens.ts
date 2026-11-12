import { normalizeName } from "@/domain/search";

/** A prefix counts as the same word from this many letters ("halfvol" / "halfvolle"). */
export const PREFIX_MIN_LENGTH = 4;
/**
 * …and only when it is at least this share of the longer word: an inflection, not the first
 * half of a compound ("tros" is not "trostomaten", "melk" is not "melkpoeder").
 */
export const PREFIX_MIN_SHARE = 0.65;
/** A word inside a longer one counts from this many letters ("eieren" in "scharreleieren"). */
export const COMPOUND_MIN_LENGTH = 5;
/** Score of a word found inside a compound: close, but not the same word. */
export const COMPOUND_SCORE = 0.8;
/** Lowest character-trigram Dice coefficient that counts as a spelling variant ("haverdrink" / "haverdrank"). */
export const TRIGRAM_MIN_DICE = 0.6;

const UNIT_WORDS = "g|gr|gram|kg|kilo|kilogram|ml|cl|l|ltr|liter|st|stuk|stuks|x|pack|rol|rollen";
const NUMBER = "\\d+(?:,\\d+)?";
/** "500", "1,5", "500g", "6x330ml", "6x", or a unit word on its own: a size, never what the product is. */
const SIZE_TOKEN = new RegExp(`^(?:${NUMBER}x)?${NUMBER}(?:${UNIT_WORDS})?$|^(?:${UNIT_WORDS})$`);
const UNIT_ONLY = new RegExp(`^(?:${UNIT_WORDS})$`);
/** Packaging and filler words: chains add them freely, so they say nothing about the product. */
const FILLER = new Set([
  "pak",
  "pot",
  "schaal",
  "doos",
  "blik",
  "fles",
  "zak",
  "bak",
  "tray",
  "verpakking",
  "pakje",
  "potje",
  "bakje",
  "blikje",
  "flesje",
  "zakje",
  "netje",
  "tube",
  "ca",
  "circa",
  "de",
  "het",
  "een",
  "en",
  "met",
  "van",
  "per",
]);
/** Says "organic", which the matcher compares as a fact of its own (`isOrganic`), not as part of the name. */
const ORGANIC = new Set(["bio", "biologisch", "biologische", "organic", "eko"]);
/** After these words a number is part of what the product is ("luiers maat 4"), not a size. */
const NUMBERED = new Set(["maat", "nr", "nummer", "size", "type"]);

function words(text: string): string[] {
  const normalized = normalizeName(text);
  return normalized === "" ? [] : normalized.split(" ");
}

/**
 * The words that say what a product is: the normalised name without sizes, packaging,
 * filler words and the brand. "Bruisbron cola blik 6x330ml" with brand "Bruisbron" → ["cola"].
 * Duplicates are removed, the first position kept.
 */
export function coreTokens(name: string, brand: string | null): string[] {
  const brandWords = new Set(brand === null ? [] : words(brand));
  const tokens: string[] = [];
  const all = words(name);
  all.forEach((word, index) => {
    const previous = all[index - 1];
    const next = all[index + 1];
    const measured = next !== undefined && UNIT_ONLY.test(next);
    if (previous !== undefined && NUMBERED.has(previous) && /^\d{1,2}$/.test(word) && !measured) {
      // "maat 4" becomes one token, so that size 4 and size 5 are different words.
      if (tokens.at(-1) === previous) tokens.pop();
      tokens.push(previous + word);
    } else if (!SIZE_TOKEN.test(word) && !FILLER.has(word) && !ORGANIC.has(word) && !brandWords.has(word)) {
      tokens.push(word);
    }
  });
  return [...new Set(tokens)];
}

function trigrams(word: string): Set<string> {
  const result = new Set<string>();
  for (let i = 0; i + 3 <= word.length; i++) result.add(word.slice(i, i + 3));
  return result;
}

/** Dice coefficient of the two words' distinct character trigrams; 0 when either has none. */
function trigramDice(a: string, b: string): number {
  const left = trigrams(a);
  const right = trigrams(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const trigram of left) if (right.has(trigram)) shared++;
  return (2 * shared) / (left.size + right.size);
}

/** How well two words match, 0..1. Symmetric: every rule looks at the shorter and the longer word. */
function tokenScore(a: string, b: string): number {
  if (a === b) return 1;
  // A word with a number in it ("maat4") is an identifier: it is equal or it is something else.
  if (/\d/.test(a) || /\d/.test(b)) return 0;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (
    shorter.length >= PREFIX_MIN_LENGTH &&
    shorter.length >= longer.length * PREFIX_MIN_SHARE &&
    longer.startsWith(shorter)
  ) {
    return 1;
  }
  const compound = shorter.length >= COMPOUND_MIN_LENGTH && longer.includes(shorter) ? COMPOUND_SCORE : 0;
  const dice = trigramDice(a, b);
  return Math.max(compound, dice >= TRIGRAM_MIN_DICE ? dice : 0);
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Writes two words of `tokens` as one where `other` has them as one compound
 * ("volkoren brood" against "volkorenbrood"), so a space does not count as a difference.
 */
function joinCompounds(tokens: string[], other: string[]): string[] {
  let result = tokens;
  for (const compound of [...other].sort(compareText)) {
    if (result.includes(compound)) continue;
    const first = result.find(
      (word) => compound.startsWith(word) && word !== compound && result.includes(compound.slice(word.length)),
    );
    if (first === undefined) continue;
    const second = compound.slice(first.length);
    if (second === first) continue;
    result = result.filter((word) => word !== first && word !== second).concat(compound);
  }
  return result;
}

type Pair = { left: number; right: number; score: number; low: string; high: string };

/**
 * Similarity of two token lists, 0..1: two words that the other side writes as one compound
 * are joined first, then each token is paired with its best unused partner,
 * and the sum of the pair scores is divided by the length of the longer list, so words
 * only one side has count against the match. 0 when either list is empty.
 */
export function nameSimilarity(listA: string[], listB: string[]): number {
  if (listA.length === 0 || listB.length === 0) return 0;
  const a = joinCompounds(listA, listB);
  const b = joinCompounds(listB, listA);

  const pairs: Pair[] = [];
  a.forEach((left, i) =>
    b.forEach((right, j) => {
      const score = tokenScore(left, right);
      if (score === 0) return;
      const [low, high] = compareText(left, right) <= 0 ? [left, right] : [right, left];
      pairs.push({ left: i, right: j, score, low, high });
    }),
  );
  // Greedy, best pair first. Ties are broken on the words themselves, never on which list or
  // position they come from, so swapping the arguments or reordering a list picks the same pairs:
  // a word present on both sides always pairs with itself before any tied pair that uses it.
  pairs.sort((x, y) => y.score - x.score || compareText(x.low, y.low) || compareText(x.high, y.high));

  const usedLeft = new Set<number>();
  const usedRight = new Set<number>();
  let total = 0;
  for (const pair of pairs) {
    if (usedLeft.has(pair.left) || usedRight.has(pair.right)) continue;
    usedLeft.add(pair.left);
    usedRight.add(pair.right);
    total += pair.score;
  }
  return total / Math.max(a.length, b.length);
}
