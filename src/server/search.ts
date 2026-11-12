import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { IsoDate } from "@/domain/pricing";
import { fuzzyThreshold, isEmptyQuery, likePattern, markBest, type ParsedQuery, type SearchContext } from "@/domain/search";
import { loadProducts, type CatalogProduct } from "./catalog";

export type SearchHit = {
  product: CatalogProduct;
  /** 0 to 1: how well the name matches the words searched. */
  score: number;
  /** The package is the size named in the query; always true when no size was named. */
  sizeMatch: boolean;
  lowestPrice: boolean;
  bestUnitPrice: boolean;
};

export type SearchResults = {
  hits: SearchHit[];
  /** Matches before the page limit. */
  total: number;
  /** A size was named and at least one result has it: the marks then compare that size only. */
  sizeFound: boolean;
};

export const SEARCH_PAGE_SIZE = 40;
/** Matches loaded and compared; more than this and the query is too broad to compare usefully. */
const MATCH_CAP = 200;
/** Score from which a match counts as clear rather than loose. */
const CLEAR_MATCH = 0.55;

/** Brand and category names the query parser recognises, read from the catalogue. */
export async function searchContext(db: PrismaClient): Promise<SearchContext> {
  const [brands, categories] = await Promise.all([
    db.product.findMany({ where: { brand: { not: null } }, select: { brand: true }, distinct: ["brand"] }),
    db.category.findMany({ select: { slug: true, nameNl: true, nameEn: true, nameIt: true } }),
  ]);
  return {
    brands: brands.map((row) => row.brand!).filter(Boolean),
    categories: categories.map((c) => ({ slug: c.slug, names: [c.nameNl, c.nameEn, c.nameIt] })),
  };
}

/**
 * Every term has to match the name: as a substring, as a Dutch word stem
 * (full-text), or, for longer words, by trigram similarity, which is what
 * forgives typos.
 */
function termMatch(term: string): { where: Prisma.Sql; score: Prisma.Sql } {
  const like = likePattern(term);
  const threshold = fuzzyThreshold(term);
  const substring = Prisma.sql`p."normalizedName" LIKE ${like}`;
  const stem = Prisma.sql`to_tsvector('dutch', p."normalizedName") @@ plainto_tsquery('dutch', ${term})`;
  const similarity = Prisma.sql`word_similarity(${term}, p."normalizedName")`;
  return {
    where:
      threshold === null
        ? Prisma.sql`(${substring} OR ${stem})`
        : Prisma.sql`(${substring} OR ${stem} OR ${similarity} >= ${threshold}::float8)`,
    score: Prisma.sql`GREATEST(${similarity}, CASE WHEN ${stem} THEN 0.9 WHEN ${substring} THEN 0.6 ELSE 0 END)`,
  };
}

export async function searchProducts(
  db: PrismaClient,
  options: { query: ParsedQuery; today: IsoDate; retailers?: string[]; limit?: number },
): Promise<SearchResults> {
  const { query, today, retailers = [], limit = SEARCH_PAGE_SIZE } = options;
  // Nothing asked for: no results, rather than the whole catalogue.
  if (isEmptyQuery(query)) return { hits: [], total: 0, sizeFound: false };
  const terms = query.terms.map(termMatch);

  const where: Prisma.Sql[] = [Prisma.sql`r."active"`, ...terms.map((term) => term.where)];
  if (query.ean) where.push(Prisma.sql`p."ean" = ${query.ean}`);
  if (query.brand) where.push(Prisma.sql`p."brand" = ${query.brand}`);
  if (query.categorySlug) where.push(Prisma.sql`c."slug" = ${query.categorySlug}`);
  if (query.organic) where.push(Prisma.sql`p."isOrganic"`);
  for (const attribute of query.attributes) where.push(Prisma.sql`p."attributes" ->> ${attribute} = 'true'`);
  if (retailers.length > 0) where.push(Prisma.sql`r."slug" IN (${Prisma.join(retailers)})`);

  const score =
    terms.length > 0
      ? Prisma.sql`(${Prisma.join(terms.map((term) => term.score), " + ")}) / ${terms.length}::float8`
      : Prisma.sql`1`;

  const matches = await db.$queryRaw<{ id: string; score: number }[]>(Prisma.sql`
    SELECT p."id", (${score})::float8 AS "score"
    FROM "products" p
    JOIN "retailers" r ON r."id" = p."retailerId"
    LEFT JOIN "categories" c ON c."id" = p."categoryId"
    WHERE ${Prisma.join(where, " AND ")}
    ORDER BY "score" DESC, p."normalizedName", p."id"
    LIMIT ${MATCH_CAP}
  `);

  const products = await loadProducts(db, matches.map((match) => match.id), today);
  const asked = query.quantity;
  const found = matches.flatMap((match) => {
    const product = products.get(match.id);
    if (!product) return [];
    const sizeMatch =
      asked === null ||
      (product.quantity !== null &&
        product.quantity.unit === asked.unit &&
        product.quantity.totalAmount === asked.totalAmount);
    return [{ product, score: match.score, sizeMatch }];
  });

  const sizeFound = asked !== null && found.some((hit) => hit.sizeMatch);
  const price = (hit: { product: CatalogProduct }) => hit.product.price?.totalCents ?? Infinity;
  // Two steps of relevance only: a clear match (the word, a form of it, a small typo) or a
  // loose one. Within a step the cheapest comes first, which is what a price search is for.
  const relevance = (hit: { score: number }) => (hit.score >= CLEAR_MATCH ? 1 : 0);
  found.sort(
    (a, b) =>
      Number(b.sizeMatch) - Number(a.sizeMatch) ||
      (query.cheapestFirst ? price(a) - price(b) : relevance(b) - relevance(a)) ||
      price(a) - price(b) ||
      a.product.name.localeCompare(b.product.name, "nl") ||
      a.product.id.localeCompare(b.product.id),
  );

  // Compare like with like: when the asked size exists, only that size competes for the marks.
  const compared = found.filter((hit) => !sizeFound || hit.sizeMatch);
  const flags = markBest(
    compared.map((hit) => ({
      priceCents: hit.product.price?.totalCents ?? null,
      unitPrice: hit.product.price?.unitPrice ?? null,
    })),
  );
  const flagged = new Map(compared.map((hit, index) => [hit.product.id, flags[index]]));

  return {
    hits: found
      .slice(0, limit)
      .map((hit) => ({ ...hit, ...(flagged.get(hit.product.id) ?? { lowestPrice: false, bestUnitPrice: false }) })),
    total: found.length,
    sizeFound,
  };
}
