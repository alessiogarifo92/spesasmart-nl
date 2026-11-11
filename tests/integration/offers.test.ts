import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NO_FILTERS, type OfferFilters } from "@/domain/offers";
import { db } from "@/lib/db";
import { homeOffers, listOffers, offerFacets } from "@/server/offers";
import { createScratchRetailer } from "./support";

const today = "2026-11-11";
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

let retailer: Awaited<ReturnType<typeof createScratchRetailer>>;
let slug: string;
let categoryId: string;
const categorySlug = `test-offers-${Date.now()}`;

/** Filters limited to the scratch retailer, so seeded rows never affect a count. */
const scoped = (filters: Partial<OfferFilters> = {}): OfferFilters => ({ ...NO_FILTERS, retailers: [slug], ...filters });
const names = async (filters: Partial<OfferFilters> = {}) =>
  (await listOffers(db, { today, filters: scoped(filters) })).offers.map((offer) => offer.name);

async function addOffer(
  name: string,
  offer: { from: string | null; until: string | null; status?: "VERIFIED" | "UNVERIFIED" | "REJECTED"; current?: number; regular?: number },
  product: { brand?: string; isOrganic?: boolean; inCategory?: boolean } = {},
) {
  const created = await db.product.create({
    data: {
      retailerId: retailer.id,
      externalId: name,
      name,
      normalizedName: name.toLowerCase(),
      brand: product.brand,
      isOrganic: product.isOrganic ?? false,
      categoryId: product.inCategory ? categoryId : null,
      unit: "G",
      packageAmount: 500,
    },
  });
  await db.offer.create({
    data: {
      productId: created.id,
      retailerId: retailer.id,
      title: name,
      currentPriceCents: offer.current ?? 100,
      regularPriceCents: offer.regular ?? 200,
      pricePerUnitCents: (offer.current ?? 100) * 2,
      validFrom: offer.from ? day(offer.from) : null,
      validUntil: offer.until ? day(offer.until) : null,
      status: offer.status ?? (offer.until ? "VERIFIED" : "UNVERIFIED"),
      confidence: 1,
      sourceUrl: "https://example.test/offers",
      collectedAt: new Date("2026-11-11T08:00:00Z"),
      contentHash: name,
    },
  });
}

describe("offer queries", () => {
  beforeAll(async () => {
    retailer = await createScratchRetailer("offers");
    slug = (await db.retailer.findUniqueOrThrow({ where: { id: retailer.id } })).slug;
    categoryId = (
      await db.category.create({ data: { slug: categorySlug, nameNl: "Test", nameEn: "Test", nameIt: "Test" } })
    ).id;

    await addOffer("ends-today", { from: "2026-11-11", until: "2026-11-11", current: 150 });
    await addOffer("ends-tomorrow", { from: "2026-11-09", until: "2026-11-12", current: 100 }, { isOrganic: true });
    await addOffer("ends-in-4", { from: "2026-11-09", until: "2026-11-15", current: 50 }, { brand: "Testmerk", inCategory: true });
    await addOffer("no-start", { from: null, until: "2026-11-13" });
    await addOffer("upcoming", { from: "2026-11-16", until: "2026-11-22" });
    await addOffer("unknown", { from: null, until: null });
    await addOffer("expired", { from: "2026-11-03", until: "2026-11-10" });
    await addOffer("rejected", { from: "2026-11-09", until: "2026-11-15", status: "REJECTED" });
  });

  afterAll(async () => {
    await retailer.remove();
    await db.category.delete({ where: { id: categoryId } });
    await db.$disconnect();
  });

  it("lists what may be shown today, soonest to end first, never expired or rejected offers", async () => {
    expect(await names()).toEqual(["ends-today", "ends-tomorrow", "no-start", "ends-in-4", "unknown", "upcoming"]);
  });

  it("keeps the last valid day and drops the day after", async () => {
    const tomorrow = await listOffers(db, { today: "2026-11-12", filters: scoped() });
    expect(tomorrow.offers.map((o) => o.name)).not.toContain("ends-today");
    expect(tomorrow.offers.map((o) => o.name)).toContain("ends-tomorrow");
  });

  it("filters by days left: running offers only", async () => {
    expect(await names({ within: 1 })).toEqual(["ends-today", "ends-tomorrow"]);
    expect(await names({ within: 3 })).toEqual(["ends-today", "ends-tomorrow", "no-start"]);
    expect(await names({ within: 7 })).toEqual(["ends-today", "ends-tomorrow", "no-start", "ends-in-4"]);
  });

  it("filters upcoming, organic, brand and category", async () => {
    expect(await names({ upcoming: true })).toEqual(["upcoming"]);
    expect(await names({ organic: true })).toEqual(["ends-tomorrow"]);
    expect(await names({ brand: "Testmerk" })).toEqual(["ends-in-4"]);
    expect(await names({ category: categorySlug })).toEqual(["ends-in-4"]);
    expect(await names({ category: categorySlug, organic: true })).toEqual([]);
  });

  it("marks unknown validity as not verified and derives the estimates", async () => {
    const { offers } = await listOffers(db, { today, filters: scoped() });
    const unknown = offers.find((o) => o.name === "unknown")!;
    expect(unknown).toMatchObject({ verified: false, validUntil: null, summary: { state: "unknown-validity" } });
    const cheap = offers.find((o) => o.name === "ends-in-4")!;
    expect(cheap).toMatchObject({
      verified: true,
      validFrom: "2026-11-09",
      validUntil: "2026-11-15",
      unitPrice: { cents: 100, basis: "kg" },
      sourceUrl: "https://example.test/offers",
      summary: { state: "running", daysLeft: 4, shownPriceCents: 50, discountPercent: 75 },
    });
  });

  it("reports the total and honours the limit", async () => {
    const page = await listOffers(db, { today, filters: scoped(), limit: 2 });
    expect(page.total).toBe(6);
    expect(page.offers.map((o) => o.name)).toEqual(["ends-today", "ends-tomorrow"]);
  });

  it("hides an inactive retailer's offers", async () => {
    await db.retailer.update({ where: { id: retailer.id }, data: { active: false } });
    try {
      expect(await names()).toEqual([]);
    } finally {
      await db.retailer.update({ where: { id: retailer.id }, data: { active: true } });
    }
  });

  it("offers only facet values that have visible offers", async () => {
    const facets = await offerFacets(db, today);
    expect(facets.retailers.map((r) => r.slug)).toContain(slug);
    expect(facets.brands).toContain("Testmerk");
    expect(facets.categories.map((c) => c.slug)).toContain(categorySlug);
    const later = await offerFacets(db, "2026-12-01");
    expect(later.brands).not.toContain("Testmerk");
  });

  it("builds the home lists from verified, visible offers", async () => {
    const home = await homeOffers(db, today);
    const all = [...home.endingToday, ...home.thisWeek, ...home.upcoming];
    expect(all.every((o) => o.summary.state !== "expired")).toBe(true);
    expect(home.thisWeek.every((o) => o.verified && o.summary.state === "running")).toBe(true);
    expect(home.endingToday.every((o) => o.summary.state === "ends-today")).toBe(true);
    expect(home.upcoming.every((o) => o.summary.state === "upcoming")).toBe(true);
    const discounts = home.thisWeek.map((o) => o.summary.discountPercent ?? 0);
    expect(discounts).toEqual([...discounts].sort((a, b) => b - a));
  });
});
