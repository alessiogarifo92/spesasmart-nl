import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { createScratchRetailer } from "./support";

let retailer: Awaited<ReturnType<typeof createScratchRetailer>>;
let productId: string;
let otherProductId: string;
let sequence = 0;

function offer(overrides: Partial<Prisma.OfferUncheckedCreateInput> = {}): Prisma.OfferUncheckedCreateInput {
  sequence += 1;
  return {
    productId,
    retailerId: retailer.id,
    title: "Testaanbieding",
    currentPriceCents: 199,
    sourceUrl: "test:constraints",
    collectedAt: new Date("2026-11-11T08:00:00Z"),
    contentHash: `hash-${sequence}`,
    ...overrides,
  };
}

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("database constraints", () => {
  beforeAll(async () => {
    retailer = await createScratchRetailer("constraints");
    const product = await db.product.create({
      data: { retailerId: retailer.id, externalId: "p1", name: "Testproduct", normalizedName: "testproduct" },
    });
    const other = await db.product.create({
      data: { retailerId: retailer.id, externalId: "p2", name: "Ander product", normalizedName: "ander product" },
    });
    productId = product.id;
    otherProductId = other.id;
  });

  afterAll(async () => {
    await db.favorite.deleteMany({ where: { deviceId: { startsWith: "test-constraints-" } } });
    await db.shoppingList.deleteMany({ where: { deviceId: { startsWith: "test-constraints-" } } });
    await retailer.remove();
    await db.$disconnect();
  });

  describe("offers", () => {
    it("defaults to unverified with zero confidence", async () => {
      const created = await db.offer.create({ data: offer() });
      expect(created).toMatchObject({ status: "UNVERIFIED", confidence: 0, isDemo: false, kind: "WEEKLY" });
      expect(created.validUntil).toBeNull();
    });

    it("refuses the same content twice for one retailer", async () => {
      await db.offer.create({ data: offer({ contentHash: "duplicate" }) });
      await expect(db.offer.create({ data: offer({ contentHash: "duplicate" }) })).rejects.toThrow();
    });

    it("refuses a verified offer without an end date", async () => {
      await expect(db.offer.create({ data: offer({ status: "VERIFIED" }) })).rejects.toThrow(
        /offers_verified_needs_validity/,
      );
      await expect(
        db.offer.create({ data: offer({ status: "VERIFIED", validUntil: day("2026-11-15") }) }),
      ).resolves.toMatchObject({ status: "VERIFIED" });
    });

    it("refuses validity that ends before it starts", async () => {
      await expect(
        db.offer.create({ data: offer({ validFrom: day("2026-11-15"), validUntil: day("2026-11-14") }) }),
      ).rejects.toThrow(/offers_validity_order/);
    });

    it("accepts a one-day offer", async () => {
      await expect(
        db.offer.create({
          data: offer({ kind: "DAILY", validFrom: day("2026-11-11"), validUntil: day("2026-11-11") }),
        }),
      ).resolves.toMatchObject({ kind: "DAILY" });
    });

    it("refuses negative prices and confidence outside 0–1", async () => {
      await expect(db.offer.create({ data: offer({ currentPriceCents: -1 }) })).rejects.toThrow(
        /offers_current_price_non_negative/,
      );
      await expect(db.offer.create({ data: offer({ regularPriceCents: -5 }) })).rejects.toThrow(
        /offers_regular_price_non_negative/,
      );
      await expect(db.offer.create({ data: offer({ confidence: 1.2 }) })).rejects.toThrow(/offers_confidence_range/);
      await expect(db.offer.create({ data: offer({ confidence: -0.1 }) })).rejects.toThrow(/offers_confidence_range/);
    });

    it("stores an unknown price as null rather than a number", async () => {
      const created = await db.offer.create({ data: offer({ currentPriceCents: null, promoType: "UNKNOWN" }) });
      expect(created.currentPriceCents).toBeNull();
      expect(created.pricePerUnitCents).toBeNull();
    });

    it("keeps the raw payload and provenance", async () => {
      const created = await db.offer.create({
        data: offer({ rawPayload: { title: "Kipfilet", price: "3,49" }, sourceUrl: "https://example.test/offers" }),
      });
      expect(created.rawPayload).toEqual({ title: "Kipfilet", price: "3,49" });
      expect(created.sourceUrl).toBe("https://example.test/offers");
      expect(created.collectedAt.toISOString()).toBe("2026-11-11T08:00:00.000Z");
    });
  });

  describe("products", () => {
    it("refuses the same source identifier twice for one retailer", async () => {
      await expect(
        db.product.create({
          data: { retailerId: retailer.id, externalId: "p1", name: "Dubbel", normalizedName: "dubbel" },
        }),
      ).rejects.toThrow();
    });

    it("requires unit and package size together", async () => {
      const base = { retailerId: retailer.id, name: "Half", normalizedName: "half" };
      await expect(db.product.create({ data: { ...base, externalId: "u1", unit: "G" } })).rejects.toThrow(
        /products_unit_with_amount/,
      );
      await expect(db.product.create({ data: { ...base, externalId: "u2", packageAmount: 500 } })).rejects.toThrow(
        /products_unit_with_amount/,
      );
      await expect(
        db.product.create({ data: { ...base, externalId: "u3", unit: "G", packageAmount: 0 } }),
      ).rejects.toThrow(/products_package_amount_positive/);
    });
  });

  describe("product matches", () => {
    it("refuses a product matched with itself, duplicates and confidence outside 0–1", async () => {
      const match = { canonicalProductId: productId, candidateProductId: otherProductId, matchType: "SAME" as const };
      await expect(
        db.productMatch.create({ data: { ...match, candidateProductId: productId, confidence: 1 } }),
      ).rejects.toThrow(/product_matches_distinct_products/);
      await expect(db.productMatch.create({ data: { ...match, confidence: 1.5 } })).rejects.toThrow(
        /product_matches_confidence_range/,
      );
      await expect(db.productMatch.create({ data: { ...match, confidence: 0.9 } })).resolves.toMatchObject({
        status: "AUTO",
      });
      await expect(db.productMatch.create({ data: { ...match, confidence: 0.8 } })).rejects.toThrow();
    });
  });

  describe("lists and favourites", () => {
    it("refuses a list item with a quantity below one and removes items with their list", async () => {
      const list = await db.shoppingList.create({ data: { deviceId: "test-constraints-a", name: "Week" } });
      await expect(
        db.shoppingListItem.create({ data: { listId: list.id, label: "melk", quantity: 0 } }),
      ).rejects.toThrow(/shopping_list_items_quantity_positive/);
      const item = await db.shoppingListItem.create({ data: { listId: list.id, label: "melk", productId } });
      await db.shoppingList.delete({ where: { id: list.id } });
      expect(await db.shoppingListItem.findUnique({ where: { id: item.id } })).toBeNull();
    });

    it("requires a favourite to point at exactly one product or offer", async () => {
      const deviceId = "test-constraints-b";
      await expect(db.favorite.create({ data: { deviceId } })).rejects.toThrow(/favorites_exactly_one_target/);
      const created = await db.offer.create({ data: offer() });
      await expect(db.favorite.create({ data: { deviceId, productId, offerId: created.id } })).rejects.toThrow(
        /favorites_exactly_one_target/,
      );
      await db.favorite.create({ data: { deviceId, productId } });
      await expect(db.favorite.create({ data: { deviceId, productId } })).rejects.toThrow();
    });
  });

  describe("history and runs", () => {
    it("refuses a negative recorded price", async () => {
      await expect(
        db.priceHistory.create({ data: { productId, retailerId: retailer.id, priceCents: -1 } }),
      ).rejects.toThrow(/price_history_price_non_negative/);
    });

    it("records a run that starts as running with no errors", async () => {
      const run = await db.ingestionRun.create({ data: { retailerId: retailer.id, adapter: "test:constraints" } });
      expect(run).toMatchObject({ status: "RUNNING", itemsFound: 0, itemsUpdated: 0, errors: [] });
      await db.ingestionRun.delete({ where: { id: run.id } });
    });
  });
});
