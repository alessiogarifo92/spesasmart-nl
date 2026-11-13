import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { ok, fail } from "@/domain/pricing";
import type { NormalizedOffer, RawOffer, RawStore, RetailerAdapter } from "@/ingestion/adapter";
import { createOfflineHttpClient, type HttpClient } from "@/ingestion/http";
import { MAX_RUN_ERRORS, runAdapter, runAll, type RunnerDeps } from "@/ingestion/runner";
import { saveOffer, saveStores } from "@/ingestion/store";
import { createScratchRetailer } from "./support";

type Scratch = Awaited<ReturnType<typeof createScratchRetailer>>;

const NOW = new Date("2026-11-11T08:00:00Z");
const scratch: Scratch[] = [];
const adapterIds: string[] = [];

/** A scratch retailer whose real-adapter switch is on. */
async function retailer(label: string, adapterEnabled = true): Promise<Scratch> {
  const created = await createScratchRetailer(`ingestion-${label}`);
  await db.retailer.update({ where: { id: created.id }, data: { adapterEnabled } });
  scratch.push(created);
  return created;
}

/** Raw payload of the fake adapters: prices in cents, validity as ISO dates. */
type FakeItem = {
  externalId: string;
  name: string;
  price: number | null;
  regular: number | null;
  from: string | null;
  until: string | null;
};

function item(overrides: Partial<FakeItem> = {}): FakeItem {
  return { externalId: "kip", name: "Kipfilet 500 g", price: 349, regular: 499, from: "2026-11-09", until: "2026-11-15", ...overrides };
}

function normalize(raw: RawOffer) {
  const p = raw.payload;
  if (typeof p.name !== "string" || p.name === "BROKEN") return fail("name-unreadable");
  if (p.name === "THROWS") throw new Error("parser crashed");
  const offer: NormalizedOffer = {
    product: {
      externalId: String(p.externalId),
      name: p.name,
      brand: null,
      ean: null,
      quantity: { amount: 500, unit: "g", count: 1, totalAmount: 500, approximate: false },
      categorySlug: typeof p.category === "string" ? p.category : null,
      isOrganic: false,
      attributes: {},
    },
    title: p.name,
    kind: "WEEKLY",
    promotion: { type: "PRICE_CUT" },
    promoDescription: null,
    currentPriceCents: typeof p.price === "number" ? p.price : null,
    regularPriceCents: typeof p.regular === "number" ? p.regular : null,
    validity: typeof p.until === "string" ? { start: typeof p.from === "string" ? p.from : null, end: p.until, approximate: false } : null,
    conditions: null,
    sourceUrl: raw.sourceUrl,
    rawPayload: p,
  };
  return ok(offer);
}

/** A real (non-mock) adapter whose methods are spies. `items` is read on every run. */
function fakeAdapter(target: Scratch, items: () => FakeItem[], overrides: Partial<RetailerAdapter> = {}) {
  const id = `test-${randomUUID()}`;
  adapterIds.push(id);
  const toRaw = (entry: FakeItem): RawOffer => ({ sourceUrl: `https://shop.example.test/${entry.externalId}`, payload: { ...entry } });
  const adapter = {
    id,
    retailerSlug: target.slug,
    isMock: false,
    maxRunsPerDay: 5,
    fetchOffers: vi.fn(async () => items().map(toRaw)),
    fetchUpcomingOffers: vi.fn(async () => [] as RawOffer[]),
    fetchStoreLocations: vi.fn(async () => [] as RawStore[]),
    normalizeProduct: vi.fn((raw: RawOffer) => {
      const result = normalize(raw);
      return result.ok ? ok(result.value.product) : result;
    }),
    normalizeOffer: vi.fn((raw: RawOffer) => normalize(raw)),
    ...overrides,
  } satisfies RetailerAdapter;
  return adapter;
}

function deps(enabled: string[], overrides: Partial<RunnerDeps> = {}) {
  const get = vi.fn<HttpClient["get"]>(async () => {
    throw new Error("no requests in tests");
  });
  const createHttp = vi.fn((): HttpClient => ({ get, getBytes: vi.fn() }));
  return { deps: { db, createHttp, now: () => NOW, enabledAdapters: enabled, ...overrides } satisfies RunnerDeps, get, createHttp };
}

afterAll(() => db.$disconnect());

const offersOf = (target: Scratch) => db.offer.findMany({ where: { retailerId: target.id }, orderBy: { title: "asc" } });

describe("ingestion runner", () => {
  beforeAll(async () => {
    // Idempotent: the same values the seed writes for this category.
    await db.category.upsert({
      where: { slug: "vlees-vis" },
      update: {},
      create: { slug: "vlees-vis", nameNl: "Vlees & vis", nameEn: "Meat & fish", nameIt: "Carne e pesce", position: 1 },
    });
  });

  afterAll(async () => {
    await db.ingestionRun.deleteMany({ where: { adapter: { in: adapterIds } } });
    for (const target of scratch) await target.remove();
  });

  it("stores a valid offer as verified with its product, provenance and price history", async () => {
    const target = await retailer("happy");
    const adapter = fakeAdapter(target, () => [{ ...item(), category: "vlees-vis" } as FakeItem]);
    const run = await runAdapter(adapter, deps([adapter.id]).deps);

    expect(run).toMatchObject({ status: "SUCCESS", itemsFound: 1, itemsUpdated: 1, errors: [], retailerId: target.id, adapter: adapter.id });
    expect(run.startedAt).toEqual(NOW);
    expect(run.finishedAt).not.toBeNull();
    const [offer] = await offersOf(target);
    expect(offer).toMatchObject({
      title: "Kipfilet 500 g",
      currentPriceCents: 349,
      regularPriceCents: 499,
      pricePerUnitCents: 698,
      promoType: "PRICE_CUT",
      promoParams: {},
      status: "VERIFIED",
      confidence: 1,
      sourceUrl: "https://shop.example.test/kip",
      isDemo: false,
      validityApproximate: false,
    });
    expect(offer.validFrom?.toISOString()).toBe("2026-11-09T00:00:00.000Z");
    expect(offer.validUntil?.toISOString()).toBe("2026-11-15T00:00:00.000Z");
    expect(offer.collectedAt).toEqual(NOW);
    expect(offer.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(offer.rawPayload).toMatchObject({ externalId: "kip", price: 349 });

    const product = await db.product.findUniqueOrThrow({ where: { id: offer.productId }, include: { category: true } });
    expect(product).toMatchObject({
      externalId: "kip",
      normalizedName: "kipfilet 500 g",
      unit: "G",
      packageAmount: 500,
      packageCount: 1,
      imageUrl: null,
      isDemo: false,
    });
    expect(product.category?.slug).toBe("vlees-vis");
    const history = await db.priceHistory.findMany({ where: { productId: product.id } });
    expect(history).toMatchObject([{ priceCents: 499, sourceUrl: "https://shop.example.test/kip", isDemo: false }]);
    expect(history[0].recordedAt).toEqual(NOW);
  });

  it("records a FAILED run when fetching throws, and runAll still runs the next adapter", async () => {
    const broken = await retailer("broken");
    const healthy = await retailer("healthy");
    const failing = fakeAdapter(broken, () => [], {
      fetchOffers: vi.fn(async () => {
        throw new Error("offer page changed");
      }),
      fetchUpcomingOffers: vi.fn(async () => {
        throw new Error("upcoming page gone");
      }),
    });
    const working = fakeAdapter(healthy, () => [item()]);
    const runs = await runAll([failing, working], deps([failing.id, working.id]).deps);

    expect(runs.map((run) => run.status)).toEqual(["FAILED", "SUCCESS"]);
    expect(runs[0].errors).toEqual([
      { message: "fetchOffers: offer page changed" },
      { message: "fetchUpcomingOffers: upcoming page gone" },
    ]);
    expect(runs[0].finishedAt).not.toBeNull();
    expect(await offersOf(healthy)).toHaveLength(1);
  });

  it("records an unexpected runner failure as a FAILED run and goes on", async () => {
    const first = await retailer("crash-a");
    const second = await retailer("crash-b");
    const a = fakeAdapter(first, () => [item()]);
    const b = fakeAdapter(second, () => [item()]);
    const { deps: base } = deps([a.id, b.id]);
    let calls = 0;
    const createHttp = () => {
      calls += 1;
      if (calls === 1) throw new Error("no user agent configured");
      return createOfflineHttpClient();
    };
    const runs = await runAll([a, b], { ...base, createHttp });

    expect(runs.map((run) => run.status)).toEqual(["FAILED", "SUCCESS"]);
    expect(runs[0].errors).toEqual([{ message: "run aborted: no user agent configured" }]);
    expect(await db.ingestionRun.count({ where: { adapter: { in: [a.id, b.id] }, status: "RUNNING" } })).toBe(0);
  });

  it("records a FAILED run itself when the runner throws before a run row exists", async () => {
    const first = await retailer("early-a");
    const second = await retailer("early-b");
    const a = fakeAdapter(first, () => [item()]);
    const b = fakeAdapter(second, () => [item()]);
    let clockCalls = 0;
    const now = () => {
      clockCalls += 1;
      if (clockCalls === 1) throw new Error("clock unavailable");
      return NOW;
    };
    const runs = await runAll([a, b], deps([a.id, b.id], { now }).deps);

    expect(runs.map((run) => [run.adapter, run.status])).toEqual([
      [a.id, "FAILED"],
      [b.id, "SUCCESS"],
    ]);
    expect(runs[0].errors).toEqual([{ message: "runner failed: clock unavailable" }]);
    expect(a.fetchOffers).not.toHaveBeenCalled();
  });

  it("stores an offer without validity as UNVERIFIED", async () => {
    const target = await retailer("no-validity");
    const adapter = fakeAdapter(target, () => [item({ from: null, until: null })]);
    const run = await runAdapter(adapter, deps([adapter.id]).deps);

    expect(run.status).toBe("SUCCESS");
    const [offer] = await offersOf(target);
    expect(offer).toMatchObject({ status: "UNVERIFIED", confidence: 0.7, validFrom: null, validUntil: null });
  });

  it.each([
    ["missing from INGESTION_ENABLED_ADAPTERS", false, true, /INGESTION_ENABLED_ADAPTERS/],
    ["switched off on the retailer", true, false, /adapterEnabled/],
  ])("skips a real adapter %s without calling it or the network", async (_, listed, column, reason) => {
    const target = await retailer(`off-${column}`, column);
    const adapter = fakeAdapter(target, () => [item()]);
    const { deps: runDeps, get, createHttp } = deps(listed ? [adapter.id] : []);
    const run = await runAdapter(adapter, runDeps);

    expect(run.status).toBe("SKIPPED");
    expect(run.errors).toEqual([{ message: expect.stringMatching(reason) }]);
    expect(run.finishedAt).not.toBeNull();
    for (const method of [adapter.fetchOffers, adapter.fetchUpcomingOffers, adapter.fetchStoreLocations, adapter.normalizeOffer, adapter.normalizeProduct]) {
      expect(method).not.toHaveBeenCalled();
    }
    expect(createHttp).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(await offersOf(target)).toHaveLength(0);
  });

  it("records a FAILED run without retailer when the retailer does not exist", async () => {
    const ghost = { id: "none", slug: `test-missing-${randomUUID()}`, remove: async () => undefined } as unknown as Scratch;
    const adapter = fakeAdapter(ghost, () => [item()]);
    const run = await runAdapter(adapter, deps([adapter.id]).deps);
    expect(run).toMatchObject({ status: "FAILED", retailerId: null });
    expect(run.errors).toEqual([{ message: expect.stringMatching(/not found/) }]);
    expect(adapter.fetchOffers).not.toHaveBeenCalled();
  });

  it("skips the second run of a real adapter on the same Amsterdam day", async () => {
    const target = await retailer("daily-limit");
    const adapter = fakeAdapter(target, () => [item()], { maxRunsPerDay: undefined });
    const first = await runAdapter(adapter, deps([adapter.id]).deps);
    // Amsterdam is UTC+1 in November: 22:30 UTC is still the 11th, 23:30 UTC is already the 12th.
    const sameDay = await runAdapter(adapter, deps([adapter.id], { now: () => new Date("2026-11-11T22:30:00Z") }).deps);
    const nextDay = await runAdapter(adapter, deps([adapter.id], { now: () => new Date("2026-11-11T23:30:00Z") }).deps);

    expect(first.status).toBe("SUCCESS");
    expect(sameDay.status).toBe("SKIPPED");
    expect(sameDay.errors).toEqual([{ message: expect.stringMatching(/daily limit/) }]);
    expect(nextDay.status).toBe("SUCCESS");
    expect(adapter.fetchOffers).toHaveBeenCalledTimes(2);
  });

  it("exempts mock adapters from the daily limit", async () => {
    const target = await retailer("mock-limit", false);
    const adapter = fakeAdapter(target, () => [item()], { isMock: true, maxRunsPerDay: 1 });
    const runs = [await runAdapter(adapter, deps([]).deps), await runAdapter(adapter, deps([]).deps)];
    expect(runs.map((run) => run.status)).toEqual(["SUCCESS", "SUCCESS"]);
    const [offer] = await offersOf(target);
    expect(offer.isDemo).toBe(true);
  });

  it("does not duplicate offers or products when the same adapter runs twice", async () => {
    const target = await retailer("twice");
    const adapter = fakeAdapter(target, () => [item(), item({ externalId: "melk", name: "Halfvolle melk 1 L", price: 99, regular: 119 })]);
    const first = await runAdapter(adapter, deps([adapter.id]).deps);
    const second = await runAdapter(adapter, deps([adapter.id]).deps);

    expect([first.itemsUpdated, second.itemsUpdated]).toEqual([2, 2]);
    expect(await db.offer.count({ where: { retailerId: target.id } })).toBe(2);
    expect(await db.product.count({ where: { retailerId: target.id } })).toBe(2);
    expect(await db.priceHistory.count({ where: { retailerId: target.id } })).toBe(2);
  });

  it("saves the good items and reports PARTIAL when one item is bad", async () => {
    const target = await retailer("partial");
    const adapter = fakeAdapter(target, () => [
      item(),
      item({ externalId: "broken", name: "BROKEN" }),
      item({ externalId: "crash", name: "THROWS" }),
      item({ externalId: "old", name: "Oude aanbieding", from: "2026-11-01", until: "2026-11-07" }),
      item({ externalId: "melk", name: "Halfvolle melk 1 L", price: 99, regular: 119 }),
    ]);
    const run = await runAdapter(adapter, deps([adapter.id]).deps);

    expect(run).toMatchObject({ status: "PARTIAL", itemsFound: 5, itemsUpdated: 2 });
    expect(run.errors).toEqual([
      { message: "normalise: name-unreadable", url: "https://shop.example.test/broken", item: expect.stringContaining("BROKEN") },
      { message: "parser crashed", url: "https://shop.example.test/crash", item: expect.stringContaining("THROWS") },
      { message: "rejected: expired", url: "https://shop.example.test/old", item: expect.stringContaining("Oude") },
    ]);
    expect((await offersOf(target)).map((offer) => offer.title)).toEqual(["Halfvolle melk 1 L", "Kipfilet 500 g"]);
  });

  it("reports FAILED when every item is bad, and caps the error list", async () => {
    const target = await retailer("all-bad");
    const bad = Array.from({ length: 70 }, (_, index) => item({ externalId: `b${index}`, name: "BROKEN" }));
    const adapter = fakeAdapter(target, () => bad, {
      normalizeOffer: vi.fn(() => fail(`unreadable ${"x".repeat(600)}`)),
    });
    const run = await runAdapter(adapter, deps([adapter.id]).deps);
    const errors = run.errors as { message: string }[];

    expect(run).toMatchObject({ status: "FAILED", itemsFound: 70, itemsUpdated: 0 });
    expect(errors).toHaveLength(MAX_RUN_ERRORS);
    expect(errors.slice(0, -1).every((error) => error.message.length === 500)).toBe(true);
    expect(errors.at(-1)).toEqual({ message: "21 more errors not recorded" });
  });

  it("adds a price-history row once, and again only when the regular price changes", async () => {
    const target = await retailer("history");
    let regular = 499;
    const adapter = fakeAdapter(target, () => [item({ regular })]);
    const history = () =>
      db.priceHistory.findMany({ where: { retailerId: target.id }, orderBy: { recordedAt: "asc" }, select: { priceCents: true } });

    await runAdapter(adapter, deps([adapter.id]).deps);
    await runAdapter(adapter, deps([adapter.id], { now: () => new Date("2026-11-11T09:00:00Z") }).deps);
    expect(await history()).toEqual([{ priceCents: 499 }]);

    regular = 549;
    await runAdapter(adapter, deps([adapter.id], { now: () => new Date("2026-11-11T10:00:00Z") }).deps);
    expect(await history()).toEqual([{ priceCents: 499 }, { priceCents: 549 }]);

    await runAdapter(adapter, deps([adapter.id], { now: () => new Date("2026-11-11T11:00:00Z") }).deps);
    expect(await history()).toHaveLength(2);
    // The changed regular price is new content: a second offer row, the first one kept.
    expect(await db.offer.count({ where: { retailerId: target.id } })).toBe(2);
  });

  it("records a failing store fetch without losing the offers", async () => {
    const target = await retailer("stores-fail");
    const adapter = fakeAdapter(target, () => [item()], {
      fetchStoreLocations: vi.fn(async () => {
        throw new Error("store finder down");
      }),
    });
    const run = await runAdapter(adapter, deps([adapter.id]).deps);
    expect(run).toMatchObject({ status: "PARTIAL", itemsUpdated: 1 });
    expect(run.errors).toEqual([{ message: "fetchStoreLocations: store finder down" }]);
  });

  it("saves store locations idempotently on their source reference", async () => {
    const target = await retailer("stores");
    const store: RawStore = {
      sourceUrl: "https://www.openstreetmap.org/node/1",
      sourceRef: "osm:node/1",
      name: "Testwinkel Centrum",
      address: "Damrak 1",
      postalCode: "1012 LG",
      city: "Amsterdam",
      latitude: 52.376,
      longitude: 4.897,
      payload: {},
    };
    const adapter = fakeAdapter(target, () => [], { fetchStoreLocations: vi.fn(async () => [store]) });
    await runAdapter(adapter, deps([adapter.id]).deps);
    expect(await saveStores(db, target.id, [{ ...store, name: "Testwinkel Damrak" }])).toBe(1);

    const stores = await db.store.findMany({ where: { retailerId: target.id } });
    expect(stores).toMatchObject([{ sourceRef: "osm:node/1", name: "Testwinkel Damrak", city: "Amsterdam", latitude: 52.376 }]);
  });
});

describe("saveOffer", () => {
  let target: Scratch;
  const adapter = { id: "test:save", retailerSlug: "test-save", isMock: false };
  const verdict = { status: "VERIFIED" as const, confidence: 1, issues: [] };

  beforeAll(async () => {
    target = await createScratchRetailer("ingestion-save");
  });
  afterAll(() => target.remove());

  function base(): NormalizedOffer {
    const result = normalize({ sourceUrl: "https://shop.example.test/x", payload: { ...item(), externalId: "save" } });
    if (!result.ok) throw new Error("fixture");
    return result.value;
  }

  it.each<[string, NormalizedOffer["promotion"], object]>([
    ["X_PLUS_Y_FREE", { type: "X_PLUS_Y_FREE", buy: 2, free: 1 }, { buy: 2, free: 1 }],
    ["NTH_HALF_PRICE", { type: "NTH_HALF_PRICE", n: 2 }, { n: 2 }],
    ["X_FOR_PRICE", { type: "X_FOR_PRICE", quantity: 2, totalCents: 500 }, { quantity: 2, totalCents: 500 }],
    ["PERCENT_OFF", { type: "PERCENT_OFF", percent: 25 }, { percent: 25 }],
    ["UNKNOWN", { type: "UNKNOWN", text: "Bonus Box" }, {}],
  ])("stores %s with its parameters", async (type, promotion, params) => {
    const offer = { ...base(), promotion, title: `Aanbieding ${type}` };
    expect(await saveOffer(db, { retailerId: target.id, adapter, offer, verdict, now: NOW })).toBe("created");
    const row = await db.offer.findFirstOrThrow({ where: { retailerId: target.id, title: offer.title } });
    expect(row).toMatchObject({ promoType: type, promoParams: params });
  });

  it("reports an update the second time and keeps unknown values null", async () => {
    const offer: NormalizedOffer = {
      ...base(),
      title: "Onbekend",
      currentPriceCents: null,
      regularPriceCents: null,
      validity: null,
      product: { ...base().product, externalId: "unknown", quantity: null, categorySlug: "bestaat-niet" },
    };
    const input = { retailerId: target.id, adapter, offer, verdict: { status: "UNVERIFIED" as const, confidence: 0.4, issues: [] }, now: NOW };
    expect(await saveOffer(db, input)).toBe("created");
    expect(await saveOffer(db, input)).toBe("updated");

    const row = await db.offer.findFirstOrThrow({ where: { retailerId: target.id, title: "Onbekend" }, include: { product: true } });
    expect(row).toMatchObject({ currentPriceCents: null, pricePerUnitCents: null, validFrom: null, validUntil: null, confidence: 0.4 });
    expect(row.product).toMatchObject({ unit: null, packageAmount: null, packageCount: 1, categoryId: null });
    expect(await db.priceHistory.count({ where: { productId: row.productId } })).toBe(0);
  });
});
