import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { normalizeName } from "@/domain/search/normalize";
import { addDays, isoToDbDate, type IsoDate } from "@/lib/dates";
import { DEMO_OFFERS, DEMO_PRODUCTS, type DemoOffer, type DemoProduct } from "./demo";
import { CATEGORIES, RETAILERS, type RetailerSlug } from "./reference";

export const DEMO_SOURCE_URL = "demo:seed";

export type SeedOptions = {
  /** Seed day in Europe/Amsterdam; demo validity is counted from it. */
  today: IsoDate;
  /** Timestamp written as the collection time of demo rows. */
  now: Date;
  /** Skip the demo catalogue and offers (reference data only). */
  withDemo?: boolean;
};

export type SeedResult = { retailers: number; categories: number; products: number; offers: number };

/** Cents per kg, per litre or per piece for one sales unit; rounds half up. */
function unitPriceCents(priceCents: number, product: DemoProduct): number {
  const total = product.packageAmount * (product.packageCount ?? 1);
  return product.unit === "PIECE"
    ? Math.round(priceCents / total)
    : Math.round((priceCents * 1000) / total);
}

function demoHash(key: string): string {
  return createHash("sha256").update(`demo:${key}`).digest("hex");
}

/**
 * Writes reference data and, unless disabled, the demo catalogue. Safe to run
 * repeatedly: every row is matched on a stable key and updated in place.
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
  };
  if (options.withDemo === false) return result;

  /** Product id per `concept` and retailer. */
  const productIds = new Map<string, string>();
  for (const product of DEMO_PRODUCTS) {
    for (const [slug, variant] of Object.entries(product.variants) as [
      RetailerSlug,
      { name: string; regularCents: number },
    ][]) {
      const retailerId = retailerIds.get(slug)!;
      const data = {
        name: variant.name,
        normalizedName: normalizeName(variant.name),
        brand: product.brand ?? null,
        categoryId: categoryIds.get(product.category)!,
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
      productIds.set(`${product.concept}@${slug}`, row.id);
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

  for (const offer of DEMO_OFFERS) {
    await upsertDemoOffer(db, offer, retailerIds, productIds, options);
    result.offers += 1;
  }
  return result;
}

async function upsertDemoOffer(
  db: PrismaClient,
  offer: DemoOffer,
  retailerIds: Map<RetailerSlug, string>,
  productIds: Map<string, string>,
  options: SeedOptions,
): Promise<void> {
  const product = DEMO_PRODUCTS.find((candidate) => candidate.concept === offer.concept);
  const variant = product?.variants[offer.retailer];
  const productId = productIds.get(`${offer.concept}@${offer.retailer}`);
  if (!product || !variant || !productId) {
    throw new Error(`Demo offer "${offer.key}" points at a product that ${offer.retailer} does not sell`);
  }

  const retailerId = retailerIds.get(offer.retailer)!;
  const currentPriceCents = "currentCents" in offer ? offer.currentCents : null;
  const validityKnown = offer.untilOffset !== null;
  const data = {
    productId,
    title: variant.name,
    kind: offer.kind ?? "WEEKLY",
    currentPriceCents,
    regularPriceCents: variant.regularCents,
    promoType: offer.promoType,
    promoParams: "promoParams" in offer ? offer.promoParams : {},
    promoDescription: offer.promoDescription ?? null,
    pricePerUnitCents: currentPriceCents === null ? null : unitPriceCents(currentPriceCents, product),
    validFrom: offer.fromOffset === null ? null : isoToDbDate(addDays(options.today, offer.fromOffset)),
    validUntil: offer.untilOffset === null ? null : isoToDbDate(addDays(options.today, offer.untilOffset)),
    conditions: offer.conditions ?? null,
    // An offer whose validity is unknown is never presented as verified.
    status: validityKnown ? ("VERIFIED" as const) : ("UNVERIFIED" as const),
    confidence: validityKnown ? 1 : 0.5,
    sourceUrl: DEMO_SOURCE_URL,
    collectedAt: options.now,
    rawPayload: { demo: true, key: offer.key },
    isDemo: true,
  };
  const contentHash = demoHash(offer.key);
  await db.offer.upsert({
    where: { retailerId_contentHash: { retailerId, contentHash } },
    update: data,
    create: { ...data, retailerId, contentHash },
  });
}
