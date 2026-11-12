import type { PrismaClient } from "@/generated/prisma/client";
import { matchProducts, type Match, type MatchProduct } from "@/domain/matching";
import { unitPrice, type Quantity, type QuantityUnit } from "@/domain/pricing";

export type MatchRebuild = {
  /** Listings looked at. */
  products: number;
  created: number;
  updated: number;
  /** Automatic links the matcher no longer makes. */
  removed: number;
  /** Links a person confirmed or rejected; never touched. */
  decided: number;
};

const UNIT: Record<"G" | "ML" | "PIECE", QuantityUnit> = { G: "g", ML: "ml", PIECE: "piece" };

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Recomputes the links between listings of different chains and stores them in
 * `product_matches`, one row per pair (the lower product id is the canonical side).
 *
 * A link a person confirmed or rejected is a decision and is left exactly as it is.
 * Automatic links are created, updated to the matcher's current verdict, and removed
 * when the matcher no longer makes them. With `retailerIds`, only listings of those
 * chains are compared and only links between them are touched.
 */
export async function rebuildMatches(db: PrismaClient, scope: { retailerIds?: string[] } = {}): Promise<MatchRebuild> {
  const rows = await db.product.findMany({
    where: { retailer: { active: true, ...(scope.retailerIds ? { id: { in: scope.retailerIds } } : {}) } },
    orderBy: { id: "asc" },
    select: {
      id: true,
      retailerId: true,
      name: true,
      brand: true,
      ean: true,
      unit: true,
      packageAmount: true,
      packageCount: true,
      isOrganic: true,
      category: { select: { slug: true } },
      priceHistory: {
        orderBy: { recordedAt: "desc" },
        take: 1,
        select: { priceCents: true, regularPriceCents: true },
      },
    },
  });

  const products: MatchProduct[] = [];
  for (const row of rows) {
    if (row.retailerId === null) continue;
    const quantity: Quantity | null =
      row.unit !== null && row.packageAmount !== null && row.packageAmount > 0 && row.packageCount > 0
        ? {
            amount: row.packageAmount,
            unit: UNIT[row.unit],
            count: row.packageCount,
            totalAmount: row.packageAmount * row.packageCount,
            approximate: false,
          }
        : null;
    const shelf = row.priceHistory[0];
    const cents = shelf ? (shelf.regularPriceCents ?? shelf.priceCents) : null;
    products.push({
      id: row.id,
      retailerId: row.retailerId,
      name: row.name,
      brand: row.brand,
      ean: row.ean,
      categorySlug: row.category?.slug ?? null,
      quantity,
      isOrganic: row.isOrganic,
      unitPrice: quantity !== null && cents !== null && cents >= 0 ? unitPrice(cents, quantity) : null,
    });
  }

  const wanted = new Map<string, { canonicalProductId: string; candidateProductId: string; match: Match }>();
  for (let i = 0; i < products.length; i++) {
    for (let j = i + 1; j < products.length; j++) {
      const match = matchProducts(products[i]!, products[j]!);
      // Rows are ordered by id, so products[i] is the lower id of the pair.
      if (match) {
        wanted.set(pairKey(products[i]!.id, products[j]!.id), {
          canonicalProductId: products[i]!.id,
          candidateProductId: products[j]!.id,
          match,
        });
      }
    }
  }

  const ids = products.map((product) => product.id);
  const existing = await db.productMatch.findMany({
    where: { canonicalProductId: { in: ids }, candidateProductId: { in: ids } },
    select: {
      id: true,
      canonicalProductId: true,
      candidateProductId: true,
      matchType: true,
      confidence: true,
      status: true,
    },
  });

  const result: MatchRebuild = { products: products.length, created: 0, updated: 0, removed: 0, decided: 0 };
  const stale: string[] = [];
  const changed: { id: string; match: Match }[] = [];
  for (const row of existing) {
    const key = pairKey(row.canonicalProductId, row.candidateProductId);
    const target = wanted.get(key);
    wanted.delete(key);
    if (row.status === "CONFIRMED" || row.status === "REJECTED") {
      result.decided += 1;
    } else if (!target) {
      stale.push(row.id);
    } else if (
      row.matchType !== target.match.type ||
      row.confidence !== target.match.confidence ||
      row.status !== target.match.status
    ) {
      changed.push({ id: row.id, match: target.match });
    }
  }

  await db.$transaction([
    db.productMatch.deleteMany({ where: { id: { in: stale } } }),
    ...changed.map(({ id, match }) =>
      db.productMatch.update({
        where: { id },
        data: { matchType: match.type, confidence: match.confidence, status: match.status },
      }),
    ),
    db.productMatch.createMany({
      data: [...wanted.values()].map(({ canonicalProductId, candidateProductId, match }) => ({
        canonicalProductId,
        candidateProductId,
        matchType: match.type,
        confidence: match.confidence,
        status: match.status,
      })),
      skipDuplicates: true,
    }),
  ]);
  result.removed = stale.length;
  result.updated = changed.length;
  result.created = wanted.size;
  return result;
}
