import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { normalizeName } from "@/domain/search/normalize";
import { MOCK_ADAPTERS } from "@/ingestion/adapters/mock";
import { isDemoOfferListed } from "@/ingestion/adapters/mock/catalogue";
import { dedupeKeyHash } from "@/ingestion/hash";
import { createOfflineHttpClient } from "@/ingestion/http";
import { rebuildMatches } from "@/ingestion/match-products";
import { runAll } from "@/ingestion/runner";
import type { IsoDate } from "@/lib/dates";
import { DEMO_OFFERS, DEMO_PRODUCTS, DEMO_SOURCE_URL } from "./demo";
import { CATEGORIES, RETAILERS, type RetailerSlug } from "./reference";

export { DEMO_SOURCE_URL };

export type SeedOptions = {
  /** Seed day in Europe/Amsterdam; demo validity is counted from it. */
  today: IsoDate;
  /** Timestamp written as the collection time of demo rows. */
  now: Date;
  /** Skip the demo catalogue and offers (reference data only). */
  withDemo?: boolean;
};

export type SeedResult = { retailers: number; categories: number; products: number; offers: number; matches: number };

/** Content hash this seed gave demo offers before they went through the ingestion pipeline. */
function legacyDemoHash(key: string): string {
  return createHash("sha256").update(`demo:${key}`).digest("hex");
}

/**
 * Demo offers written by the earlier seed carry a content hash the pipeline never
 * produces. Re-key each one to the pipeline's hash so the row (and anything pointing at
 * it) is kept; remove it when the pipeline row already exists or the offer is no longer
 * listed. Touches only demo rows from `DEMO_SOURCE_URL`. A no-op once a database has
 * been seeded with this version.
 */
async function migrateLegacyDemoOffers(db: PrismaClient, retailerIds: Map<RetailerSlug, string>): Promise<void> {
  for (const offer of DEMO_OFFERS) {
    const retailerId = retailerIds.get(offer.retailer)!;
    const legacy = await db.offer.findUnique({
      where: { retailerId_contentHash: { retailerId, contentHash: legacyDemoHash(offer.key) } },
      select: { id: true, isDemo: true, sourceUrl: true },
    });
    if (!legacy || !legacy.isDemo || legacy.sourceUrl !== DEMO_SOURCE_URL) continue;

    const contentHash = dedupeKeyHash(offer.retailer, offer.key);
    const current = await db.offer.findUnique({
      where: { retailerId_contentHash: { retailerId, contentHash } },
      select: { id: true },
    });
    if (current || !isDemoOfferListed(offer)) await db.offer.delete({ where: { id: legacy.id } });
    else await db.offer.update({ where: { id: legacy.id }, data: { contentHash } });
  }
}

/**
 * Writes reference data and, unless disabled, the demo catalogue. Safe to run
 * repeatedly: every row is matched on a stable key and updated in place. Demo offers
 * are produced by the four mock adapters through the real ingestion pipeline.
 */
export async function seedDatabase(db: PrismaClient, options: SeedOptions): Promise<SeedResult> {
  const retailerIds = new Map<RetailerSlug, string>();
  for (const { slug, name, website } of RETAILERS) {
    const retailer = await db.retailer.upsert({
      where: { slug },
      update: { name, website },
      create: { slug, name, website },
    });
    retailerIds.set(slug, retailer.id);
  }

  const categoryIds = new Map<string, string>();
  for (const [position, category] of CATEGORIES.entries()) {
    const { slug, ...names } = category;
    const row = await db.category.upsert({
      where: { slug },
      update: { ...names, position },
      create: { slug, ...names, position },
    });
    categoryIds.set(slug, row.id);
  }

  const result: SeedResult = {
    retailers: RETAILERS.length,
    categories: CATEGORIES.length,
    products: 0,
    offers: 0,
    matches: 0,
  };
  if (options.withDemo === false) return result;

  for (const product of DEMO_PRODUCTS) {
    const categoryId = categoryIds.get(product.category);
    if (!categoryId) throw new Error(`Demo product "${product.concept}" has unknown category "${product.category}"`);
    for (const [slug, variant] of Object.entries(product.variants) as [
      RetailerSlug,
      { name: string; regularCents: number },
    ][]) {
      const retailerId = retailerIds.get(slug)!;
      const data = {
        name: variant.name,
        normalizedName: normalizeName(variant.name),
        brand: product.brand ?? null,
        categoryId,
        ean: product.ean ?? null,
        unit: product.unit,
        packageAmount: product.packageAmount,
        packageCount: product.packageCount ?? 1,
        isOrganic: product.isOrganic ?? false,
        attributes: product.attributes ?? {},
        isDemo: true,
      };
      const externalId = `demo-${product.concept}`;
      const row = await db.product.upsert({
        where: { retailerId_externalId: { retailerId, externalId } },
        update: data,
        create: { ...data, retailerId, externalId },
      });
      result.products += 1;

      // One regular-price record per demo product, refreshed in place.
      const price = { priceCents: variant.regularCents, sourceUrl: DEMO_SOURCE_URL, recordedAt: options.now };
      const existing = await db.priceHistory.findFirst({
        where: { productId: row.id, isDemo: true },
        select: { id: true },
      });
      if (existing) await db.priceHistory.update({ where: { id: existing.id }, data: price });
      else await db.priceHistory.create({ data: { ...price, productId: row.id, retailerId, isDemo: true } });
    }
  }

  await migrateLegacyDemoOffers(db, retailerIds);
  const runs = await runAll([...MOCK_ADAPTERS], {
    db,
    // Mock adapters make no requests: any attempt would fail loudly.
    createHttp: createOfflineHttpClient,
    now: () => options.now,
    today: () => options.today,
    enabledAdapters: [],
  });
  const failed = runs.filter((run) => run.status !== "SUCCESS");
  if (runs.length !== MOCK_ADAPTERS.length || failed.length > 0) {
    const detail = failed.map(({ adapter, status, errors }) => ({ adapter, status, errors }));
    throw new Error(`Demo ingestion did not succeed: ${JSON.stringify(detail)}`);
  }
  result.offers = runs.reduce((total, run) => total + run.itemsUpdated, 0);

  // Link the chains' listings of the same product, as every collection run does.
  await rebuildMatches(db, { retailerIds: [...retailerIds.values()] });
  result.matches = await db.productMatch.count({
    where: { canonicalProduct: { retailerId: { in: [...retailerIds.values()] } } },
  });
  return result;
}
