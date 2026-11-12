import type { PrismaClient } from "@/generated/prisma/client";
import type { MatchType } from "@/domain/matching";
import type { IsoDate } from "@/domain/pricing";
import { markBest } from "@/domain/search";
import { loadProducts, type CatalogProduct } from "./catalog";

type Marks = { lowestPrice: boolean; bestUnitPrice: boolean };

/** Another chain's listing that was linked to the product, with what it costs today. */
export type ComparisonRow = Marks & {
  product: CatalogProduct;
  /** The link, so a wrong one can be reported. */
  matchId: string;
  type: MatchType;
};

export type Comparison = {
  /** The product that was asked for. */
  product: CatalogProduct & Marks;
  /** The same or a very similar product at other chains, cheapest first. */
  equals: ComparisonRow[];
  /** Another size or variant: compare on the unit price. Best unit price first. */
  alternatives: ComparisonRow[];
};

const byNumber = (a: number | null | undefined, b: number | null | undefined) =>
  (a ?? Number.POSITIVE_INFINITY) - (b ?? Number.POSITIVE_INFINITY);

/**
 * A product next to what other chains sell as the same thing. Only links that are
 * shown without review (AUTO) or that a person confirmed are used; a link waiting
 * for review, or a rejected one, never reaches the interface.
 *
 * "Lowest price" is decided among the product and its equals, which are about the
 * same size. "Best unit price" is decided among all rows, alternatives included:
 * that is the one number that compares a 1 l pack with a 2 l pack.
 */
export async function compareProduct(db: PrismaClient, productId: string, today: IsoDate): Promise<Comparison | null> {
  const links = await db.productMatch.findMany({
    where: {
      status: { in: ["AUTO", "CONFIRMED"] },
      OR: [{ canonicalProductId: productId }, { candidateProductId: productId }],
    },
    select: { id: true, canonicalProductId: true, candidateProductId: true, matchType: true },
  });
  const other = (link: (typeof links)[number]) =>
    link.canonicalProductId === productId ? link.candidateProductId : link.canonicalProductId;

  const products = await loadProducts(db, [productId, ...links.map(other)], today);
  const product = products.get(productId);
  if (!product) return null;

  const rows = links.flatMap((link) => {
    const linked = products.get(other(link));
    // A chain that was switched off is not loaded: its listing drops out of the comparison.
    return linked && linked.retailer.slug !== product.retailer.slug
      ? [{ product: linked, matchId: link.id, type: link.matchType }]
      : [];
  });
  const equals = rows.filter((row) => row.type !== "ALTERNATIVE");
  const alternatives = rows.filter((row) => row.type === "ALTERNATIVE");

  const priced = (item: CatalogProduct) => ({
    priceCents: item.price?.totalCents ?? null,
    unitPrice: item.price?.unitPrice ?? null,
  });
  const comparable = [product, ...equals.map((row) => row.product)];
  const everything = [...comparable, ...alternatives.map((row) => row.product)];
  const lowest = markBest(comparable.map(priced));
  const unit = markBest(everything.map(priced));
  const marks = (index: number): Marks => ({
    lowestPrice: lowest[index]?.lowestPrice ?? false,
    bestUnitPrice: unit[index]!.bestUnitPrice,
  });

  const order = (a: ComparisonRow, b: ComparisonRow) =>
    a.product.name.localeCompare(b.product.name) || a.product.id.localeCompare(b.product.id);
  return {
    product: { ...product, ...marks(0) },
    equals: equals
      .map((row, index) => ({ ...row, ...marks(index + 1) }))
      .sort((a, b) => byNumber(a.product.price?.totalCents, b.product.price?.totalCents) || order(a, b)),
    alternatives: alternatives
      .map((row, index) => ({ ...row, ...marks(comparable.length + index) }))
      .sort((a, b) => byNumber(a.product.price?.unitPrice?.cents, b.product.price?.unitPrice?.cents) || order(a, b)),
  };
}
