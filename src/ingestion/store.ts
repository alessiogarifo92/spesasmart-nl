import type { Prisma, PrismaClient, UnitKind } from "@/generated/prisma/client";
import { unitPrice, type Promotion, type QuantityUnit } from "@/domain/pricing";
import { normalizeName } from "@/domain/search/normalize";
import { isoToDbDate } from "@/lib/dates";
import type { NormalizedOffer, RawStore, RetailerAdapter } from "./adapter";
import { offerContentHash } from "./hash";
import type { Verdict } from "./validate";

/** Persistence of normalised offers and stores. The client is passed in, never imported. */

const UNIT_KINDS: Record<QuantityUnit, UnitKind> = { g: "G", ml: "ML", piece: "PIECE" };

/** `Offer.promoParams`, shaped like the parameters of the `Promotion` union. */
function promoParams(promotion: Promotion): Prisma.InputJsonObject {
  switch (promotion.type) {
    case "X_PLUS_Y_FREE":
      return { buy: promotion.buy, free: promotion.free };
    case "NTH_HALF_PRICE":
      return { n: promotion.n };
    case "X_FOR_PRICE":
      return { quantity: promotion.quantity, totalCents: promotion.totalCents };
    case "PERCENT_OFF":
      return { percent: promotion.percent };
    case "PRICE_CUT":
    case "UNKNOWN":
      return {};
  }
}

export type SaveOfferInput = {
  retailerId: string;
  adapter: Pick<RetailerAdapter, "id" | "retailerSlug" | "isMock">;
  offer: NormalizedOffer;
  verdict: Verdict;
  now: Date;
};

/**
 * Upserts the product (on retailer + external id) and the offer (on retailer + content
 * hash), and records the regular price in the history when it changed. Returns whether
 * the offer row was created or updated.
 */
export async function saveOffer(db: PrismaClient, input: SaveOfferInput): Promise<"created" | "updated"> {
  const { retailerId, adapter, offer, verdict, now } = input;
  const { product, validity } = offer;
  const isDemo = adapter.isMock;

  const category = product.categorySlug
    ? await db.category.findUnique({ where: { slug: product.categorySlug }, select: { id: true } })
    : null;
  const productData = {
    name: product.name,
    normalizedName: normalizeName(product.name),
    brand: product.brand,
    ean: product.ean,
    categoryId: category?.id ?? null,
    unit: product.quantity ? UNIT_KINDS[product.quantity.unit] : null,
    packageAmount: product.quantity?.amount ?? null,
    // The column is not nullable: one package when the size is unknown.
    packageCount: product.quantity?.count ?? 1,
    isOrganic: product.isOrganic,
    attributes: product.attributes,
    isDemo,
  };
  const productRow = await db.product.upsert({
    where: { retailerId_externalId: { retailerId, externalId: product.externalId } },
    update: productData,
    create: { ...productData, retailerId, externalId: product.externalId },
    select: { id: true },
  });

  const contentHash = offerContentHash(adapter.retailerSlug, offer);
  const offerData = {
    productId: productRow.id,
    title: offer.title,
    kind: offer.kind,
    currentPriceCents: offer.currentPriceCents,
    regularPriceCents: offer.regularPriceCents,
    promoType: offer.promotion.type,
    promoParams: promoParams(offer.promotion),
    promoDescription: offer.promoDescription,
    pricePerUnitCents:
      offer.currentPriceCents !== null && product.quantity
        ? unitPrice(offer.currentPriceCents, product.quantity).cents
        : null,
    validFrom: validity?.start ? isoToDbDate(validity.start) : null,
    validUntil: validity ? isoToDbDate(validity.end) : null,
    validityApproximate: validity?.approximate ?? false,
    conditions: offer.conditions,
    status: verdict.status,
    confidence: verdict.confidence,
    sourceUrl: offer.sourceUrl,
    collectedAt: now,
    rawPayload: offer.rawPayload,
    isDemo,
  };
  const existing = await db.offer.findUnique({
    where: { retailerId_contentHash: { retailerId, contentHash } },
    select: { id: true },
  });
  await db.offer.upsert({
    where: { retailerId_contentHash: { retailerId, contentHash } },
    update: offerData,
    create: { ...offerData, retailerId, contentHash },
  });

  if (offer.regularPriceCents !== null) {
    const latest = await db.priceHistory.findFirst({
      where: { productId: productRow.id },
      orderBy: { recordedAt: "desc" },
      select: { priceCents: true },
    });
    if (latest?.priceCents !== offer.regularPriceCents) {
      await db.priceHistory.create({
        data: {
          productId: productRow.id,
          retailerId,
          priceCents: offer.regularPriceCents,
          sourceUrl: offer.sourceUrl,
          isDemo,
          recordedAt: now,
        },
      });
    }
  }
  return existing ? "updated" : "created";
}

/** Upserts store locations on (retailer, source reference); returns how many were written. */
export async function saveStores(db: PrismaClient, retailerId: string, stores: RawStore[]): Promise<number> {
  for (const store of stores) {
    const data = {
      name: store.name,
      address: store.address,
      postalCode: store.postalCode,
      city: store.city,
      latitude: store.latitude,
      longitude: store.longitude,
    };
    await db.store.upsert({
      where: { retailerId_sourceRef: { retailerId, sourceRef: store.sourceRef } },
      update: data,
      create: { ...data, retailerId, sourceRef: store.sourceRef },
    });
  }
  return stores.length;
}
