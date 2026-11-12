import { describe, expect, it, vi } from "vitest";
import { addDays } from "@/lib/dates";
import type { AdapterContext, NormalizedOffer, RawOffer } from "../../adapter";
import { DEMO_OFFERS, DEMO_PRODUCTS, DEMO_SOURCE_URL, isDemoOfferListed } from "./catalogue";
import { formatValidity } from "./format";
import { MOCK_ADAPTERS, mockAh, mockDirk, mockJumbo, mockVomar } from "./index";

function context(today = "2026-11-11") {
  const get = vi.fn(async () => {
    throw new Error("mock adapters make no requests");
  });
  const ctx: AdapterContext = { http: { get }, today, now: new Date(`${today}T08:00:00Z`) };
  return { ctx, get };
}

async function collect(adapter: (typeof MOCK_ADAPTERS)[number], ctx: AdapterContext) {
  return [...(await adapter.fetchOffers(ctx)), ...(await adapter.fetchUpcomingOffers(ctx))];
}

function normalizeAll(adapter: (typeof MOCK_ADAPTERS)[number], raws: RawOffer[], ctx: AdapterContext) {
  return raws.map((raw) => {
    const result = adapter.normalizeOffer(raw, ctx);
    if (!result.ok) throw new Error(`${adapter.id} could not normalise ${JSON.stringify(raw.payload)}: ${result.reason}`);
    return result.value;
  });
}

describe("mock adapters", () => {
  it("cover the four chains with mock ids", () => {
    expect(MOCK_ADAPTERS.map((a) => [a.id, a.retailerSlug, a.isMock])).toEqual([
      ["mock:ah", "ah", true],
      ["mock:jumbo", "jumbo", true],
      ["mock:vomar", "vomar", true],
      ["mock:dirk", "dirk", true],
    ]);
  });

  describe.each(MOCK_ADAPTERS.map((adapter) => [adapter.id, adapter] as const))("%s", (_, adapter) => {
    const catalogue = DEMO_OFFERS.filter((offer) => offer.retailer === adapter.retailerSlug);

    it.each(["2026-11-11", "2026-12-29", "2027-01-02", "2028-02-27"])(
      "normalises every raw offer it emits with ok: true (today %s)",
      async (today) => {
        const { ctx, get } = context(today);
        const raws = await collect(adapter, ctx);
        expect(raws.length).toBe(catalogue.filter(isDemoOfferListed).length);
        expect(normalizeAll(adapter, raws, ctx)).toHaveLength(raws.length);
        expect(get).not.toHaveBeenCalled();
      },
    );

    it("reproduces the catalogue: prices, mechanic, validity, product and provenance", async () => {
      const { ctx } = context();
      const offers = normalizeAll(adapter, await collect(adapter, ctx), ctx);
      for (const demo of catalogue.filter(isDemoOfferListed)) {
        const offer = offers.find((candidate) => candidate.dedupeKey === demo.key) as NormalizedOffer;
        const product = DEMO_PRODUCTS.find((candidate) => candidate.concept === demo.concept)!;
        const variant = product.variants[demo.retailer]!;
        const { promoType } = demo;
        expect(offer, demo.key).toBeDefined();
        expect(offer.title).toBe(variant.name);
        expect(offer.kind).toBe(demo.kind ?? "WEEKLY");
        expect(offer.regularPriceCents).toBe(variant.regularCents);
        expect(offer.currentPriceCents).toBe("currentCents" in demo ? demo.currentCents : null);
        expect(offer.promotion).toEqual({ type: promoType, ...("promoParams" in demo ? demo.promoParams : {}) });
        expect(offer.promoDescription).toBe(demo.promoDescription ?? null);
        expect(offer.conditions).toBe(demo.conditions ?? null);
        expect(offer.validity).toEqual(
          demo.untilOffset === null
            ? null
            : {
                start: demo.fromOffset === null ? null : addDays(ctx.today, demo.fromOffset),
                end: addDays(ctx.today, demo.untilOffset),
                approximate: false,
              },
        );
        expect(offer.sourceUrl).toBe(DEMO_SOURCE_URL);
        expect(offer.product).toEqual({
          externalId: `demo-${demo.concept}`,
          name: variant.name,
          brand: product.brand ?? null,
          ean: product.ean ?? null,
          quantity: {
            amount: product.packageAmount,
            unit: { G: "g", ML: "ml", PIECE: "piece" }[product.unit],
            count: product.packageCount ?? 1,
            totalAmount: product.packageAmount * (product.packageCount ?? 1),
            approximate: false,
          },
          categorySlug: product.category,
          isOrganic: product.isOrganic ?? false,
          attributes: product.attributes ?? {},
        });
        expect(offer.rawPayload).toMatchObject({ key: demo.key, concept: demo.concept });
      }
    });

    it("keeps the same dedupe keys on a later day", async () => {
      const first = context("2026-11-11");
      const later = context("2026-11-12");
      const keys = (offers: NormalizedOffer[]) => offers.map((offer) => offer.dedupeKey).sort();
      expect(keys(normalizeAll(adapter, await collect(adapter, later.ctx), later.ctx))).toEqual(
        keys(normalizeAll(adapter, await collect(adapter, first.ctx), first.ctx)),
      );
    });

    it("lists no stores", async () => {
      expect(await adapter.fetchStoreLocations(context().ctx)).toEqual([]);
    });
  });

  it("splits running and upcoming offers on the run day and never emits an expired one", async () => {
    const { ctx } = context();
    const keys = (raws: RawOffer[]) => raws.map((raw) => raw.payload.key);
    expect(keys(await mockJumbo.fetchUpcomingOffers(ctx))).toEqual(["jumbo-koffie-2e-halve", "jumbo-luiers"]);
    expect(keys(await mockJumbo.fetchOffers(ctx))).toEqual([
      "jumbo-wasmiddel-2voor",
      "jumbo-eieren-onbekend",
      "jumbo-brood",
    ]);
    expect(keys([...(await mockAh.fetchOffers(ctx)), ...(await mockAh.fetchUpcomingOffers(ctx))])).not.toContain(
      "ah-appels-verlopen",
    );
  });

  it("writes Dutch page text in each chain's style", async () => {
    const { ctx } = context();
    const find = async (adapter: typeof mockAh, key: string) =>
      (await collect(adapter, ctx)).find((raw) => raw.payload.key === key)!.payload;

    expect(await find(mockDirk, "dirk-kipfilet")).toMatchObject({
      name: "Kipfilet 500 g",
      size: "500 g",
      price: "349",
      regularPrice: "499",
      promotion: "",
      validity: "ma 9 t/m zo 15 nov",
    });
    expect(await find(mockAh, "ah-yoghurt-1plus1")).toMatchObject({
      price: "",
      regularPrice: "2,19",
      promotion: "1+1 gratis",
    });
    expect(await find(mockAh, "ah-cola-25")).toMatchObject({ size: "6 x 330 ml", price: "2,99", promotion: "25% korting" });
    expect(await find(mockVomar, "vomar-bananen-dag")).toMatchObject({
      price: "99",
      regularPrice: "159",
      badge: "Dagknaller",
      validity: "alleen vandaag",
      kind: "DAILY",
    });
    expect(await find(mockVomar, "vomar-melk")).toMatchObject({ validity: "geldig van zo 8 t/m za 14 nov" });
    expect(await find(mockJumbo, "jumbo-eieren-onbekend")).toMatchObject({ size: "10 stuks", validity: "" });
    expect(await find(mockJumbo, "jumbo-luiers")).toMatchObject({ conditions: "Maximaal 4 per klant" });
  });

  it("keeps an unreadable value unknown instead of guessing", () => {
    const { ctx } = context();
    const raw: RawOffer = {
      sourceUrl: DEMO_SOURCE_URL,
      payload: {
        key: "x",
        concept: "x",
        name: "Iets",
        size: "386-410 gram",
        price: "ca. 3",
        regularPrice: "",
        promotion: "Bonus Box",
        validity: "tot zondag",
        kind: "WEEKLY",
      },
    };
    const result = mockAh.normalizeOffer(raw, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      currentPriceCents: null,
      regularPriceCents: null,
      validity: null,
      promotion: { type: "UNKNOWN", text: "Bonus Box" },
      product: { quantity: null, brand: null, ean: null, categorySlug: null, attributes: {} },
    });
  });

  it("fails an offer without a name, a concept or a known kind", () => {
    const { ctx } = context();
    const base = { key: "x", concept: "x", name: "Iets", kind: "WEEKLY" };
    expect(mockAh.normalizeOffer({ sourceUrl: DEMO_SOURCE_URL, payload: { ...base, name: "" } }, ctx)).toEqual({
      ok: false,
      reason: "name-missing",
    });
    expect(mockAh.normalizeOffer({ sourceUrl: DEMO_SOURCE_URL, payload: { ...base, concept: null } }, ctx)).toEqual({
      ok: false,
      reason: "concept-missing",
    });
    expect(mockAh.normalizeOffer({ sourceUrl: DEMO_SOURCE_URL, payload: { ...base, kind: "MONTHLY" } }, ctx)).toEqual({
      ok: false,
      reason: "kind-unrecognised",
    });
  });
});

describe("formatValidity", () => {
  it("writes the month on both sides when the range crosses a month", () => {
    expect(formatValidity({ today: "2026-11-27", fromOffset: 0, untilOffset: 6 })).toBe("vr 27 nov t/m do 3 dec");
  });

  it("writes an end-only validity, a single day and an unknown one", () => {
    expect(formatValidity({ today: "2026-11-11", fromOffset: null, untilOffset: 6 })).toBe("t/m di 17 nov");
    expect(formatValidity({ today: "2026-11-11", fromOffset: 2, untilOffset: 2 })).toBe("vr 13 nov");
    expect(formatValidity({ today: "2026-11-11", fromOffset: 0, untilOffset: 0 })).toBe("alleen vandaag");
    expect(formatValidity({ today: "2026-11-11", fromOffset: null, untilOffset: null })).toBe("");
  });
});
