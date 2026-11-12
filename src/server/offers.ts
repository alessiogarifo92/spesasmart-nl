import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  describeOffer,
  promotionFromStored,
  type OfferFilters,
  type OfferSummary,
} from "@/domain/offers";
import type { IsoDate, Promotion, UnitBasis } from "@/domain/pricing";
import { addDays, dbDateToIso, isoToDbDate } from "@/lib/dates";

const offerInclude = {
  retailer: { select: { slug: true, name: true } },
  product: {
    select: {
      id: true,
      name: true,
      brand: true,
      unit: true,
      isOrganic: true,
      category: { select: { slug: true } },
    },
  },
} satisfies Prisma.OfferInclude;

type OfferRow = Prisma.OfferGetPayload<{ include: typeof offerInclude }>;

/** An offer as the interface shows it: stored facts plus the derived, labelled estimates. */
export type OfferView = {
  id: string;
  productId: string;
  name: string;
  brand: string | null;
  isOrganic: boolean;
  retailer: { slug: string; name: string };
  kind: "WEEKLY" | "DAILY";
  promotion: Promotion;
  /** The mechanic in the chain's own words, when it has one. */
  promoDescription: string | null;
  /** Price of one item under the offer, when the source states one. */
  offerPriceCents: number | null;
  regularPriceCents: number | null;
  unitPrice: { cents: number; basis: UnitBasis } | null;
  validFrom: IsoDate | null;
  validUntil: IsoDate | null;
  validityApproximate: boolean;
  conditions: string | null;
  /** False: validity unknown or doubtful; shown as "to be verified". */
  verified: boolean;
  /** Null for demo rows, which have no real source page. */
  sourceUrl: string | null;
  collectedAt: Date;
  isDemo: boolean;
  summary: OfferSummary;
};

const BASIS: Record<"G" | "ML" | "PIECE", UnitBasis> = { G: "kg", ML: "l", PIECE: "piece" };

function toView(row: OfferRow, today: IsoDate): OfferView {
  const promotion = promotionFromStored(row.promoType, row.promoParams, row.promoDescription);
  const validFrom = row.validFrom ? dbDateToIso(row.validFrom) : null;
  const validUntil = row.validUntil ? dbDateToIso(row.validUntil) : null;
  return {
    id: row.id,
    productId: row.product.id,
    name: row.title,
    brand: row.product.brand,
    isOrganic: row.product.isOrganic,
    retailer: row.retailer,
    kind: row.kind,
    promotion,
    promoDescription: row.promoDescription,
    offerPriceCents: row.currentPriceCents,
    regularPriceCents: row.regularPriceCents,
    unitPrice:
      row.pricePerUnitCents !== null && row.product.unit !== null
        ? { cents: row.pricePerUnitCents, basis: BASIS[row.product.unit] }
        : null,
    validFrom,
    validUntil,
    validityApproximate: row.validityApproximate,
    conditions: row.conditions,
    verified: row.status === "VERIFIED",
    sourceUrl: /^https?:\/\//.test(row.sourceUrl) ? row.sourceUrl : null,
    collectedAt: row.collectedAt,
    isDemo: row.isDemo,
    summary: describeOffer(
      {
        promotion,
        currentPriceCents: row.currentPriceCents,
        regularPriceCents: row.regularPriceCents,
        validFrom,
        validUntil,
      },
      today,
    ),
  };
}

/** Offers that may be shown today: not rejected and not past their last day. */
function visibleToday(today: IsoDate): Prisma.OfferWhereInput {
  return {
    status: { not: "REJECTED" },
    retailer: { active: true },
    OR: [{ validUntil: null }, { validUntil: { gte: isoToDbDate(today) } }],
  };
}

function filterWhere(filters: OfferFilters, today: IsoDate): Prisma.OfferWhereInput {
  const day = isoToDbDate(today);
  const product: Prisma.ProductWhereInput = {
    ...(filters.category ? { category: { slug: filters.category } } : {}),
    ...(filters.brand ? { brand: filters.brand } : {}),
    ...(filters.organic ? { isOrganic: true } : {}),
  };
  const period: Prisma.OfferWhereInput = filters.upcoming
    ? { validFrom: { gt: day } }
    : filters.within
      ? {
          validUntil: { lte: isoToDbDate(addDays(today, filters.within)) },
          OR: [{ validFrom: null }, { validFrom: { lte: day } }],
        }
      : {};
  return {
    ...(filters.retailers.length > 0 ? { retailer: { slug: { in: filters.retailers }, active: true } } : {}),
    ...(Object.keys(product).length > 0 ? { product } : {}),
    ...period,
  };
}

const STATE_ORDER: Record<OfferSummary["state"], number> = {
  "ends-today": 0,
  running: 1,
  "unknown-validity": 2,
  upcoming: 3,
  expired: 4,
};

/** Soonest to end first; offers with unknown validity after the dated ones; upcoming last. */
function byUrgency(a: OfferView, b: OfferView): number {
  return (
    STATE_ORDER[a.summary.state] - STATE_ORDER[b.summary.state] ||
    (a.summary.startsInDays ?? 0) - (b.summary.startsInDays ?? 0) ||
    (a.summary.daysLeft ?? 0) - (b.summary.daysLeft ?? 0) ||
    (b.summary.discountPercent ?? 0) - (a.summary.discountPercent ?? 0) ||
    a.name.localeCompare(b.name, "nl") ||
    a.id.localeCompare(b.id)
  );
}

export const OFFER_PAGE_SIZE = 60;

export async function listOffers(
  db: PrismaClient,
  { today, filters, limit = OFFER_PAGE_SIZE }: { today: IsoDate; filters: OfferFilters; limit?: number },
): Promise<{ offers: OfferView[]; total: number }> {
  const where: Prisma.OfferWhereInput = { AND: [visibleToday(today), filterWhere(filters, today)] };
  const rows = await db.offer.findMany({ where, include: offerInclude });
  const offers = rows.map((row) => toView(row, today)).sort(byUrgency);
  return { offers: offers.slice(0, limit), total: offers.length };
}

/**
 * The offer in force today for each product: not rejected, started and not
 * past its last day. With several, a verified one wins, then the lower price.
 * Offers with unknown validity are returned too; they are shown as "to be
 * verified" and never used for a price.
 */
export async function currentOffers(
  db: PrismaClient,
  productIds: string[],
  today: IsoDate,
): Promise<Map<string, OfferView>> {
  if (productIds.length === 0) return new Map();
  const rows = await db.offer.findMany({
    where: {
      AND: [
        visibleToday(today),
        { productId: { in: productIds }, OR: [{ validFrom: null }, { validFrom: { lte: isoToDbDate(today) } }] },
      ],
    },
    include: offerInclude,
  });
  const best = new Map<string, OfferView>();
  const views = rows
    .map((row) => toView(row, today))
    .sort(
      (a, b) =>
        Number(b.verified) - Number(a.verified) ||
        (a.summary.shownPriceCents ?? Infinity) - (b.summary.shownPriceCents ?? Infinity) ||
        a.id.localeCompare(b.id),
    );
  for (const view of views) if (!best.has(view.productId)) best.set(view.productId, view);
  return best;
}

export type OfferFacets = {
  retailers: { slug: string; name: string }[];
  categories: { slug: string; nameNl: string; nameEn: string; nameIt: string }[];
  brands: string[];
};

/** The choices the filter controls offer: only values that occur in offers visible today. */
export async function offerFacets(db: PrismaClient, today: IsoDate): Promise<OfferFacets> {
  const visible = visibleToday(today);
  const [retailers, categories, brands] = await Promise.all([
    db.retailer.findMany({
      where: { active: true, offers: { some: visible } },
      select: { slug: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.category.findMany({
      where: { products: { some: { offers: { some: visible } } } },
      select: { slug: true, nameNl: true, nameEn: true, nameIt: true },
      orderBy: { position: "asc" },
    }),
    db.product.findMany({
      where: { brand: { not: null }, offers: { some: visible } },
      select: { brand: true },
      distinct: ["brand"],
      orderBy: { brand: "asc" },
    }),
  ]);
  return { retailers, categories, brands: brands.map((b) => b.brand!).filter(Boolean) };
}

export type HomeOffers = { endingToday: OfferView[]; thisWeek: OfferView[]; upcoming: OfferView[]; total: number };

/** The home screen's short lists: what ends today, the biggest discounts running, and what is coming. */
export async function homeOffers(db: PrismaClient, today: IsoDate): Promise<HomeOffers> {
  const rows = await db.offer.findMany({ where: visibleToday(today), include: offerInclude });
  const views = rows.map((row) => toView(row, today)).sort(byUrgency);
  const byDiscount = (a: OfferView, b: OfferView) =>
    (b.summary.discountPercent ?? 0) - (a.summary.discountPercent ?? 0) || byUrgency(a, b);
  return {
    endingToday: views.filter((o) => o.summary.state === "ends-today").slice(0, 3),
    thisWeek: views
      .filter((o) => o.summary.state === "running" && o.verified)
      .sort(byDiscount)
      .slice(0, 4),
    upcoming: views.filter((o) => o.summary.state === "upcoming").slice(0, 2),
    total: views.length,
  };
}
