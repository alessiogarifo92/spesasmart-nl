import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { isDemoOfferListed } from "@/ingestion/adapters/mock/catalogue";
import { dedupeKeyHash } from "@/ingestion/hash";
import { isValidDemoEan } from "./support";
import { DEMO_OFFERS, DEMO_PRODUCTS } from "../../prisma/seed/demo";
import { DEMO_SOURCE_URL, seedDatabase } from "../../prisma/seed/index";

const today = "2026-11-11";
const now = new Date("2026-11-11T08:00:00Z");
const MOCK_ADAPTER_IDS = ["mock:ah", "mock:jumbo", "mock:vomar", "mock:dirk"];
/** Catalogue offers the mock adapters emit: all but the one that already ended. */
const LISTED_OFFERS = DEMO_OFFERS.filter(isDemoOfferListed);

async function counts() {
  const [retailers, categories, products, offers, prices] = await Promise.all([
    db.retailer.count(),
    db.category.count(),
    db.product.count({ where: { isDemo: true } }),
    db.offer.count({ where: { isDemo: true } }),
    db.priceHistory.count({ where: { isDemo: true } }),
  ]);
  return { retailers, categories, products, offers, prices };
}

describe("seed", () => {
  let first: Awaited<ReturnType<typeof seedDatabase>>;
  beforeAll(async () => {
    first = await seedDatabase(db, { today, now });
  });
  afterAll(() => db.$disconnect());

  it("creates the four chains with their real adapters switched off", async () => {
    const retailers = await db.retailer.findMany({ orderBy: { slug: "asc" } });
    expect(retailers.map((r) => r.slug)).toEqual(["ah", "dirk", "jumbo", "vomar"]);
    expect(retailers.every((r) => r.active && !r.adapterEnabled && r.country === "NL")).toBe(true);
  });

  it("creates categories named in the three launch languages", async () => {
    const categories = await db.category.findMany();
    expect(categories).toHaveLength(12);
    expect(categories.every((c) => c.nameNl && c.nameEn && c.nameIt)).toBe(true);
  });

  it("marks every seeded product, offer and price as demo data", async () => {
    const expectedProducts = DEMO_PRODUCTS.reduce((n, p) => n + Object.keys(p.variants).length, 0);
    expect(await counts()).toEqual({
      retailers: 4,
      categories: 12,
      products: expectedProducts,
      offers: LISTED_OFFERS.length,
      prices: expectedProducts,
    });
    expect(LISTED_OFFERS).toHaveLength(17);
    expect(first).toEqual({ retailers: 4, categories: 12, products: expectedProducts, offers: LISTED_OFFERS.length });
    expect(await db.product.count({ where: { externalId: { startsWith: "demo-" }, isDemo: false } })).toBe(0);
    expect(await db.offer.count({ where: { sourceUrl: DEMO_SOURCE_URL, isDemo: false } })).toBe(0);
  });

  it("is idempotent, also when run on a later day", async () => {
    const before = await counts();
    await seedDatabase(db, { today, now });
    await seedDatabase(db, { today: "2026-11-12", now: new Date("2026-11-12T08:00:00Z") });
    expect(await counts()).toEqual(before);
    await seedDatabase(db, { today, now });
  });

  it("stores validity as inclusive calendar dates counted from the seed day", async () => {
    const kipfilet = await db.offer.findFirstOrThrow({
      where: { isDemo: true, title: "Kipfilet 500 g", retailer: { slug: "dirk" } },
    });
    expect(kipfilet.validFrom?.toISOString()).toBe("2026-11-09T00:00:00.000Z");
    expect(kipfilet.validUntil?.toISOString()).toBe("2026-11-15T00:00:00.000Z");
    expect(kipfilet).toMatchObject({
      currentPriceCents: 349,
      regularPriceCents: 499,
      pricePerUnitCents: 698,
      status: "VERIFIED",
      promoType: "PRICE_CUT",
    });
  });

  it("produces the demo offers through the ingestion pipeline, leaving no run open", async () => {
    const runs = await db.ingestionRun.findMany({ where: { adapter: { in: MOCK_ADAPTER_IDS }, startedAt: now } });
    expect(runs.length).toBeGreaterThanOrEqual(4);
    expect(runs.every((run) => run.status === "SUCCESS" && run.finishedAt !== null)).toBe(true);
    expect(await db.ingestionRun.count({ where: { adapter: { in: MOCK_ADAPTER_IDS }, status: "RUNNING" } })).toBe(0);

    const kipfilet = await db.offer.findFirstOrThrow({
      where: { isDemo: true, title: "Kipfilet 500 g", retailer: { slug: "dirk" } },
    });
    expect(kipfilet.contentHash).toBe(dedupeKeyHash("dirk", "dirk-kipfilet"));
    expect(kipfilet.rawPayload).toMatchObject({ price: "349", regularPrice: "499", validity: "ma 9 t/m zo 15 nov" });
    expect(kipfilet.confidence).toBe(1);
  });

  it("replaces offers the earlier seed wrote under its own content hash", async () => {
    const legacyHash = (key: string) => createHash("sha256").update(`demo:${key}`).digest("hex");
    const dirk = await db.retailer.findUniqueOrThrow({ where: { slug: "dirk" } });
    const ah = await db.retailer.findUniqueOrThrow({ where: { slug: "ah" } });
    const product = await db.product.findFirstOrThrow({ where: { retailerId: dirk.id, externalId: "demo-kipfilet-500g" } });
    const appels = await db.product.findFirstOrThrow({ where: { retailerId: ah.id, externalId: "demo-elstar-appels-1kg" } });
    const legacy = { title: "Legacy", sourceUrl: DEMO_SOURCE_URL, collectedAt: now, isDemo: true };
    // Once for an offer the adapters now produce, once for the expired one they never emit.
    await db.offer.createMany({
      data: [
        { ...legacy, productId: product.id, retailerId: dirk.id, contentHash: legacyHash("dirk-kipfilet") },
        { ...legacy, productId: appels.id, retailerId: ah.id, contentHash: legacyHash("ah-appels-verlopen") },
      ],
      skipDuplicates: true,
    });

    await seedDatabase(db, { today, now });
    expect(await db.offer.count({ where: { title: "Legacy", isDemo: true } })).toBe(0);
    expect((await counts()).offers).toBe(LISTED_OFFERS.length);
  });

  it("keeps an offer with unknown validity unverified", async () => {
    const unknown = await db.offer.findMany({ where: { isDemo: true, validUntil: null } });
    expect(unknown.length).toBeGreaterThan(0);
    expect(unknown.every((offer) => offer.status === "UNVERIFIED")).toBe(true);
  });

  it("covers running, ending-today and upcoming offers, and none already expired", async () => {
    const day = new Date("2026-11-11T00:00:00.000Z");
    const where = { isDemo: true } as const;
    expect(await db.offer.count({ where: { ...where, validFrom: { lte: day }, validUntil: { gte: day } } })).toBeGreaterThan(5);
    expect(await db.offer.count({ where: { ...where, validUntil: day, kind: "DAILY" } })).toBe(1);
    expect(await db.offer.count({ where: { ...where, validFrom: { gt: day } } })).toBeGreaterThan(0);
    // Validation rejects an expired offer, so the expired catalogue offer produces no row.
    expect(await db.offer.count({ where: { ...where, validUntil: { lt: day } } })).toBe(0);
  });

  it("gives branded demo products the same in-store barcode across chains", async () => {
    const coffee = await db.product.findMany({ where: { brand: "Molenhof" } });
    expect(coffee).toHaveLength(3);
    expect(new Set(coffee.map((p) => p.ean)).size).toBe(1);
    expect(isValidDemoEan(coffee[0].ean!)).toBe(true);
  });

  it("can seed reference data alone", async () => {
    const result = await seedDatabase(db, { today, now, withDemo: false });
    expect(result).toEqual({ retailers: 4, categories: 12, products: 0, offers: 0 });
  });

  it("finds a product by a misspelt name through the trigram index", async () => {
    const rows = await db.$queryRaw<{ name: string }[]>`
      SELECT name FROM products
      WHERE "normalizedName" % 'spagetti' AND "isDemo"
      ORDER BY similarity("normalizedName", 'spagetti') DESC LIMIT 1`;
    expect(rows[0]?.name).toMatch(/spaghetti/i);
  });
});
