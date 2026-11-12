import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_PLAN_SETTINGS, type PlanSettings } from "@/domain/optimizer";
import { db } from "@/lib/db";
import { addItem, updateItem } from "@/server/lists";
import { buildPlan, type PlanView } from "@/server/plan";
import { createScratchRetailer } from "./support";

const TODAY = "2026-11-12";
type Scratch = Awaited<ReturnType<typeof createScratchRetailer>>;

let a: Scratch, b: Scratch, c: Scratch;
const ids: Record<string, string> = {};
const devices: string[] = [];
const defaults = { defaultListName: "Boodschappen" };

function device(): string {
  const id = randomUUID();
  devices.push(id);
  return id;
}

type NewProduct = { key: string; shop: Scratch; name: string; cents?: number; amount?: number; organic?: boolean };

async function add({ key, shop, name, cents, amount = 1000, organic = false }: NewProduct) {
  const product = await db.product.create({
    data: {
      retailerId: shop.id,
      externalId: key,
      name,
      normalizedName: name.toLowerCase(),
      unit: "ML",
      packageAmount: amount,
      isOrganic: organic,
    },
  });
  if (cents !== undefined) {
    await db.priceHistory.create({
      data: { productId: product.id, retailerId: shop.id, priceCents: cents, recordedAt: new Date() },
    });
  }
  ids[key] = product.id;
}

async function link(x: string, y: string, matchType: "SAME" | "SIMILAR" | "ALTERNATIVE", status = "AUTO" as const) {
  const [low, high] = [ids[x]!, ids[y]!].sort();
  await db.productMatch.create({
    data: { canonicalProductId: low!, candidateProductId: high!, matchType, confidence: 0.9, status },
  });
}

/** A device whose list holds the given products (by key) and typed items. */
async function listOf(entries: (string | { text: string } | { key: string; quantity: number })[]) {
  const deviceId = device();
  const itemIds: Record<string, string> = {};
  for (const entry of entries) {
    const input =
      typeof entry === "string"
        ? { productId: ids[entry]! }
        : "text" in entry
          ? { label: entry.text }
          : { productId: ids[entry.key]!, quantity: entry.quantity };
    const added = await addItem(db, deviceId, { ...defaults, ...input });
    if (!added.ok) throw new Error(`could not add ${JSON.stringify(entry)}: ${added.reason}`);
    itemIds[typeof entry === "string" ? entry : "text" in entry ? entry.text : entry.key] = added.value.itemId;
  }
  return { deviceId, itemIds };
}

const plan = async (deviceId: string, settings: Partial<PlanSettings> = {}) => {
  const view = await buildPlan(db, deviceId, { ...DEFAULT_PLAN_SETTINGS, ...settings }, TODAY);
  if (!view) throw new Error("no list");
  return view;
};

/** Item label → [chain slug, product bought, line total]. */
function lines(view: PlanView): Record<string, [string, string, number]> {
  const result: Record<string, [string, string, number]> = {};
  for (const stop of view.plan.stops) {
    for (const line of stop.lines) result[line.label] = [stop.retailerId, line.candidate.productId, line.totalCents];
  }
  return result;
}

describe("the plan for a shopping list", () => {
  beforeAll(async () => {
    [a, b, c] = await Promise.all([
      createScratchRetailer("plan-a"),
      createScratchRetailer("plan-b"),
      createScratchRetailer("plan-c"),
    ]);
    // Milk: picked at A; the same product at B, a very similar one at C, another size at C.
    await add({ key: "melkA", shop: a, name: "Planmelk merk 1 L", cents: 139 });
    await add({ key: "melkB", shop: b, name: "Planmelk merk 1 liter", cents: 129 });
    await add({ key: "melkC", shop: c, name: "Planmelk huismerk 1 L", cents: 99 });
    await add({ key: "melkGrootC", shop: c, name: "Planmelk huismerk 2 L", cents: 60, amount: 2000 });
    await link("melkA", "melkB", "SAME");
    await link("melkA", "melkC", "SIMILAR");
    await link("melkA", "melkGrootC", "ALTERNATIVE");
    // Coffee: A and B, B cheaper. A link waiting for review at C must not be used.
    await add({ key: "koffieA", shop: a, name: "Plankoffie 500 g", cents: 599 });
    await add({ key: "koffieB", shop: b, name: "Plankoffie 500 gram", cents: 549 });
    await add({ key: "koffieC", shop: c, name: "Plankoffie oplos 500 g", cents: 100 });
    await link("koffieA", "koffieB", "SAME");
    await link("koffieA", "koffieC", "SIMILAR", "NEEDS_REVIEW" as never);
    // Only at A.
    await add({ key: "zeepA", shop: a, name: "Planzeep 1 L", cents: 250 });
    // No price anywhere.
    await add({ key: "raadselA", shop: a, name: "Planraadsel 1 L" });
    // Typed items: "plankwark" names two listings as a word, and one only as part of a word.
    await add({ key: "kwarkA", shop: a, name: "Plankwark naturel 1 L", cents: 210 });
    await add({ key: "kwarkB", shop: b, name: "Plankwark 1 L", cents: 190, organic: true });
    await add({ key: "kwarktaartC", shop: c, name: "Plankwarktaart 1 L", cents: 50 });

    // A verified offer running today on A's coffee, and an unverified one on A's soap.
    const offer = (key: string, shop: Scratch, current: number, regular: number, verified: boolean) =>
      db.offer.create({
        data: {
          productId: ids[key]!,
          retailerId: shop.id,
          title: key,
          currentPriceCents: current,
          regularPriceCents: regular,
          validFrom: verified ? new Date("2026-11-10") : null,
          validUntil: verified ? new Date("2026-11-14") : null,
          status: verified ? "VERIFIED" : "UNVERIFIED",
          confidence: 1,
          sourceUrl: "https://example.test/offers",
          collectedAt: new Date("2026-11-11T08:00:00Z"),
          contentHash: key,
        },
      });
    await offer("koffieA", a, 499, 599, true);
    await offer("zeepA", a, 100, 250, false);
  });

  afterAll(async () => {
    await db.shoppingList.deleteMany({ where: { deviceId: { in: devices } } });
    // One after the other: parallel cascades over the same link rows can deadlock.
    for (const shop of [a, b, c]) await shop.remove();
  });

  it("is null for a device without a list", async () => {
    expect(await buildPlan(db, device(), DEFAULT_PLAN_SETTINGS, TODAY)).toBeNull();
  });

  it("buys a picked product as the cheapest of itself, the same product and a very similar one", async () => {
    const { deviceId } = await listOf(["melkA"]);
    const view = await plan(deviceId, { maxStores: 3 });
    expect(lines(view)).toEqual({ "Planmelk merk 1 L": [c.slug, ids.melkC, 99] });
    expect(view.picked).toEqual({ [view.plan.stops[0]!.lines[0]!.itemId]: ids.melkA });
    expect(view.plan.stops[0]!.lines[0]!.candidate.tier).toBe("SIMILAR");
    expect(view.retailers).toEqual({ [a.slug]: "Test plan-a", [b.slug]: "Test plan-b", [c.slug]: "Test plan-c" });
  });

  it("keeps to the same product when similar ones are not allowed", async () => {
    const { deviceId } = await listOf(["melkA"]);
    const view = await plan(deviceId, { maxStores: 3, similar: false });
    expect(lines(view)).toEqual({ "Planmelk merk 1 L": [b.slug, ids.melkB, 129] });
    expect(Object.keys(view.retailers).sort()).toEqual([a.slug, b.slug].sort());
  });

  it("never buys another size, however cheap", async () => {
    const { deviceId } = await listOf(["melkA"]);
    const view = await plan(deviceId, { maxStores: 3 });
    const candidates = view.plan.singleStores.map((store) => store.retailerId).sort();
    expect(candidates).toEqual([a.slug, b.slug, c.slug].sort());
    expect(view.plan.singleStores.find((store) => store.retailerId === c.slug)!.totalCents).toBe(99);
  });

  it("uses a verified running offer and ignores a link that waits for review", async () => {
    const { deviceId } = await listOf(["koffieA"]);
    const view = await plan(deviceId, { maxStores: 3 });
    expect(lines(view)).toEqual({ "Plankoffie 500 g": [a.slug, ids.koffieA, 499] });
    const line = view.plan.stops[0]!.lines[0]!;
    expect(line.usedOffer).toBe(true);
    expect(line.reason).toMatchObject({ code: "offer", savingCents: 100, daysLeft: 2 });
    expect(view.plan.offerSavingCents).toBe(100);
    expect(Object.keys(view.retailers)).not.toContain(c.slug);
  });

  it("never prices an unverified offer", async () => {
    const { deviceId } = await listOf(["zeepA"]);
    expect(lines(await plan(deviceId))).toEqual({ "Planzeep 1 L": [a.slug, ids.zeepA, 250] });
  });

  it("multiplies by the quantity on the list", async () => {
    const { deviceId } = await listOf([{ key: "melkA", quantity: 3 }]);
    const view = await plan(deviceId, { maxStores: 1 });
    expect(view.plan.totalCents).toBe(297);
    expect(view.plan.stops[0]!.lines[0]).toMatchObject({ quantity: 3, unitCents: 99 });
  });

  it("splits a list over the chains that are cheapest, up to the number allowed", async () => {
    const { deviceId } = await listOf(["melkA", "koffieA", "zeepA"]);
    const two = await plan(deviceId, { maxStores: 2 });
    // Soap is only at A, so A is in; C adds the cheap milk. Coffee stays at A on offer.
    expect(lines(two)).toEqual({
      "Planmelk merk 1 L": [c.slug, ids.melkC, 99],
      "Plankoffie 500 g": [a.slug, ids.koffieA, 499],
      "Planzeep 1 L": [a.slug, ids.zeepA, 250],
    });
    expect(two.plan.totalCents).toBe(848);
    expect(two.plan.comparison).toEqual({ retailerId: a.slug, totalCents: 888, savingCents: 40 });

    const one = await plan(deviceId, { maxStores: 1 });
    expect(one.plan.stops.map((stop) => stop.retailerId)).toEqual([a.slug]);
    expect(one.plan.totalCents).toBe(888);
    expect(one.plan.comparison).toBeNull();
  });

  it("keeps a pinned item at its chain and names the chain when it has nothing", async () => {
    const { deviceId, itemIds } = await listOf(["melkA", "zeepA"]);
    expect((await updateItem(db, deviceId, itemIds.melkA!, { pinnedRetailerSlug: b.slug })).ok).toBe(true);
    expect((await updateItem(db, deviceId, itemIds.zeepA!, { pinnedRetailerSlug: c.slug })).ok).toBe(true);
    const view = await plan(deviceId, { maxStores: 3 });
    expect(lines(view)).toEqual({ "Planmelk merk 1 L": [b.slug, ids.melkB, 129] });
    expect(view.plan.stops[0]!.lines[0]!.reason).toEqual({ code: "pinned" });
    expect(view.plan.missing).toEqual([{ itemId: itemIds.zeepA, label: "Planzeep 1 L", reason: "pinned-unavailable" }]);
    expect(view.pins).toEqual({ [itemIds.melkA!]: b.slug, [itemIds.zeepA!]: c.slug });
    expect(view.retailers[c.slug]).toBe("Test plan-c");
  });

  it("leaves ticked items out of the plan", async () => {
    const { deviceId, itemIds } = await listOf(["melkA", "zeepA"]);
    await updateItem(db, deviceId, itemIds.zeepA!, { checked: true });
    const view = await plan(deviceId);
    expect(view).toMatchObject({ itemCount: 2, openCount: 1 });
    expect(Object.keys(lines(view))).toEqual(["Planmelk merk 1 L"]);

    await updateItem(db, deviceId, itemIds.melkA!, { checked: true });
    const empty = await plan(deviceId);
    expect(empty).toMatchObject({ itemCount: 2, openCount: 0, isDemo: false });
    expect(empty.plan).toMatchObject({ stops: [], totalCents: 0, missing: [] });
  });

  it("reports a product without a price, and one nobody sells, as not found", async () => {
    const { deviceId, itemIds } = await listOf(["raadselA", { text: "planzzznietbestaand" }]);
    const view = await plan(deviceId);
    expect(view.plan.stops).toEqual([]);
    expect(view.plan.missing).toEqual([
      { itemId: itemIds.raadselA, label: "Planraadsel 1 L", reason: "not-found" },
      { itemId: itemIds.planzzznietbestaand, label: "planzzznietbestaand", reason: "not-found" },
    ]);
  });

  it("buys a typed item as the cheapest listing that has the word, not one that only contains it", async () => {
    const { deviceId, itemIds } = await listOf([{ text: "plankwark" }]);
    const view = await plan(deviceId, { maxStores: 3 });
    expect(lines(view)).toEqual({ plankwark: [b.slug, ids.kwarkB, 190] });
    expect(view.picked[itemIds.plankwark!]).toBeUndefined();
    expect(view.plan.singleStores.map((store) => store.retailerId).sort()).toEqual([a.slug, b.slug].sort());
  });

  it("falls back to a looser match for a typed item when no name has the word", async () => {
    const { deviceId } = await listOf([{ text: "plankwarktaar" }]);
    expect(lines(await plan(deviceId))).toEqual({ plankwarktaar: [c.slug, ids.kwarktaartC, 50] });
  });

  it("applies the filters: offers only, organic only", async () => {
    const { deviceId, itemIds } = await listOf(["koffieA", "melkA", { text: "plankwark" }]);
    const offers = await plan(deviceId, { mode: "offers-only" });
    expect(lines(offers)).toEqual({ "Plankoffie 500 g": [a.slug, ids.koffieA, 499] });
    expect(offers.plan.missing.map((item) => [item.itemId, item.reason])).toEqual([
      [itemIds.melkA, "filtered"],
      [itemIds.plankwark, "filtered"],
    ]);

    const organic = await plan(deviceId, { mode: "organic-only" });
    expect(lines(organic)).toEqual({ plankwark: [b.slug, ids.kwarkB, 190] });
  });

  it("reports how far the total is over a budget", async () => {
    const { deviceId } = await listOf(["zeepA"]);
    expect((await plan(deviceId, { budgetCents: 200 })).plan.overBudgetCents).toBe(50);
    expect((await plan(deviceId, { budgetCents: 250 })).plan.overBudgetCents).toBeNull();
  });

  it("drops the listings of a chain that was switched off", async () => {
    const { deviceId } = await listOf(["melkA"]);
    await db.retailer.update({ where: { id: c.id }, data: { active: false } });
    try {
      expect(lines(await plan(deviceId, { maxStores: 3 }))).toEqual({ "Planmelk merk 1 L": [b.slug, ids.melkB, 129] });
    } finally {
      await db.retailer.update({ where: { id: c.id }, data: { active: true } });
    }
  });

  it("only ever reads the list of the device that asks", async () => {
    const mine = await listOf(["melkA"]);
    const theirs = await listOf(["zeepA"]);
    expect(Object.keys(lines(await plan(mine.deviceId)))).toEqual(["Planmelk merk 1 L"]);
    expect(Object.keys(lines(await plan(theirs.deviceId)))).toEqual(["Planzeep 1 L"]);
  });
});
