import { assertCents, assertQuantity, priceCandidate } from "./price";
import type {
  Candidate,
  CandidatePrice,
  Comparison,
  LineReason,
  ListItem,
  MatchTier,
  MissingItem,
  MissingReason,
  Mode,
  Options,
  Plan,
  PlanLine,
  RetailerId,
  SingleStore,
  Stop,
  Substitutes,
} from "./types";

const TIER_RANK: Record<MatchTier, number> = { EXACT: 0, SAME: 1, SIMILAR: 2, ALTERNATIVE: 3 };
const SUBSTITUTES: readonly Substitutes[] = ["exact", "same", "similar"];
/** Tiers that count as the picked product itself, per setting: they share rank 0 and compete on price. */
const PRICE_EQUAL: Record<Substitutes, readonly MatchTier[]> = {
  exact: ["EXACT"],
  same: ["EXACT", "SAME"],
  similar: ["EXACT", "SAME", "SIMILAR"],
};
const MODES: readonly Mode[] = ["max-savings", "fewest-stores", "offers-only", "organic-only"];
const MAX_STORES: readonly number[] = [1, 2, 3];

/** A candidate that can be priced for its item's quantity. */
type Option = { candidate: Candidate; price: CandidatePrice };

type Prepared = {
  item: ListItem;
  /** Options left after the mode filter and the pin, best first (tier, total, retailer, product). */
  options: Option[];
  /** Why the item cannot be bought anywhere; null when it has options. */
  unavailable: Exclude<MissingReason, "not-in-chosen-stores"> | null;
};

/** One set of chains and the option each item takes there (null: not covered). */
type Evaluation = { choices: (Option | null)[]; totalCents: number; coveredCount: number; chains: RetailerId[] };

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Rank of a tier under a substitutes setting: 0 for everything that competes on price with the pick. */
type Rank = (tier: MatchTier) => number;

function rankFor(substitutes: Substitutes): Rank {
  const equal = PRICE_EQUAL[substitutes];
  return (tier) => (equal.includes(tier) ? 0 : TIER_RANK[tier]);
}

function compareOptions(a: Option, b: Option, rank: Rank): number {
  return (
    rank(a.candidate.tier) - rank(b.candidate.tier) ||
    a.price.totalCents - b.price.totalCents ||
    // At the same price the closer match wins.
    TIER_RANK[a.candidate.tier] - TIER_RANK[b.candidate.tier] ||
    compareText(a.candidate.retailerId, b.candidate.retailerId) ||
    compareText(a.candidate.productId, b.candidate.productId)
  );
}

function compareChainLists(a: RetailerId[], b: RetailerId[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const order = compareText(a[i], b[i]);
    if (order !== 0) return order;
  }
  return a.length - b.length;
}

function compareEvaluations(a: Evaluation, b: Evaluation, mode: Mode): number {
  const coverage = b.coveredCount - a.coveredCount;
  if (coverage !== 0) return coverage;
  const stores = a.chains.length - b.chains.length;
  const total = a.totalCents - b.totalCents;
  const ranked = mode === "fewest-stores" ? stores || total : total || stores;
  return ranked || compareChainLists(a.chains, b.chains);
}

function keepsInMode(option: Option, mode: Mode): boolean {
  if (mode === "offers-only") return option.price.usedOffer;
  if (mode === "organic-only") return option.candidate.isOrganic;
  return true;
}

function prepare(item: ListItem, mode: Mode, rank: Rank): Prepared {
  const options: Option[] = [];
  for (const candidate of item.candidates) {
    const price = priceCandidate(candidate, item.quantity);
    if (price.ok) options.push({ candidate, price: price.value });
  }
  if (options.length === 0) return { item, options, unavailable: "not-found" };

  const kept = options.filter((option) => keepsInMode(option, mode));
  if (kept.length === 0) return { item, options: kept, unavailable: "filtered" };

  const pinned =
    item.pinnedRetailerId === null ? kept : kept.filter((o) => o.candidate.retailerId === item.pinnedRetailerId);
  if (pinned.length === 0) return { item, options: pinned, unavailable: "pinned-unavailable" };

  return { item, options: pinned.sort((a, b) => compareOptions(a, b, rank)), unavailable: null };
}

function evaluate(prepared: Prepared[], chains: ReadonlySet<RetailerId>): Evaluation {
  const used = new Set<RetailerId>();
  let totalCents = 0;
  let coveredCount = 0;
  const choices = prepared.map(({ options }) => {
    const choice = options.find((o) => chains.has(o.candidate.retailerId)) ?? null;
    if (choice !== null) {
      used.add(choice.candidate.retailerId);
      totalCents += choice.price.totalCents;
      coveredCount++;
    }
    return choice;
  });
  return { choices, totalCents, coveredCount, chains: [...used].sort(compareText) };
}

/** Every subset of `pool` with a size between `min` and `max`, in a fixed order. */
function combinations<T>(pool: T[], min: number, max: number): T[][] {
  const result: T[][] = [];
  const pick = (start: number, current: T[]) => {
    if (current.length >= min) result.push([...current]);
    if (current.length === max) return;
    for (let i = start; i < pool.length; i++) pick(i + 1, [...current, pool[i]]);
  };
  pick(0, []);
  return result;
}

function bestEvaluation(prepared: Prepared[], options: Options): { best: Evaluation; maxStoresExceeded: boolean } {
  const forced = new Set<RetailerId>();
  const universe = new Set<RetailerId>();
  for (const { item, options: itemOptions } of prepared) {
    for (const o of itemOptions) universe.add(o.candidate.retailerId);
    if (item.pinnedRetailerId !== null && itemOptions.length > 0) forced.add(item.pinnedRetailerId);
  }
  if (forced.size > options.maxStores) {
    return { best: evaluate(prepared, forced), maxStoresExceeded: true };
  }

  const free = [...universe].filter((chain) => !forced.has(chain)).sort(compareText);
  const extras = combinations(free, Math.max(0, 1 - forced.size), options.maxStores - forced.size);
  let best = evaluate(prepared, forced);
  for (const extra of extras) {
    const candidate = evaluate(prepared, new Set([...forced, ...extra]));
    if (compareEvaluations(candidate, best, options.mode) < 0) best = candidate;
  }
  return { best, maxStoresExceeded: false };
}

function lineReason(prepared: Prepared, chosen: Option, chains: ReadonlySet<RetailerId>, rank: Rank): LineReason {
  const { candidate, price } = chosen;
  if (prepared.item.pinnedRetailerId !== null) return { code: "pinned" };
  if (prepared.options.every((o) => o.candidate.retailerId === candidate.retailerId)) return { code: "only-store" };

  const inSet = prepared.options.filter((o) => o !== chosen && chains.has(o.candidate.retailerId));
  const chosenRank = rank(candidate.tier);
  if (inSet.some((o) => rank(o.candidate.tier) > chosenRank && o.price.totalCents < price.totalCents)) {
    return { code: "closest-match" };
  }
  if (price.usedOffer) {
    return {
      code: "offer",
      savingCents: price.regularTotalCents === null ? null : price.regularTotalCents - price.totalCents,
      daysLeft: candidate.offer === null ? null : candidate.offer.daysLeft,
    };
  }
  // Options are sorted, so the first one at another chain with the same rank is the next best.
  const next = inSet.find(
    (o) => o.candidate.retailerId !== candidate.retailerId && rank(o.candidate.tier) === chosenRank,
  );
  return next === undefined
    ? { code: "cheapest", nextRetailerId: null, differenceCents: null }
    : {
        code: "cheapest",
        nextRetailerId: next.candidate.retailerId,
        differenceCents: next.price.totalCents - price.totalCents,
      };
}

function toLine(prepared: Prepared, chosen: Option, chains: ReadonlySet<RetailerId>, rank: Rank): PlanLine {
  const { item } = prepared;
  const { price } = chosen;
  return {
    itemId: item.id,
    label: item.label,
    quantity: item.quantity,
    candidate: chosen.candidate,
    totalCents: price.totalCents,
    unitCents: price.unitCents,
    regularTotalCents: price.regularTotalCents,
    usedOffer: price.usedOffer,
    assumed: price.assumed,
    reason: lineReason(prepared, chosen, chains, rank),
    hint: price.hint,
  };
}

function toStops(lines: PlanLine[]): Stop[] {
  const byChain = new Map<RetailerId, PlanLine[]>();
  for (const line of lines) {
    const chain = line.candidate.retailerId;
    byChain.set(chain, [...(byChain.get(chain) ?? []), line]);
  }
  return [...byChain]
    .map(([retailerId, stopLines]) => ({
      retailerId,
      lines: stopLines,
      subtotalCents: stopLines.reduce((sum, l) => sum + l.totalCents, 0),
    }))
    .sort((a, b) => b.subtotalCents - a.subtotalCents || compareText(a.retailerId, b.retailerId));
}

function singleStores(prepared: Prepared[]): { store: SingleStore; covered: Set<string> }[] {
  const chains = new Set<RetailerId>();
  for (const { item } of prepared) for (const c of item.candidates) chains.add(c.retailerId);
  return [...chains]
    .map((retailerId) => {
      const evaluation = evaluate(prepared, new Set([retailerId]));
      const covered = new Set<string>();
      const missingItemIds: string[] = [];
      evaluation.choices.forEach((choice, i) => {
        if (choice === null) missingItemIds.push(prepared[i].item.id);
        else covered.add(prepared[i].item.id);
      });
      const store = {
        retailerId,
        totalCents: evaluation.totalCents,
        coveredCount: evaluation.coveredCount,
        missingItemIds,
      };
      return { store, covered };
    })
    .sort(
      (a, b) =>
        b.store.coveredCount - a.store.coveredCount ||
        a.store.totalCents - b.store.totalCents ||
        compareText(a.store.retailerId, b.store.retailerId),
    );
}

function comparison(
  singles: { store: SingleStore; covered: Set<string> }[],
  lines: PlanLine[],
  stops: Stop[],
  totalCents: number,
): Comparison | null {
  if (lines.length === 0) return null;
  const covering = singles
    .filter(({ covered }) => lines.every((l) => covered.has(l.itemId)))
    .map(({ store }) => store)
    .sort((a, b) => a.totalCents - b.totalCents || compareText(a.retailerId, b.retailerId));
  const best = covering[0];
  if (best === undefined) return null;
  if (stops.length === 1 && stops[0].retailerId === best.retailerId) return null;
  return { retailerId: best.retailerId, totalCents: best.totalCents, savingCents: best.totalCents - totalCents };
}

function validate(items: ListItem[], options: Options): void {
  if (!MAX_STORES.includes(options.maxStores)) {
    throw new RangeError(`maxStores must be 1, 2 or 3, got ${options.maxStores}`);
  }
  if (!MODES.includes(options.mode)) throw new RangeError(`unknown mode ${JSON.stringify(options.mode)}`);
  if (options.substitutes !== undefined && !SUBSTITUTES.includes(options.substitutes)) {
    throw new RangeError(`unknown substitutes ${JSON.stringify(options.substitutes)}`);
  }
  assertCents("budgetCents", options.budgetCents);
  const ids = new Set<string>();
  for (const item of items) {
    assertQuantity(item.quantity);
    if (ids.has(item.id)) throw new RangeError(`duplicate item id ${JSON.stringify(item.id)}`);
    ids.add(item.id);
  }
}

/**
 * Cheapest way to buy a shopping list at 1 to `options.maxStores` chains. Items keep their
 * closest match within the chosen chains, unless `options.substitutes` lets the same or a very
 * similar product compete on price; pinned items stay at their chain, whose chain is then
 * always visited. Sets of chains are ranked by items covered, then by total (or, for
 * "fewest-stores", by number of stops first). All amounts are integer cents; unit prices are
 * rounded half up. The result is the same whatever the order of each item's candidates.
 * Throws RangeError for a bad quantity, bad cents, duplicate item ids or unknown options.
 */
export function optimizeBasket(items: ListItem[], options: Options): Plan {
  validate(items, options);
  const rank = rankFor(options.substitutes ?? "exact");
  const prepared = items.map((item) => prepare(item, options.mode, rank));
  const { best, maxStoresExceeded } = bestEvaluation(prepared, options);

  const chains = new Set(best.chains);
  const lines: PlanLine[] = [];
  const missing: MissingItem[] = [];
  best.choices.forEach((choice, i) => {
    const { item, unavailable } = prepared[i];
    if (choice !== null) lines.push(toLine(prepared[i], choice, chains, rank));
    else missing.push({ itemId: item.id, label: item.label, reason: unavailable ?? "not-in-chosen-stores" });
  });

  const stops = toStops(lines);
  const totalCents = best.totalCents;
  const budget = options.budgetCents;
  const singles = singleStores(prepared);
  return {
    stops,
    totalCents,
    itemCount: items.length,
    coveredCount: lines.length,
    missing,
    singleStores: singles.map(({ store }) => store),
    comparison: comparison(singles, lines, stops, totalCents),
    offerSavingCents: lines.reduce(
      (sum, l) => sum + (l.regularTotalCents === null ? 0 : l.regularTotalCents - l.totalCents),
      0,
    ),
    overBudgetCents: budget !== null && budget !== undefined && totalCents > budget ? totalCents - budget : null,
    maxStoresExceeded,
  };
}
