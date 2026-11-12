import type { PrismaClient } from "@/generated/prisma/client";

export type AdminRun = {
  id: string;
  adapter: string;
  retailerName: string | null;
  status: "RUNNING" | "SUCCESS" | "PARTIAL" | "FAILED" | "SKIPPED";
  startedAt: Date;
  finishedAt: Date | null;
  itemsFound: number;
  itemsUpdated: number;
  /** First messages of the run's error list. */
  errors: string[];
  errorCount: number;
};

export type AdminRetailer = {
  id: string;
  slug: string;
  name: string;
  active: boolean;
  adapterEnabled: boolean;
  /** The chain's adapter id is in INGESTION_ENABLED_ADAPTERS: the other half of the kill switch. */
  listedInEnv: boolean;
  products: number;
};

export type AdminCategory = {
  id: string;
  slug: string;
  nameNl: string;
  nameEn: string;
  nameIt: string;
  products: number;
};

export type AdminFeedback = {
  id: string;
  kind: "WRONG_PRICE" | "OTHER";
  createdAt: Date;
  productId: string | null;
  productName: string | null;
  retailerName: string | null;
};

export type AdminOverview = {
  retailers: AdminRetailer[];
  runs: AdminRun[];
  categories: AdminCategory[];
  feedback: AdminFeedback[];
  reviewCount: number;
};

const RUNS_SHOWN = 20;
const FEEDBACK_SHOWN = 50;
const ERRORS_SHOWN = 3;

/** A link waits for a person when the matcher was unsure, or when a visitor reported it. */
const WAITING = {
  OR: [
    { status: "NEEDS_REVIEW" as const },
    { status: { not: "REJECTED" as const }, feedback: { some: { kind: "WRONG_MATCH" as const, resolvedAt: null } } },
  ],
};

function errorMessages(errors: unknown): string[] {
  if (!Array.isArray(errors)) return [];
  return errors.map((entry) =>
    typeof entry === "object" && entry !== null && typeof (entry as { message?: unknown }).message === "string"
      ? (entry as { message: string }).message
      : String(entry),
  );
}

export async function adminOverview(db: PrismaClient, enabledAdapters: string[]): Promise<AdminOverview> {
  const [retailers, runs, categories, feedback, reviewCount] = await Promise.all([
    db.retailer.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        slug: true,
        name: true,
        active: true,
        adapterEnabled: true,
        _count: { select: { products: true } },
      },
    }),
    db.ingestionRun.findMany({
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      take: RUNS_SHOWN,
      include: { retailer: { select: { name: true } } },
    }),
    db.category.findMany({
      orderBy: [{ position: "asc" }, { slug: "asc" }],
      select: {
        id: true,
        slug: true,
        nameNl: true,
        nameEn: true,
        nameIt: true,
        _count: { select: { products: true } },
      },
    }),
    db.feedback.findMany({
      where: { resolvedAt: null, kind: { not: "WRONG_MATCH" } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: FEEDBACK_SHOWN,
      select: {
        id: true,
        kind: true,
        createdAt: true,
        product: { select: { id: true, name: true, retailer: { select: { name: true } } } },
      },
    }),
    db.productMatch.count({ where: WAITING }),
  ]);

  return {
    retailers: retailers.map(({ _count, ...retailer }) => ({
      ...retailer,
      listedInEnv: enabledAdapters.includes(retailer.slug.toLowerCase()),
      products: _count.products,
    })),
    runs: runs.map((run) => {
      const messages = errorMessages(run.errors);
      return {
        id: run.id,
        adapter: run.adapter,
        retailerName: run.retailer?.name ?? null,
        status: run.status,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        itemsFound: run.itemsFound,
        itemsUpdated: run.itemsUpdated,
        errors: messages.slice(0, ERRORS_SHOWN),
        errorCount: messages.length,
      };
    }),
    categories: categories.map(({ _count, ...category }) => ({ ...category, products: _count.products })),
    feedback: feedback.map((entry) => ({
      id: entry.id,
      kind: entry.kind as "WRONG_PRICE" | "OTHER",
      createdAt: entry.createdAt,
      productId: entry.product?.id ?? null,
      productName: entry.product?.name ?? null,
      retailerName: entry.product?.retailer?.name ?? null,
    })),
    reviewCount,
  };
}

export type RetailerSwitch = "active" | "adapterEnabled";

/** Flips one switch of a chain. The ingestion runner reads `adapterEnabled` when a run starts. */
export async function setRetailerSwitch(
  db: PrismaClient,
  input: { retailerId: string; field: RetailerSwitch; value: boolean },
): Promise<boolean> {
  const { count } = await db.retailer.updateMany({
    where: { id: input.retailerId },
    data: input.field === "active" ? { active: input.value } : { adapterEnabled: input.value },
  });
  return count === 1;
}

export type ReviewSide = {
  id: string;
  name: string;
  brand: string | null;
  retailerName: string | null;
  unit: "G" | "ML" | "PIECE" | null;
  packageAmount: number | null;
  packageCount: number;
  priceCents: number | null;
};

export type ReviewItem = {
  id: string;
  matchType: "SAME" | "SIMILAR" | "ALTERNATIVE";
  status: "AUTO" | "NEEDS_REVIEW" | "CONFIRMED" | "REJECTED";
  confidence: number;
  /** A visitor said these two are not the same product. */
  reported: boolean;
  left: ReviewSide;
  right: ReviewSide;
};

export const REVIEW_PAGE_SIZE = 20;

const side = {
  id: true,
  name: true,
  brand: true,
  unit: true,
  packageAmount: true,
  packageCount: true,
  retailer: { select: { name: true } },
  priceHistory: { orderBy: { recordedAt: "desc" as const }, take: 1, select: { priceCents: true } },
};

type SideRow = {
  id: string;
  name: string;
  brand: string | null;
  unit: "G" | "ML" | "PIECE" | null;
  packageAmount: number | null;
  packageCount: number;
  retailer: { name: string } | null;
  priceHistory: { priceCents: number }[];
};

const toSide = (row: SideRow): ReviewSide => ({
  id: row.id,
  name: row.name,
  brand: row.brand,
  retailerName: row.retailer?.name ?? null,
  unit: row.unit,
  packageAmount: row.packageAmount,
  packageCount: row.packageCount,
  priceCents: row.priceHistory[0]?.priceCents ?? null,
});

/** Links waiting for a decision, reported ones included, the most likely matches first. */
export async function reviewQueue(db: PrismaClient, page = 1): Promise<{ items: ReviewItem[]; total: number }> {
  const [rows, total] = await Promise.all([
    db.productMatch.findMany({
      where: WAITING,
      orderBy: [{ confidence: "desc" }, { id: "asc" }],
      skip: (Math.max(1, page) - 1) * REVIEW_PAGE_SIZE,
      take: REVIEW_PAGE_SIZE,
      select: {
        id: true,
        matchType: true,
        status: true,
        confidence: true,
        canonicalProduct: { select: side },
        candidateProduct: { select: side },
        _count: { select: { feedback: { where: { kind: "WRONG_MATCH", resolvedAt: null } } } },
      },
    }),
    db.productMatch.count({ where: WAITING }),
  ]);
  return {
    total,
    items: rows.map((row) => ({
      id: row.id,
      matchType: row.matchType,
      status: row.status,
      confidence: row.confidence,
      reported: row._count.feedback > 0,
      left: toSide(row.canonicalProduct),
      right: toSide(row.candidateProduct),
    })),
  };
}

export const MATCH_DECISIONS = ["SAME", "SIMILAR", "ALTERNATIVE", "REJECT"] as const;
export type MatchDecision = (typeof MATCH_DECISIONS)[number];

/**
 * A person's verdict on a link. It becomes CONFIRMED with the chosen type, or
 * REJECTED; either way the matcher never touches it again, and open "wrong match"
 * reports on it are closed.
 */
export async function decideMatch(
  db: PrismaClient,
  input: { matchId: string; decision: MatchDecision; now: Date },
): Promise<boolean> {
  const { matchId, decision, now } = input;
  return db.$transaction(async (tx) => {
    const { count } = await tx.productMatch.updateMany({
      where: { id: matchId },
      data: decision === "REJECT" ? { status: "REJECTED" } : { status: "CONFIRMED", matchType: decision },
    });
    if (count === 0) return false;
    await tx.feedback.updateMany({
      where: { productMatchId: matchId, kind: "WRONG_MATCH", resolvedAt: null },
      data: { resolvedAt: now },
    });
    return true;
  });
}

export async function resolveFeedback(db: PrismaClient, input: { feedbackId: string; now: Date }): Promise<boolean> {
  const { count } = await db.feedback.updateMany({
    where: { id: input.feedbackId, resolvedAt: null },
    data: { resolvedAt: input.now },
  });
  return count === 1;
}

export async function renameCategory(
  db: PrismaClient,
  input: { categoryId: string; nameNl: string; nameEn: string; nameIt: string },
): Promise<boolean> {
  const { categoryId, ...names } = input;
  const { count } = await db.category.updateMany({ where: { id: categoryId }, data: names });
  return count === 1;
}
