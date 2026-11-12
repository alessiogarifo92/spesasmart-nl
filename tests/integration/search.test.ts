import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalizeName, parseQuery, type SearchContext } from "@/domain/search";
import { db } from "@/lib/db";
import { loadProducts } from "@/server/catalog";
import { searchContext, searchProducts } from "@/server/search";
import { createScratchRetailer } from "./support";

const today = "2026-11-11";
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

let shopA: Awaited<ReturnType<typeof createScratchRetailer>>;
let shopB: Awaited<ReturnType<typeof createScratchRetailer>>;
let slugs: string[];
let categoryId: string;
const categorySlug = `test-search-${Date.now()}`;
const brand = `Zoekmerk${Date.now()}`;
const ean = "2099999999998";
let context: SearchContext;

type ProductInput = {
  retailerId: string;
  name: string;
  unit?: "G" | "ML" | "PIECE";
  amount?: number;
  count?: number;
  regular?: number;
  brand?: string;
  ean?: string;
  organic?: boolean;
  attributes?: Record<string, boolean>;
  inCategory?: boolean;
};

async function addProduct(input: ProductInput): Promise<string> {
  const product = await db.product.create({
    data: {
      retailerId: input.retailerId,
      externalId: input.name,
      name: input.name,
      normalizedName: normalizeName(input.name),
      brand: input.brand,
      ean: input.ean,
      isOrganic: input.organic ?? false,
      attributes: input.attributes ?? {},
      categoryId: input.inCategory ? categoryId : null,
      unit: input.unit ?? null,
      packageAmount: input.amount ?? null,
      packageCount: input.count ?? 1,
    },
  });
  if (input.regular !== undefined) {
    await db.priceHistory.create({
      data: { productId: product.id, retailerId: input.retailerId, priceCents: input.regular, sourceUrl: "https://example.test/prices" },
    });
  }
  return product.id;
}

async function addOffer(
  productId: string,
  retailerId: string,
  offer: { current: number | null; from: string | null; until: string | null; status?: "VERIFIED" | "UNVERIFIED" | "REJECTED" },
) {
  await db.offer.create({
    data: {
      productId,
      retailerId,
      title: "offer",
      currentPriceCents: offer.current,
      validFrom: offer.from ? day(offer.from) : null,
      validUntil: offer.until ? day(offer.until) : null,
      status: offer.status ?? (offer.until ? "VERIFIED" : "UNVERIFIED"),
      confidence: 1,
      sourceUrl: "https://example.test/offers",
      collectedAt: new Date("2026-11-11T08:00:00Z"),
      contentHash: `${productId}-${offer.from}-${offer.until}-${offer.status}`,
    },
  });
}

/** Searches the two scratch chains only, so seeded rows never change a result. */
async function search(text: string) {
  return searchProducts(db, { query: parseQuery(text, context), today, retailers: slugs });
}
const names = async (text: string) => (await search(text)).hits.map((hit) => hit.product.name);

describe("product search", () => {
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    shopA = await createScratchRetailer("search-a");
    shopB = await createScratchRetailer("search-b");
    const rows = await db.retailer.findMany({ where: { id: { in: [shopA.id, shopB.id] } }, select: { slug: true } });
    slugs = rows.map((row) => row.slug);
    categoryId = (
      await db.category.create({ data: { slug: categorySlug, nameNl: "Testzoekschap", nameEn: "Test search shelf", nameIt: "Scaffale di prova" } })
    ).id;

    ids.spaghettiA = await addProduct({ retailerId: shopA.id, name: "Spaghetti 500 g", unit: "G", amount: 500, regular: 109, inCategory: true });
    ids.spaghettiB = await addProduct({ retailerId: shopB.id, name: "Spaghetti pasta 1 kg", unit: "G", amount: 1000, regular: 179 });
    ids.melkA = await addProduct({ retailerId: shopA.id, name: "Halfvolle melk 1 L", unit: "ML", amount: 1000, regular: 119 });
    ids.melkB = await addProduct({ retailerId: shopB.id, name: "Melk halfvol 1 liter", unit: "ML", amount: 1000, regular: 115 });
    ids.melkGroot = await addProduct({ retailerId: shopB.id, name: "Halfvolle melk 2 L", unit: "ML", amount: 2000, regular: 199 });
    ids.kipA = await addProduct({ retailerId: shopA.id, name: "Kipfilet 500 g", unit: "G", amount: 500, regular: 549 });
    ids.kipB = await addProduct({ retailerId: shopB.id, name: "Kipfilet 500 gram", unit: "G", amount: 500, regular: 499 });
    ids.kibbeling = await addProduct({ retailerId: shopA.id, name: "Kibbeling 300 g", unit: "G", amount: 300, regular: 450 });
    ids.koffie = await addProduct({ retailerId: shopA.id, name: `${brand} koffiebonen 1 kg`, unit: "G", amount: 1000, regular: 1299, brand, ean });
    ids.havermout = await addProduct({ retailerId: shopA.id, name: "Havermout 500 g", unit: "G", amount: 500, regular: 99 });
    ids.havermoutBio = await addProduct({ retailerId: shopB.id, name: "Havermout 500 gram", unit: "G", amount: 500, regular: 145, organic: true, attributes: { glutenFree: true } });
    ids.appels = await addProduct({ retailerId: shopA.id, name: "Elstar appels 1 kg", unit: "G", amount: 1000, regular: 249 });
    ids.cola = await addProduct({ retailerId: shopA.id, name: "Cola 6 x 330 ml", unit: "ML", amount: 330, count: 6, regular: 399 });
    ids.zonderPrijs = await addProduct({ retailerId: shopB.id, name: "Kipfilet naturel" });

    // Kipfilet at shop A: running verified offer at 349. At shop B: only an unverified offer at 100.
    await addOffer(ids.kipA, shopA.id, { current: 349, from: "2026-11-09", until: "2026-11-15" });
    await addOffer(ids.kipB, shopB.id, { current: 100, from: null, until: null });
    // Offers that must not change today's price: expired, rejected and upcoming.
    await addOffer(ids.melkA, shopA.id, { current: 50, from: "2026-11-01", until: "2026-11-10" });
    await addOffer(ids.melkA, shopA.id, { current: 40, from: "2026-11-09", until: "2026-11-15", status: "REJECTED" });
    await addOffer(ids.melkB, shopB.id, { current: 60, from: "2026-11-12", until: "2026-11-18" });

    context = await searchContext(db);
  });

  afterAll(async () => {
    await shopA.remove();
    await shopB.remove();
    await db.category.delete({ where: { id: categoryId } });
  });

  it("finds a product despite a typo", async () => {
    expect(await names("spagetti")).toEqual(["Spaghetti 500 g", "Spaghetti pasta 1 kg"]);
    expect(await names("kipfile")).toContain("Kipfilet 500 g");
    expect(await names("havermuot")).toContain("Havermout 500 g");
  });

  it("does not match unrelated words that share a few letters", async () => {
    expect(await names("kip")).not.toContain("Kibbeling 300 g");
    expect(await names("cola")).toEqual(["Cola 6 x 330 ml"]);
    expect(await names("xyzzy")).toEqual([]);
  });

  it("requires every word, in any order", async () => {
    expect((await names("halfvolle melk")).sort()).toEqual(["Halfvolle melk 1 L", "Halfvolle melk 2 L", "Melk halfvol 1 liter"]);
    expect(await names("melk spaghetti")).toEqual([]);
  });

  it("matches Dutch word forms", async () => {
    expect(await names("appel")).toEqual(["Elstar appels 1 kg"]);
  });

  it("understands Italian and English words", async () => {
    expect(await names("petto di pollo")).toContain("Kipfilet 500 g");
    expect(await names("apples")).toEqual(["Elstar appels 1 kg"]);
  });

  it("puts the asked size first and compares only that size", async () => {
    const { hits, sizeFound } = await search("halfvolle melk 1 liter");
    expect(sizeFound).toBe(true);
    expect(hits.map((hit) => [hit.product.name, hit.sizeMatch, hit.lowestPrice])).toEqual([
      ["Melk halfvol 1 liter", true, true],
      ["Halfvolle melk 1 L", true, false],
      ["Halfvolle melk 2 L", false, false],
    ]);
  });

  it("matches a multipack by its total", async () => {
    const { hits } = await search("cola 6 x 330 ml");
    expect(hits.map((hit) => [hit.product.name, hit.sizeMatch])).toEqual([["Cola 6 x 330 ml", true]]);
    expect((await search("cola 1,5 l")).sizeFound).toBe(false);
  });

  it("finds a product by barcode on its own", async () => {
    expect(await names(ean)).toEqual([`${brand} koffiebonen 1 kg`]);
    // A valid barcode nobody sells, and a number with a wrong check digit.
    expect(await names("2099999999981")).toEqual([]);
    expect(await names("2099999999983")).toEqual([]);
  });

  it("filters on a recognised brand and category", async () => {
    expect(await names(brand.toLowerCase())).toEqual([`${brand} koffiebonen 1 kg`]);
    expect(await names(`${brand} spaghetti`)).toEqual([]);
    expect(await names("testzoekschap spaghetti")).toEqual(["Spaghetti 500 g"]);
    expect(await names("scaffale di prova spaghetti")).toEqual(["Spaghetti 500 g"]);
  });

  it("filters on organic and on dietary attributes", async () => {
    expect(await names("havermout")).toHaveLength(2);
    expect(await names("biologische havermout")).toEqual(["Havermout 500 gram"]);
    expect(await names("havermout glutenvrij")).toEqual(["Havermout 500 gram"]);
    expect(await names("havermout vegan")).toEqual([]);
  });

  it("uses a running verified offer for the price and marks the best", async () => {
    const { hits } = await search("kipfilet 500 gram");
    const byName = new Map(hits.map((hit) => [hit.product.name, hit]));
    const a = byName.get("Kipfilet 500 g")!;
    expect(a.product.price).toMatchObject({ totalCents: 349, usedOffer: true, regularTotalCents: 549, unitPrice: { cents: 698, basis: "kg" } });
    expect(a.lowestPrice).toBe(true);
    expect(a.bestUnitPrice).toBe(true);
  });

  it("never lowers a price with an unverified offer, and still shows that offer", async () => {
    const { hits } = await search("kipfilet 500 gram");
    const b = hits.find((hit) => hit.product.name === "Kipfilet 500 gram")!;
    expect(b.product.price).toMatchObject({ totalCents: 499, usedOffer: false });
    expect(b.product.offer).toMatchObject({ verified: false, offerPriceCents: 100 });
    expect(b.lowestPrice).toBe(false);
  });

  it("ignores expired, rejected and upcoming offers for today's price", async () => {
    const products = await loadProducts(db, [ids.melkA, ids.melkB], today);
    expect(products.get(ids.melkA)).toMatchObject({ offer: null, price: { totalCents: 119, usedOffer: false } });
    expect(products.get(ids.melkB)).toMatchObject({ offer: null, price: { totalCents: 115, usedOffer: false } });
  });

  it("keeps a product without a known price, unpriced and unmarked", async () => {
    const hit = (await search("kipfilet")).hits.find((h) => h.product.name === "Kipfilet naturel")!;
    expect(hit.product.price).toBeNull();
    expect(hit.product.quantity).toBeNull();
    expect(hit.lowestPrice).toBe(false);
    // An unknown price sorts last, it is not treated as free.
    expect((await names("kipfilet")).at(-1)).toBe("Kipfilet naturel");
  });

  it("lists the cheapest first among equally clear matches", async () => {
    expect(await names("kipfilet 500 gram")).toEqual(["Kipfilet 500 g", "Kipfilet 500 gram", "Kipfilet naturel"]);
    expect(await names("havermout")).toEqual(["Havermout 500 g", "Havermout 500 gram"]);
  });

  it("sorts by price when asked for cheap", async () => {
    expect(await names("goedkope havermout")).toEqual(["Havermout 500 g", "Havermout 500 gram"]);
    expect(await names("kipfilet goedkoop")).toEqual(["Kipfilet 500 g", "Kipfilet 500 gram", "Kipfilet naturel"]);
  });

  it("returns nothing for an empty query instead of the whole catalogue", async () => {
    expect(await search("")).toEqual({ hits: [], total: 0, sizeFound: false });
    expect(await searchProducts(db, { query: parseQuery("de het", context), today })).toEqual({ hits: [], total: 0, sizeFound: false });
  });

  it("is not thrown by quotes or wildcards in the query", async () => {
    expect(await names("'; DROP TABLE products;--")).toEqual([]);
    expect(await names("100%")).toEqual([]);
    expect(await names("_")).toEqual([]);
  });

  it("leaves out products of a chain that was switched off", async () => {
    await db.retailer.update({ where: { id: shopB.id }, data: { active: false } });
    try {
      expect(await names("spagetti")).toEqual(["Spaghetti 500 g"]);
    } finally {
      await db.retailer.update({ where: { id: shopB.id }, data: { active: true } });
    }
  });

  it("limits the page and reports the total", async () => {
    const result = await searchProducts(db, { query: parseQuery("kipfilet", context), today, retailers: slugs, limit: 2 });
    expect(result.hits).toHaveLength(2);
    expect(result.total).toBe(3);
  });

  it("reads brands and category names in three languages for the parser", () => {
    expect(context.brands).toContain(brand);
    expect(context.categories).toContainEqual({ slug: categorySlug, names: ["Testzoekschap", "Test search shelf", "Scaffale di prova"] });
  });
});
