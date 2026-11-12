import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { RawOffer, RetailerAdapter } from "@/ingestion/adapter";
import { runAdapter, type RunnerDeps } from "@/ingestion/runner";
import { db } from "@/lib/db";
import {
  adminOverview,
  decideMatch,
  renameCategory,
  resolveFeedback,
  reviewQueue,
  REVIEW_PAGE_SIZE,
  setRetailerSwitch,
} from "@/server/admin";
import { reportWrongMatch, reportWrongPrice } from "@/server/feedback";
import { createScratchRetailer } from "./support";

const NOW = new Date("2026-11-12T10:00:00Z");
type Scratch = Awaited<ReturnType<typeof createScratchRetailer>>;

let a: Scratch, b: Scratch;
let categoryId: string;
const adapterId = `test-${randomUUID()}`;
const ids: Record<string, string> = {};

async function product(key: string, shop: Scratch, name: string, cents?: number) {
  const row = await db.product.create({
    data: {
      retailerId: shop.id,
      externalId: key,
      name,
      normalizedName: name.toLowerCase(),
      brand: "Testmerk",
      unit: "G",
      packageAmount: 500,
      categoryId,
    },
  });
  if (cents !== undefined) {
    await db.priceHistory.create({
      data: { productId: row.id, retailerId: shop.id, priceCents: cents, recordedAt: NOW },
    });
  }
  ids[key] = row.id;
}

async function link(x: string, y: string, status: "AUTO" | "NEEDS_REVIEW" | "REJECTED", confidence: number) {
  const [low, high] = [ids[x]!, ids[y]!].sort() as [string, string];
  const row = await db.productMatch.create({
    data: { canonicalProductId: low, candidateProductId: high, matchType: "SIMILAR", confidence, status },
  });
  ids[`${x}-${y}`] = row.id;
}

/** The queue holds other files' rows too: look only at the links this file made. */
async function myQueue() {
  const mine = new Set(Object.values(ids));
  const all = [];
  for (let page = 1; ; page++) {
    const { items, total } = await reviewQueue(db, page);
    all.push(...items);
    if (page * REVIEW_PAGE_SIZE >= total) break;
  }
  return all.filter((item) => mine.has(item.id));
}

beforeAll(async () => {
  a = await createScratchRetailer("admin-a");
  b = await createScratchRetailer("admin-b");
  const category = await db.category.create({
    data: {
      slug: `test-admin-${randomUUID()}`,
      nameNl: "Testgroep",
      nameEn: "Test group",
      nameIt: "Gruppo test",
      position: 999,
    },
  });
  categoryId = category.id;
  await product("a-doubt", a, "Admin pindakaas 500 g", 249);
  await product("b-doubt", b, "Admin pindakaas naturel 500 g", 229);
  await product("a-auto", a, "Admin hagelslag 500 g", 199);
  await product("b-auto", b, "Admin hagelslag puur 500 g");
  await product("a-quiet", a, "Admin thee", 99);
  await product("b-quiet", b, "Admin thee groen", 109);
  await product("a-gone", a, "Admin koek", 150);
  await product("b-gone", b, "Admin koek roomboter", 160);
  await link("a-doubt", "b-doubt", "NEEDS_REVIEW", 0.71);
  await link("a-auto", "b-auto", "AUTO", 0.93);
  await link("a-quiet", "b-quiet", "AUTO", 0.95);
  await link("a-gone", "b-gone", "REJECTED", 0.6);
});

afterAll(async () => {
  await db.ingestionRun.deleteMany({ where: { adapter: adapterId } });
  await db.feedback.deleteMany({ where: { productId: { in: Object.values(ids) } } });
  await a.remove();
  await b.remove();
  await db.category.delete({ where: { id: categoryId } });
  await db.$disconnect();
});

describe("adapter switch", () => {
  const fetchOffers = vi.fn(async () => [] as RawOffer[]);
  const adapter = () =>
    ({
      id: adapterId,
      retailerSlug: a.slug,
      isMock: false,
      maxRunsPerDay: 5,
      fetchOffers,
      fetchUpcomingOffers: async () => [],
      fetchStoreLocations: async () => [],
      normalizeProduct: () => ({ ok: false, reason: "unused" }),
      normalizeOffer: () => ({ ok: false, reason: "unused" }),
    }) as unknown as RetailerAdapter;
  const deps = (): RunnerDeps => ({
    db,
    createHttp: () => ({
      get: async () => {
        throw new Error("no requests in tests");
      },
    }),
    // Later than any other run in the test database, so these are among the latest shown.
    now: () => new Date("2099-01-01T10:00:00Z"),
    enabledAdapters: [adapterId],
  });

  it("takes effect on the next run, in both directions", async () => {
    // A new chain starts with its real adapter off.
    expect((await runAdapter(adapter(), deps())).status).toBe("SKIPPED");
    expect(fetchOffers).not.toHaveBeenCalled();

    expect(await setRetailerSwitch(db, { retailerId: a.id, field: "adapterEnabled", value: true })).toBe(true);
    expect((await runAdapter(adapter(), deps())).status).toBe("SUCCESS");
    expect(fetchOffers).toHaveBeenCalledTimes(1);

    expect(await setRetailerSwitch(db, { retailerId: a.id, field: "adapterEnabled", value: false })).toBe(true);
    const run = await runAdapter(adapter(), deps());
    expect(run.status).toBe("SKIPPED");
    expect(run.errors).toEqual([{ message: expect.stringMatching(/adapterEnabled/) }]);
    expect(fetchOffers).toHaveBeenCalledTimes(1);
  });

  it("the two switches of a chain are independent", async () => {
    await setRetailerSwitch(db, { retailerId: b.id, field: "active", value: false });
    expect(await db.retailer.findUnique({ where: { id: b.id } })).toMatchObject({
      active: false,
      adapterEnabled: false,
    });
    await setRetailerSwitch(db, { retailerId: b.id, field: "active", value: true });
    expect(await db.retailer.findUnique({ where: { id: b.id } })).toMatchObject({
      active: true,
      adapterEnabled: false,
    });
  });

  it("reports an unknown chain", async () => {
    expect(await setRetailerSwitch(db, { retailerId: "cunknown0000000000", field: "active", value: false })).toBe(
      false,
    );
  });
});

describe("overview", () => {
  it("lists chains with both switches, the latest runs and categories", async () => {
    const overview = await adminOverview(db, [a.slug]);
    expect(overview.retailers.find((r) => r.id === a.id)).toMatchObject({
      slug: a.slug,
      active: true,
      adapterEnabled: false,
      listedInEnv: true,
      products: 4,
    });
    expect(overview.retailers.find((r) => r.id === b.id)).toMatchObject({ listedInEnv: false, products: 4 });

    const runs = overview.runs.filter((run) => run.adapter === adapterId);
    expect(runs).toHaveLength(3);
    expect(runs.map((run) => run.status).sort()).toEqual(["SKIPPED", "SKIPPED", "SUCCESS"]);
    const skipped = runs.find((run) => run.status === "SKIPPED")!;
    expect(skipped).toMatchObject({ errorCount: 1, retailerName: "Test admin-a" });
    expect(skipped.errors[0]).toMatch(/adapterEnabled/);

    expect(overview.categories.find((c) => c.id === categoryId)).toMatchObject({ nameNl: "Testgroep", products: 8 });
    expect(overview.reviewCount).toBeGreaterThanOrEqual(1);
  });
});

describe("review queue", () => {
  it("holds doubtful links, not automatic or rejected ones", async () => {
    const queue = await myQueue();
    expect(queue.map((item) => item.id)).toEqual([ids["a-doubt-b-doubt"]]);
    const [item] = queue;
    expect(item).toMatchObject({ matchType: "SIMILAR", status: "NEEDS_REVIEW", confidence: 0.71, reported: false });
    const sides = [item!.left, item!.right].sort((x, y) => x.name.localeCompare(y.name));
    expect(sides[0]).toMatchObject({
      name: "Admin pindakaas 500 g",
      brand: "Testmerk",
      retailerName: "Test admin-a",
      unit: "G",
      packageAmount: 500,
      priceCents: 249,
    });
    expect(sides[1]).toMatchObject({ retailerName: "Test admin-b", priceCents: 229 });
  });

  it("adds an automatic link once a visitor reports it, and shows a missing price as null", async () => {
    await reportWrongMatch(db, { matchId: ids["a-auto-b-auto"]!, productId: ids["a-auto"]!, deviceId: null });
    // A report on a link that was already rejected changes nothing.
    await reportWrongMatch(db, { matchId: ids["a-gone-b-gone"]!, productId: ids["a-gone"]!, deviceId: null });
    const queue = await myQueue();
    // Most confident first.
    expect(queue.map((item) => item.id)).toEqual([ids["a-auto-b-auto"], ids["a-doubt-b-doubt"]]);
    expect(queue[0]).toMatchObject({ status: "AUTO", reported: true });
    expect([queue[0]!.left.priceCents, queue[0]!.right.priceCents].sort()).toEqual([199, null]);
  });

  it("confirming sets the chosen type, closes the report and takes the link off the queue", async () => {
    const matchId = ids["a-auto-b-auto"]!;
    expect(await decideMatch(db, { matchId, decision: "SAME", now: NOW })).toBe(true);
    expect(await db.productMatch.findUnique({ where: { id: matchId } })).toMatchObject({
      status: "CONFIRMED",
      matchType: "SAME",
    });
    expect(await db.feedback.findMany({ where: { productMatchId: matchId } })).toEqual([
      expect.objectContaining({ kind: "WRONG_MATCH", resolvedAt: NOW }),
    ]);
    expect((await myQueue()).map((item) => item.id)).toEqual([ids["a-doubt-b-doubt"]]);
  });

  it("a confirmed link comes back when it is reported again", async () => {
    const matchId = ids["a-auto-b-auto"]!;
    expect(await reportWrongMatch(db, { matchId, productId: ids["b-auto"]!, deviceId: null })).toBe("sent");
    expect((await myQueue()).map((item) => item.id)).toContain(matchId);
    await decideMatch(db, { matchId, decision: "ALTERNATIVE", now: NOW });
    expect(await db.productMatch.findUnique({ where: { id: matchId } })).toMatchObject({
      status: "CONFIRMED",
      matchType: "ALTERNATIVE",
    });
  });

  it("rejecting keeps the suggested type and leaves other links alone", async () => {
    const matchId = ids["a-doubt-b-doubt"]!;
    expect(await decideMatch(db, { matchId, decision: "REJECT", now: NOW })).toBe(true);
    expect(await db.productMatch.findUnique({ where: { id: matchId } })).toMatchObject({
      status: "REJECTED",
      matchType: "SIMILAR",
    });
    expect(await db.productMatch.findUnique({ where: { id: ids["a-quiet-b-quiet"]! } })).toMatchObject({
      status: "AUTO",
      matchType: "SIMILAR",
    });
    expect(await myQueue()).toEqual([]);
  });

  it("reports an unknown link", async () => {
    expect(await decideMatch(db, { matchId: "cunknown0000000000", decision: "SAME", now: NOW })).toBe(false);
  });
});

describe("price reports", () => {
  it("show up until handled, once", async () => {
    await reportWrongPrice(db, { productId: ids["a-quiet"]!, deviceId: null });
    const before = (await adminOverview(db, [])).feedback.filter((entry) => entry.productId === ids["a-quiet"]);
    expect(before).toEqual([
      expect.objectContaining({ kind: "WRONG_PRICE", productName: "Admin thee", retailerName: "Test admin-a" }),
    ]);
    // "Wrong match" reports live in the review queue, not in this list.
    expect((await adminOverview(db, [])).feedback.some((entry) => entry.productId === ids["a-gone"])).toBe(false);

    const feedbackId = before[0]!.id;
    expect(await resolveFeedback(db, { feedbackId, now: NOW })).toBe(true);
    expect(await resolveFeedback(db, { feedbackId, now: new Date() })).toBe(false);
    expect(await db.feedback.findUnique({ where: { id: feedbackId } })).toMatchObject({ resolvedAt: NOW });
    expect((await adminOverview(db, [])).feedback.some((entry) => entry.id === feedbackId)).toBe(false);
  });
});

describe("categories", () => {
  it("renames one category in all three languages", async () => {
    expect(await renameCategory(db, { categoryId, nameNl: "Nieuw", nameEn: "New", nameIt: "Nuovo" })).toBe(true);
    expect(await db.category.findUnique({ where: { id: categoryId } })).toMatchObject({
      nameNl: "Nieuw",
      nameEn: "New",
      nameIt: "Nuovo",
      position: 999,
    });
    expect(await renameCategory(db, { categoryId: "cunknown0000000000", nameNl: "x", nameEn: "x", nameIt: "x" })).toBe(
      false,
    );
  });
});
