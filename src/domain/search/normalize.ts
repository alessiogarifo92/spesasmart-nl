/**
 * The form of a product name stored for search and matching: lower-cased,
 * without accents or punctuation, single spaces. "Crème fraîche 200 ml" →
 * "creme fraiche 200 ml". Decimal separators inside numbers are kept ("1,5 l").
 */
export function normalizeName(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/&/g, " en ")
    .replace(/(\d)[.,](?=\d)/g, "$1\u0000")
    .replace(/[^a-z0-9\u0000]+/g, " ")
    .replace(/\u0000/g, ",")
    .trim()
    .replace(/\s+/g, " ");
}
