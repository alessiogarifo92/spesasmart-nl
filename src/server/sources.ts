import type { PrismaClient } from "@/generated/prisma/client";
import { amsterdamToday, isoToDbDate } from "@/lib/dates";

/** What a chain's offers in the app are made of right now. */
export type SourceKind = "real" | "demo" | "mixed" | "none";

export type ChainSource = {
  slug: string;
  name: string;
  kind: SourceKind;
  /** When the newest offer collected from the chain's own page was read; null without one. */
  lastCollectedAt: Date | null;
};

export function sourceKind(realOffers: number, demoOffers: number): SourceKind {
  if (realOffers > 0) return demoOffers > 0 ? "mixed" : "real";
  return demoOffers > 0 ? "demo" : "none";
}

/**
 * Per active chain: whether the offers shown come from its public page, from
 * labelled demo data, or both. Offers that have ended are not counted, so a chain
 * whose adapter was switched off falls back to "demo" or "none" by itself.
 */
export async function chainSources(db: PrismaClient, now: Date): Promise<ChainSource[]> {
  const today = isoToDbDate(amsterdamToday(now));
  const [retailers, groups] = await Promise.all([
    db.retailer.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, slug: true, name: true },
    }),
    db.offer.groupBy({
      by: ["retailerId", "isDemo"],
      where: { OR: [{ validUntil: null }, { validUntil: { gte: today } }] },
      _count: { _all: true },
      _max: { collectedAt: true },
    }),
  ]);
  return retailers.map((retailer) => {
    const of = (isDemo: boolean) => groups.find((g) => g.retailerId === retailer.id && g.isDemo === isDemo);
    const real = of(false);
    return {
      slug: retailer.slug,
      name: retailer.name,
      kind: sourceKind(real?._count._all ?? 0, of(true)?._count._all ?? 0),
      lastCollectedAt: real?._max.collectedAt ?? null,
    };
  });
}
