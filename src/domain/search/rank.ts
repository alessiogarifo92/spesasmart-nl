import type { UnitBasis } from "@/domain/pricing";

/**
 * Lowest trigram word similarity at which a term may match a product name by
 * fuzzy comparison; null for terms too short to compare that way. Short words
 * share trigrams with unrelated ones ("kip" and "kibbeling"), so they match by
 * substring or word stem only.
 */
export function fuzzyThreshold(term: string): number | null {
  if (term.length <= 3 || /^\d/.test(term)) return null;
  return term.length <= 5 ? 0.65 : 0.45;
}

/** Escapes `%`, `_` and `\` so a term is matched literally inside a LIKE pattern. */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, "\\$&")}%`;
}

export type Priced = {
  /** Price of one item in cents; null when unknown. */
  priceCents: number | null;
  unitPrice: { cents: number; basis: UnitBasis } | null;
};

export type BestFlags = { lowestPrice: boolean; bestUnitPrice: boolean };

/**
 * Marks the lowest price and the best unit price in a result list. A mark needs
 * something to compare with: at least two results with a price (or, for the
 * unit price, two with the same basis). Ties are all marked.
 */
export function markBest(results: Priced[]): BestFlags[] {
  const prices = results.map((r) => r.priceCents).filter((cents): cents is number => cents !== null);
  const lowest = prices.length >= 2 ? Math.min(...prices) : null;

  const bestPerBasis = new Map<UnitBasis, { cents: number; count: number }>();
  for (const { unitPrice } of results) {
    if (!unitPrice) continue;
    const seen = bestPerBasis.get(unitPrice.basis);
    bestPerBasis.set(unitPrice.basis, {
      cents: seen ? Math.min(seen.cents, unitPrice.cents) : unitPrice.cents,
      count: (seen?.count ?? 0) + 1,
    });
  }

  return results.map(({ priceCents, unitPrice }) => {
    const basis = unitPrice ? bestPerBasis.get(unitPrice.basis) : undefined;
    return {
      lowestPrice: lowest !== null && priceCents === lowest,
      bestUnitPrice: basis !== undefined && basis.count >= 2 && unitPrice!.cents === basis.cents,
    };
  });
}
