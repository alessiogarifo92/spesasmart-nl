import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { chainSources } from "@/server/sources";
import { createScratchRetailer } from "./support";

const NOW = new Date("2026-11-12T10:00:00Z");
type Scratch = Awaited<ReturnType<typeof createScratchRetailer>>;
let real: Scratch, demo: Scratch, mixed: Scratch, ended: Scratch, hidden: Scratch;

async function offer(
  shop: Scratch,
  key: string,
  data: { isDemo: boolean; validUntil: string | null; collectedAt?: Date },
) {
  const product = await db.product.upsert({
    where: { retailerId_externalId: { retailerId: shop.id, externalId: "p" } },
    create: { retailerId: shop.id, externalId: "p", name: "Testproduct", normalizedName: "testproduct" },
    update: {},
  });
  await db.offer.create({
    data: {
      retailerId: shop.id,
      productId: product.id,
      title: "Testproduct",
      sourceUrl: "https://example.test/offers",
      collectedAt: data.collectedAt ?? NOW,
      contentHash: key,
      rawPayload: {},
      confidence: 1,
      isDemo: data.isDemo,
      validUntil: data.validUntil === null ? null : new Date(`${data.validUntil}T00:00:00Z`),
    },
  });
}

beforeAll(async () => {
  [real, demo, mixed, ended, hidden] = await Promise.all(
    ["src-real", "src-demo", "src-mixed", "src-ended", "src-hidden"].map(createScratchRetailer),
  );
  await offer(real, "a", { isDemo: false, validUntil: "2026-11-14", collectedAt: new Date("2026-11-11T06:00:00Z") });
  await offer(real, "b", { isDemo: false, validUntil: null, collectedAt: new Date("2026-11-12T06:00:00Z") });
  await offer(demo, "a", { isDemo: true, validUntil: "2026-11-12" });
  await offer(mixed, "a", { isDemo: true, validUntil: "2026-11-20" });
  await offer(mixed, "b", { isDemo: false, validUntil: "2026-11-20" });
  await offer(ended, "a", { isDemo: false, validUntil: "2026-11-11" });
  await offer(hidden, "a", { isDemo: false, validUntil: "2026-11-20" });
  await db.retailer.update({ where: { id: hidden.id }, data: { active: false } });
});

afterAll(async () => {
  await Promise.all([real, demo, mixed, ended, hidden].map((shop) => shop.remove()));
});

describe("chainSources", () => {
  it("tells real, demo, mixed and empty chains apart, counting running offers only", async () => {
    const sources = await chainSources(db, NOW);
    const of = (shop: Scratch) => sources.find((source) => source.slug === shop.slug);
    expect(of(real)).toMatchObject({ kind: "real", lastCollectedAt: new Date("2026-11-12T06:00:00Z") });
    expect(of(demo)).toMatchObject({ kind: "demo", lastCollectedAt: null });
    expect(of(mixed)).toMatchObject({ kind: "mixed", lastCollectedAt: NOW });
    expect(of(ended)).toMatchObject({ kind: "none", lastCollectedAt: null });
  });

  it("leaves out a chain that is switched off, and sorts by name", async () => {
    const sources = await chainSources(db, NOW);
    expect(sources.some((source) => source.slug === hidden.slug)).toBe(false);
    const names = sources.map((source) => source.name);
    expect(names).toEqual([...names].sort((x, y) => x.localeCompare(y)));
  });
});
