import type { PrismaClient } from "@/generated/prisma/client";
import { priceCandidate, type Candidate, type CandidatePrice, type MatchTier } from "@/domain/optimizer";
import type { IsoDate, Quantity, QuantityUnit } from "@/domain/pricing";
import { currentOffers, type OfferView } from "./offers";

/** One chain's listing of a product, with what it costs today. */
export type CatalogProduct = {
  id: string;
  name: string;
  brand: string | null;
  ean: string | null;
  isOrganic: boolean;
  isDemo: boolean;
  retailer: { slug: string; name: string };
  categorySlug: string | null;
  /** Package size; null when the source does not state one. */
  quantity: Quantity | null;
  /** Latest recorded shelf price, else the regular price an offer states; null when neither is known. */
  regularPriceCents: number | null;
  /** Where and when the shelf price was recorded; null without one. The url is null for demo rows. */
  priceSource: { url: string | null; recordedAt: Date } | null;
  /** The offer in force today, verified or not. */
  offer: OfferView | null;
  /** Cost of one item today; null when no price is known. An unverified offer never lowers it. */
  price: CandidatePrice | null;
};

const UNIT: Record<"G" | "ML" | "PIECE", QuantityUnit> = { G: "g", ML: "ml", PIECE: "piece" };

function quantityOf(row: { unit: "G" | "ML" | "PIECE" | null; packageAmount: number | null; packageCount: number }): Quantity | null {
  if (row.unit === null || row.packageAmount === null) return null;
  return {
    amount: row.packageAmount,
    unit: UNIT[row.unit],
    count: row.packageCount,
    totalAmount: row.packageAmount * row.packageCount,
    approximate: false,
  };
}

/** The product as the optimiser and the price comparison take it. */
export function toCandidate(product: Omit<CatalogProduct, "price">, tier: MatchTier): Candidate {
  const { offer } = product;
  const state = offer?.summary.state;
  return {
    productId: product.id,
    retailerId: product.retailer.slug,
    name: product.name,
    tier,
    regularPriceCents: product.regularPriceCents,
    offer: offer
      ? {
          offerId: offer.id,
          promotion: offer.promotion,
          offerPriceCents: offer.offerPriceCents,
          verified: offer.verified && (state === "running" || state === "ends-today"),
          daysLeft: offer.summary.daysLeft,
        }
      : null,
    quantity: product.quantity,
    isOrganic: product.isOrganic,
  };
}

/**
 * Loads products of active chains with today's price. Unknown ids, and
 * products of a chain that was switched off, are left out.
 */
export async function loadProducts(db: PrismaClient, ids: string[], today: IsoDate): Promise<Map<string, CatalogProduct>> {
  if (ids.length === 0) return new Map();
  const [rows, prices, offers] = await Promise.all([
    db.product.findMany({
      where: { id: { in: ids }, retailer: { active: true } },
      select: {
        id: true,
        name: true,
        brand: true,
        ean: true,
        isOrganic: true,
        isDemo: true,
        unit: true,
        packageAmount: true,
        packageCount: true,
        retailer: { select: { slug: true, name: true } },
        category: { select: { slug: true } },
      },
    }),
    db.priceHistory.findMany({
      where: { productId: { in: ids } },
      orderBy: [{ productId: "asc" }, { recordedAt: "desc" }],
      distinct: ["productId"],
      select: { productId: true, priceCents: true, regularPriceCents: true, sourceUrl: true, recordedAt: true },
    }),
    currentOffers(db, ids, today),
  ]);
  const recorded = new Map(prices.map((price) => [price.productId, price]));

  const products = new Map<string, CatalogProduct>();
  for (const row of rows) {
    if (!row.retailer) continue;
    const offer = offers.get(row.id) ?? null;
    const shelf = recorded.get(row.id);
    const base = {
      id: row.id,
      name: row.name,
      brand: row.brand,
      ean: row.ean,
      isOrganic: row.isOrganic,
      isDemo: row.isDemo,
      retailer: row.retailer,
      categorySlug: row.category?.slug ?? null,
      quantity: quantityOf(row),
      regularPriceCents: shelf ? (shelf.regularPriceCents ?? shelf.priceCents) : (offer?.regularPriceCents ?? null),
      priceSource: shelf
        ? { url: shelf.sourceUrl && /^https?:\/\//.test(shelf.sourceUrl) ? shelf.sourceUrl : null, recordedAt: shelf.recordedAt }
        : null,
      offer,
    };
    const price = priceCandidate(toCandidate(base, "EXACT"), 1);
    products.set(row.id, { ...base, price: price.ok ? price.value : null });
  }
  return products;
}
