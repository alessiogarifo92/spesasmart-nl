import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rebuildMatches } from "@/ingestion/match-products";
import { db } from "@/lib/db";
import { compareProduct } from "@/server/comparison";
import { reportWrongMatch, reportWrongPrice } from "@/server/feedback";
import { createScratchRetailer } from "./support";

const TODAY = "2026-11-12";
type Scratch = Awaited<ReturnType<typeof createScratchRetailer>>;

let a: Scratch, b: Scratch, c: Scratch;
let categoryId: string;
let otherCategoryId: string;
const ids: Record<string, string> = {};

type NewProduct = {
  key: string;
  shop: Scratch;
  name: string;
  amount?: number;
  cents?: number;
  brand?: string;
  ean?: string;
  organic?: boolean;
  category?: string;
};

async function add({ key, shop, name, amount = 1000, cents, brand, ean, organic = false, category }: NewProduct) {
  const product = await db.product.create({
    data: {
      retailerId: shop.id,
      externalId: key,
      name,
      normalizedName: name.toLowerCase(),
      brand,
      ean,
      unit: "ML",
      packageAmount: amount,
      isOrganic: organic,
      categoryId: category ?? categoryId,
    },
  });
  if (cents !== undefined) {
    await db.priceHistory.create({
      data: { productId: product.id, retailerId: shop.id, priceCents: cents, recordedAt: new Date() },
    });
  }
  ids[key] = product.id;
}

const scope = () => ({ retailerIds: [a.id, b.id, c.id] });
const linksOf = () =>
  db.productMatch.findMany({
    where: { canonicalProduct: { retailerId: { in: [a.id, b.id, c.id] } } },
    orderBy: [{ canonicalProductId: "asc" }, { candidateProductId: "asc" }],
  });
const link = async (x: string, y: string) => {
  const [low, high] = [ids[x]!, ids[y]!].sort();
  return db.productMatch.findUnique({
    where: { canonicalProductId_candidateProductId: { canonicalProductId: low!, candidateProductId: high! } },
  });
};

describe("product links and price comparison", () => {
  beforeAll(async () => {
    [a, b, c] = await Promise.all([
      createScratchRetailer("match-a"),
      createScratchRetailer("match-b"),
      createScratchRetailer("match-c"),
    ]);
    const suffix = a.slug.slice(-8);
    categoryId = (
      await db.category.create({
        data: { slug: `test-zuivel-${suffix}`, nameNl: "Zuivel", nameEn: "Dairy", nameIt: "Latticini" },
      })
    ).id;
    otherCategoryId = (
      await db.category.create({
        data: { slug: `test-vlees-${suffix}`, nameNl: "Vlees", nameEn: "Meat", nameIt: "Carne" },
      })
    ).id;

    await add({ key: "melkA", shop: a, name: "Halfvolle melk 1 L", cents: 119 });
    await add({ key: "melkB", shop: b, name: "Melk halfvol 1 liter", cents: 99 });
    await add({ key: "melkC", shop: c, name: "Halfvolle melk pak 1 L", cents: 109 });
    await add({ key: "melkGrootB", shop: b, name: "Halfvolle melk 2 L", amount: 2000, cents: 169 });
    // One barcode at two chains.
    await add({
      key: "colaA",
      shop: a,
      name: "Bruisbron cola 1 L",
      brand: "Bruisbron",
      ean: "2000000000015",
      cents: 150,
    });
    await add({
      key: "colaB",
      shop: b,
      name: "Cola Bruisbron fles 1 liter",
      brand: "Bruisbron",
      ean: "2000000000015",
      cents: 140,
    });
    // One word of two in common: a link, but one a person has to look at.
    await add({ key: "karnemelkA", shop: a, name: "Karnemelk vers 1 L" });
    await add({ key: "karnemelkC", shop: c, name: "Karnemelk houdbaar 1 L" });
    // The same name in another category never links.
    await add({ key: "vleesC", shop: c, name: "Halfvolle melk 1 L", category: otherCategoryId });
  });

  afterAll(async () => {
    await db.feedback.deleteMany({ where: { productId: { in: Object.values(ids) } } });
    // One after another: the cascades of three chains share the link rows and would deadlock.
    for (const shop of [a, b, c]) await shop.remove();
    await db.category.deleteMany({ where: { id: { in: [categoryId, otherCategoryId] } } });
  });

  it("stores one row per pair, the lower id first, with the matcher's verdict", async () => {
    const result = await rebuildMatches(db, scope());
    expect(result).toMatchObject({ products: 9, updated: 0, removed: 0, decided: 0 });
    const links = await linksOf();
    expect(result.created).toBe(links.length);
    for (const row of links) expect(row.canonicalProductId < row.candidateProductId).toBe(true);

    expect(await link("colaA", "colaB")).toMatchObject({ matchType: "SAME", confidence: 1, status: "AUTO" });
    expect(await link("melkA", "melkB")).toMatchObject({ matchType: "SIMILAR", status: "AUTO" });
    expect(await link("melkA", "melkC")).toMatchObject({ matchType: "SIMILAR", status: "AUTO" });
    expect(await link("melkA", "melkGrootB")).toMatchObject({ matchType: "ALTERNATIVE", status: "AUTO" });
    expect(await link("karnemelkA", "karnemelkC")).toMatchObject({ matchType: "ALTERNATIVE", status: "NEEDS_REVIEW" });
    // Never within one chain, never across categories.
    expect(await link("melkB", "melkGrootB")).toBeNull();
    expect(await link("melkA", "vleesC")).toBeNull();
    expect(await link("melkA", "colaB")).toBeNull();
  });

  it("changes nothing when it runs again", async () => {
    const before = await linksOf();
    expect(await rebuildMatches(db, scope())).toMatchObject({ created: 0, updated: 0, removed: 0 });
    expect(await linksOf()).toEqual(before);
  });

  it("leaves alone what a person decided, and follows the matcher for the rest", async () => {
    const rejected = await link("melkA", "melkB");
    const confirmed = await link("karnemelkA", "karnemelkC");
    await db.productMatch.update({ where: { id: rejected!.id }, data: { status: "REJECTED" } });
    await db.productMatch.update({ where: { id: confirmed!.id }, data: { status: "CONFIRMED", matchType: "SIMILAR" } });
    // The matcher would no longer link these two at all…
    await db.product.update({ where: { id: ids.karnemelkC }, data: { name: "Vla vanille 1 L" } });
    // …and now sees this pair as a different size.
    await db.product.update({ where: { id: ids.melkC }, data: { packageAmount: 2000 } });

    const result = await rebuildMatches(db, scope());
    expect(result.decided).toBe(2);
    expect(result.updated).toBeGreaterThan(0);
    expect(await link("melkA", "melkB")).toMatchObject({ status: "REJECTED" });
    expect(await link("karnemelkA", "karnemelkC")).toMatchObject({ status: "CONFIRMED", matchType: "SIMILAR" });
    expect(await link("melkA", "melkC")).toMatchObject({ matchType: "ALTERNATIVE" });

    // An automatic link the matcher no longer makes is removed.
    await db.product.update({ where: { id: ids.colaB }, data: { name: "Sinas 1 L", ean: null, brand: null } });
    expect((await rebuildMatches(db, scope())).removed).toBe(1);
    expect(await link("colaA", "colaB")).toBeNull();

    // Back to the starting point for the tests below.
    await db.product.update({ where: { id: ids.melkC }, data: { packageAmount: 1000 } });
    await db.product.update({
      where: { id: ids.colaB },
      data: { name: "Cola Bruisbron fles 1 liter", ean: "2000000000015", brand: "Bruisbron" },
    });
    await db.product.update({ where: { id: ids.karnemelkC }, data: { name: "Karnemelk houdbaar 1 L" } });
    await db.productMatch.update({ where: { id: rejected!.id }, data: { status: "AUTO" } });
    await db.productMatch.update({ where: { id: confirmed!.id }, data: { status: "NEEDS_REVIEW" } });
    await rebuildMatches(db, scope());
    expect(await link("karnemelkA", "karnemelkC")).toMatchObject({ matchType: "ALTERNATIVE", status: "NEEDS_REVIEW" });
  });

  it("touches only links between the chains it was asked about", async () => {
    await rebuildMatches(db, { retailerIds: [a.id, b.id] });
    // The link with chain C was not in scope, so it is still there.
    expect(await link("melkA", "melkC")).not.toBeNull();
  });

  it("compares a product with the other chains: equals by price, alternatives apart", async () => {
    const comparison = await compareProduct(db, ids.melkA!, TODAY);
    expect(comparison?.product).toMatchObject({ id: ids.melkA, lowestPrice: false, bestUnitPrice: false });
    expect(comparison?.equals.map((row) => [row.product.name, row.type, row.lowestPrice, row.bestUnitPrice])).toEqual([
      ["Melk halfvol 1 liter", "SIMILAR", true, false],
      ["Halfvolle melk pak 1 L", "SIMILAR", false, false],
    ]);
    // 2 l for € 1,69 is € 0,85 per litre: the best unit price, but not "the lowest price".
    expect(
      comparison?.alternatives.map((row) => [row.product.name, row.type, row.lowestPrice, row.bestUnitPrice]),
    ).toEqual([["Halfvolle melk 2 L", "ALTERNATIVE", false, true]]);
    expect(comparison?.equals[0]?.matchId).toBe((await link("melkA", "melkB"))?.id);
  });

  it("is the same comparison seen from the other side", async () => {
    const comparison = await compareProduct(db, ids.melkB!, TODAY);
    expect(comparison?.product).toMatchObject({ lowestPrice: true });
    expect(comparison?.equals.map((row) => row.product.name)).toEqual(["Halfvolle melk pak 1 L", "Halfvolle melk 1 L"]);
    // Its own chain's 2 l pack is not a link: one chain's two listings are two products.
    expect(comparison?.alternatives).toEqual([]);
  });

  it("shows no link that waits for review or was rejected, and shows a confirmed one", async () => {
    const waiting = await compareProduct(db, ids.karnemelkA!, TODAY);
    expect(waiting?.equals).toEqual([]);
    expect(waiting?.alternatives).toEqual([]);

    const row = await link("karnemelkA", "karnemelkC");
    await db.productMatch.update({ where: { id: row!.id }, data: { status: "CONFIRMED" } });
    expect((await compareProduct(db, ids.karnemelkA!, TODAY))?.alternatives.map((r) => r.product.name)).toEqual([
      "Karnemelk houdbaar 1 L",
    ]);
    await db.productMatch.update({ where: { id: row!.id }, data: { status: "REJECTED" } });
    expect((await compareProduct(db, ids.karnemelkA!, TODAY))?.alternatives).toEqual([]);
    await db.productMatch.update({ where: { id: row!.id }, data: { status: "NEEDS_REVIEW" } });
  });

  it("leaves out a chain that was switched off, and knows no product it cannot find", async () => {
    await db.retailer.update({ where: { id: b.id }, data: { active: false } });
    const comparison = await compareProduct(db, ids.melkA!, TODAY);
    expect(comparison?.equals.map((row) => row.product.name)).toEqual(["Halfvolle melk pak 1 L"]);
    expect(comparison?.alternatives).toEqual([]);
    expect(await compareProduct(db, ids.melkB!, TODAY)).toBeNull();
    await db.retailer.update({ where: { id: b.id }, data: { active: true } });
    expect(await compareProduct(db, "doesnotexist", TODAY)).toBeNull();
  });

  it("stores one open report per wrong link", async () => {
    const row = await link("melkA", "melkB");
    const device = "3f2b8c1e-5d4a-4b6f-9a7e-0c1d2e3f4a5b";
    expect(await reportWrongMatch(db, { matchId: row!.id, productId: ids.melkA!, deviceId: device })).toBe("sent");
    expect(await reportWrongMatch(db, { matchId: row!.id, productId: ids.melkB!, deviceId: null })).toBe("known");
    const stored = await db.feedback.findMany({ where: { productMatchId: row!.id } });
    expect(stored).toMatchObject([
      { kind: "WRONG_MATCH", productId: ids.melkA, deviceId: device, message: null, resolvedAt: null },
    ]);

    // Once a person has dealt with it, a new report is taken again.
    await db.feedback.update({ where: { id: stored[0]!.id }, data: { resolvedAt: new Date() } });
    expect(await reportWrongMatch(db, { matchId: row!.id, productId: ids.melkB!, deviceId: null })).toBe("sent");
    expect(await db.feedback.count({ where: { productMatchId: row!.id } })).toBe(2);
  });

  it("refuses a report on a link the product is not part of, or that does not exist", async () => {
    const row = await link("melkA", "melkB");
    expect(await reportWrongMatch(db, { matchId: row!.id, productId: ids.colaA!, deviceId: null })).toBe("not-found");
    expect(await reportWrongMatch(db, { matchId: "doesnotexist", productId: ids.melkA!, deviceId: null })).toBe(
      "not-found",
    );
  });

  it("stores one open report per wrong price", async () => {
    expect(await reportWrongPrice(db, { productId: ids.colaA!, deviceId: null })).toBe("sent");
    expect(await reportWrongPrice(db, { productId: ids.colaA!, deviceId: null })).toBe("known");
    expect(await reportWrongPrice(db, { productId: "doesnotexist", deviceId: null })).toBe("not-found");
    expect(await db.feedback.count({ where: { productId: ids.colaA, kind: "WRONG_PRICE" } })).toBe(1);
  });
});
