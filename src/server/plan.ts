import { mapLimited } from "@/lib/concurrency";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  optimizeBasket,
  toOptions,
  type Candidate,
  type ListItem,
  type MatchTier,
  type Plan,
  type PlanSettings,
} from "@/domain/optimizer";
import type { IsoDate } from "@/domain/pricing";
import { nameHasWords, normalizeName, parseQuery } from "@/domain/search";
import { loadProducts, toCandidate, type CatalogProduct } from "./catalog";
import { getList } from "./lists";
import { CLEAR_MATCH, searchContext, searchProducts, type SearchResults } from "./search";

/** The plan for the device's current list, with what the interface needs to name things. */
export type PlanView = {
  list: { id: string; name: string };
  /** Items on the list, ticked ones included. */
  itemCount: number;
  /** Items still to buy: the plan covers these and nothing else. */
  openCount: number;
  plan: Plan;
  /** Chain names by slug, for every chain a candidate came from. */
  retailers: Record<string, string>;
  /** The listing an item was added from, by item id; absent for free text and for a listing that is gone. */
  picked: Record<string, string>;
  /** The chain an item is pinned to, by item id. */
  pins: Record<string, string>;
  /** At least one line is priced from demo rows. */
  isDemo: boolean;
};

/** A typed item ("melk") is matched to names; this many results per item are considered. */
const TEXT_CANDIDATES = 40;
/** Searches for typed items that run at the same time while a plan is built. */
const SEARCHES_AT_ONCE = 4;

/**
 * What a typed item can be bought as: the results whose name has the words typed, and only
 * when there are none, the other clear matches (a typo, a part of a longer word). A named
 * size counts when the catalogue has it.
 */
function textMatches(results: SearchResults, terms: string[]): CatalogProduct[] {
  const sized = results.hits.filter((hit) => (!results.sizeFound || hit.sizeMatch) && hit.score >= CLEAR_MATCH);
  const whole = sized.filter((hit) => nameHasWords(normalizeName(hit.product.name), terms));
  return (whole.length > 0 ? whole : sized).map((hit) => hit.product);
}

/**
 * The cheapest way to buy what is still open on the device's current list; null when the
 * device has no list.
 *
 * An item added from a result can be bought as that listing, as the same product at another
 * chain and, when `settings.similar` allows it, as a very similar one. Only links shown
 * without review or confirmed by a person are used. Another size is never a candidate: three
 * packs of another size are not what was asked for, and their total would not be comparable.
 * A typed item can be bought as any listing whose name matches it.
 */
export async function buildPlan(
  db: PrismaClient,
  deviceId: string,
  settings: PlanSettings,
  today: IsoDate,
): Promise<PlanView | null> {
  const list = await getList(db, deviceId);
  if (!list) return null;
  const open = list.items.filter((item) => !item.checked);
  const typed = open.filter((item) => item.product === null);
  const pickedIds = [...new Set(open.flatMap((item) => (item.product ? [item.product.id] : [])))];

  const [links, context] = await Promise.all([
    pickedIds.length === 0
      ? []
      : db.productMatch.findMany({
          where: {
            status: { in: ["AUTO", "CONFIRMED"] },
            matchType: { in: settings.similar ? ["SAME", "SIMILAR"] : ["SAME"] },
            OR: [{ canonicalProductId: { in: pickedIds } }, { candidateProductId: { in: pickedIds } }],
          },
          select: { canonicalProductId: true, candidateProductId: true, matchType: true },
        }),
    typed.length === 0 ? null : searchContext(db),
  ]);

  // Listing → the listings it may be replaced by, with how close each is.
  const substitutes = new Map<string, Map<string, MatchTier>>();
  const link = (from: string, to: string, tier: MatchTier) => {
    if (!pickedIds.includes(from)) return;
    const known = substitutes.get(from) ?? new Map<string, MatchTier>();
    // Two links to one listing cannot exist; should that change, the closer one stands.
    if (known.get(to) !== "SAME") known.set(to, tier);
    substitutes.set(from, known);
  };
  for (const row of links) {
    if (row.matchType === "ALTERNATIVE") continue;
    link(row.canonicalProductId, row.candidateProductId, row.matchType);
    link(row.candidateProductId, row.canonicalProductId, row.matchType);
  }

  // One search per distinct label, a few at a time: a full list of typed items must not
  // open a hundred queries at once on every page view.
  const labels = [...new Set(typed.map((item) => item.label))];
  const [products, found] = await Promise.all([
    loadProducts(db, [...pickedIds, ...[...substitutes.values()].flatMap((known) => [...known.keys()])], today),
    mapLimited(labels, SEARCHES_AT_ONCE, async (label) => {
      const query = parseQuery(label, context ?? {});
      return textMatches(await searchProducts(db, { query, today, limit: TEXT_CANDIDATES }), query.terms);
    }),
  ]);
  const byLabel = new Map(labels.map((label, index) => [label, found[index]!]));
  const typedMatches = new Map(typed.map((item) => [item.id, byLabel.get(item.label)!]));

  const retailers: Record<string, string> = {};
  const demo = new Set<string>();
  const candidate = (product: CatalogProduct, tier: MatchTier): Candidate => {
    retailers[product.retailer.slug] = product.retailer.name;
    if (product.isDemo) demo.add(product.id);
    return toCandidate(product, tier);
  };

  const picked: Record<string, string> = {};
  const pins: Record<string, string> = {};
  const items: ListItem[] = open.map((item) => {
    const candidates: Candidate[] = [];
    if (item.product) {
      const own = products.get(item.product.id);
      if (own) {
        picked[item.id] = own.id;
        candidates.push(candidate(own, "EXACT"));
      }
      for (const [id, tier] of substitutes.get(item.product.id) ?? []) {
        const other = products.get(id);
        if (other) candidates.push(candidate(other, tier));
      }
    } else {
      for (const match of typedMatches.get(item.id) ?? []) candidates.push(candidate(match, "EXACT"));
    }
    if (item.pinnedRetailer) {
      retailers[item.pinnedRetailer.slug] = item.pinnedRetailer.name;
      pins[item.id] = item.pinnedRetailer.slug;
    }
    return {
      id: item.id,
      label: item.label,
      quantity: item.quantity,
      pinnedRetailerId: item.pinnedRetailer?.slug ?? null,
      candidates,
    };
  });

  const plan = optimizeBasket(items, toOptions(settings));
  return {
    list: { id: list.id, name: list.name },
    itemCount: list.items.length,
    openCount: open.length,
    plan,
    retailers,
    picked,
    pins,
    isDemo: plan.stops.some((stop) => stop.lines.some((line) => demo.has(line.candidate.productId))),
  };
}
