import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { AdapterContext, NormalizedOffer, RawOffer } from "../../adapter";
import { isAllowed, parseRobots } from "../../robots";
import { validateOffer } from "../../validate";
import { DIRK_OFFERS_URL, dirkAdapter, readDirkPrice } from "./index";
import { parseDirkOffers } from "./parse";

// A reduced copy of the real page, captured once on 2026-11-12 (see docs/ingestion.md).
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const html = fixture("offers.html");
const TODAY = "2026-11-12";

function ctx(get: AdapterContext["http"]["get"] = vi.fn(), today = TODAY): AdapterContext {
  return { http: { get }, today, now: new Date("2026-11-12T08:00:00Z") };
}

const raws = parseDirkOffers(html, DIRK_OFFERS_URL);
const byId = (id: string) => raws.find((raw) => raw.payload.productId === id)!;
function normalize(raw: RawOffer, context = ctx()): NormalizedOffer {
  const result = dirkAdapter.normalizeOffer(raw, context);
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

describe("readDirkPrice", () => {
  it.each([
    ["1", "99", true, 199],
    ["14", "21", true, 1421],
    ["5", "00", true, 500],
    ["99", null, false, 99],
    ["78", null, false, 78],
    ["5", null, false, 5],
  ])("reads %j + %j (euros: %j) as %i cents", (large, small, hasEuros, cents) => {
    expect(readDirkPrice(large, small, hasEuros)).toBe(cents);
  });

  it.each([
    [null, null, false],
    ["1", null, true],
    ["1", "9", true],
    ["1", "999", true],
    ["199", null, false],
    ["99", "50", false],
    ["0", null, false],
    ["1,99", null, false],
    ["gratis", null, false],
  ])("does not guess a price from %j + %j (euros: %j)", (large, small, hasEuros) => {
    expect(readDirkPrice(large, small, hasEuros)).toBeNull();
  });
});

describe("parseDirkOffers", () => {
  it("reads every card once, in page order", () => {
    expect(raws.map((raw) => raw.payload.productId)).toEqual([
      "100968",
      "140443",
      "4595",
      "55252",
      "127340",
      "103911",
      "6",
      "125827",
      "140466",
      "92769",
      "140514",
      "140494",
    ]);
  });

  it("takes the text of a card and the week's end from the header", () => {
    expect(byId("100968")).toEqual({
      sourceUrl:
        "https://www.dirk.nl/boodschappen/aardappelen-groente-fruit/aardappelen/1%20de%20beste%20verse%20frites/100968",
      payload: {
        productId: "100968",
        title: "1 de Beste Verse frites",
        subtitle: "1 kg",
        label: "VR, ZA & ZO actie",
        regularPrice: "2.39",
        priceLarge: "1",
        priceSmall: "99",
        hasEuros: true,
        category: "Aardappelen, groente & fruit",
        weekEnd: "di 17 november",
      },
    });
  });

  it("reads a price under one euro as cents alone", () => {
    expect(byId("4595").payload).toMatchObject({
      priceLarge: "78",
      priceSmall: null,
      hasEuros: false,
      regularPrice: "0.98",
    });
  });

  it("uses the page itself as source for a card without a link", () => {
    expect(byId("140443").sourceUrl).toBe(DIRK_OFFERS_URL);
  });

  it("reads cards without a label or without a regular price", () => {
    expect(byId("55252").payload).toMatchObject({ label: null, regularPrice: "1.79" });
    expect(byId("140514").payload).toMatchObject({ label: "ACTIE", regularPrice: null });
  });

  it("keeps no image, markup or script", () => {
    expect(JSON.stringify(raws)).not.toMatch(/<|\.(?:jpe?g|png|webp|svg)\b/i);
  });

  it("skips cards without id or title, keeps a repeated product once, refuses foreign links", () => {
    const card = (id: string, title: string, href = "") =>
      `<article data-product-id="${id}"><a class="top" ${href}></a><div class="price"><span class="price-large">99</span></div>` +
      `<a class="bottom"><p class="title">${title}</p></a></article>`;
    const page =
      card("1", "Eerste", 'href="https://evil.example/x/1"') +
      card("1", "Dubbel") +
      card("", "Zonder id") +
      card("3", " ");
    const parsed = parseDirkOffers(page, DIRK_OFFERS_URL);
    expect(parsed.map((raw) => raw.payload.title)).toEqual(["Eerste"]);
    expect(parsed[0]!.sourceUrl).toBe(DIRK_OFFERS_URL);
    expect(parsed[0]!.payload.weekEnd).toBeNull();
  });

  it("returns nothing when the page has no cards, or cards without names", () => {
    expect(parseDirkOffers("<html><body>Onderhoud</body></html>", DIRK_OFFERS_URL)).toEqual([]);
    const unnamed =
      '<article data-product-id="1"><div class="price"><span class="price-large">99</span></div></article>';
    expect(parseDirkOffers(unnamed, DIRK_OFFERS_URL)).toEqual([]);
  });
});

describe("dirkAdapter.normalizeOffer", () => {
  it("stores offer price, regular price, size and the week's end date", () => {
    const offer = normalize(byId("103911"));
    expect(offer).toMatchObject({
      title: "1 de Beste Aardappelen kruimig",
      kind: "WEEKLY",
      promotion: { type: "PRICE_CUT" },
      promoDescription: "ACTIE",
      currentPriceCents: 249,
      regularPriceCents: 349,
      validity: { start: null, end: "2026-11-17", approximate: false },
      conditions: null,
      dedupeKey: "product:103911:2026-11-17",
      product: { externalId: "103911", brand: null, ean: null, quantity: { amount: 3000, unit: "g", count: 1 } },
    });
    expect(validateOffer(offer, { today: TODAY })).toEqual({ status: "VERIFIED", confidence: 1, issues: [] });
  });

  it.each([
    ["4595", 78, 98],
    ["140494", 49, 95],
    ["100968", 199, 239],
    ["6", 1421, 1895],
    ["92769", 599, 1199],
  ])("reads the prices of %s as %i and %i cents", (id, current, regular) => {
    expect(normalize(byId(id))).toMatchObject({ currentPriceCents: current, regularPriceCents: regular });
  });

  it("leaves the regular price empty when the card has none", () => {
    const offer = normalize(byId("140514"));
    expect(offer).toMatchObject({ currentPriceCents: 999, regularPriceCents: null });
    expect(validateOffer(offer, { today: TODAY }).issues).toContain("regular-price-unknown");
  });

  it("dates a weekend offer on the Friday to Sunday of the week", () => {
    expect(normalize(byId("100968")).validity).toEqual({ start: "2026-11-13", end: "2026-11-15", approximate: false });
    expect(normalize(byId("127340")).validity).toEqual({ start: "2026-11-13", end: "2026-11-15", approximate: false });
    // Also when the page's week ends on the Sunday itself.
    const sunday = normalize({
      sourceUrl: DIRK_OFFERS_URL,
      payload: { ...byId("100968").payload, weekEnd: "zo 15 november" },
    });
    expect(sunday.validity).toEqual({ start: "2026-11-13", end: "2026-11-15", approximate: false });
  });

  it("reads a multi-pack size and leaves a size it cannot read unknown", () => {
    expect(normalize(byId("6")).product.quantity).toMatchObject({ amount: 300, unit: "ml", count: 24 });
    expect(normalize(byId("55252")).product.quantity).toMatchObject({ amount: 1, unit: "piece" });
    // "Zak 250 gram of schaal 500 gram." names two sizes; "Pak 26 - 56 stuks" a range.
    expect(normalize(byId("140443")).product.quantity).toBeNull();
    expect(normalize(byId("140514")).product.quantity).toBeNull();
  });

  it("records OP=OP as a condition", () => {
    expect(normalize(byId("140466")).conditions).toBe("OP=OP");
    expect(normalize(byId("140514")).conditions).toBe("OP=OP");
  });

  it("stores an offer whose price it cannot read without a price, as unverified", () => {
    const raw: RawOffer = {
      sourceUrl: DIRK_OFFERS_URL,
      payload: { ...byId("103911").payload, priceLarge: "2", priceSmall: null },
    };
    const offer = normalize(raw);
    expect(offer.currentPriceCents).toBeNull();
    expect(validateOffer(offer, { today: TODAY }).status).toBe("UNVERIFIED");
  });

  it("leaves validity unknown without a readable header date", () => {
    for (const weekEnd of [null, "binnenkort", "wo 17 november"]) {
      const offer = normalize({ sourceUrl: DIRK_OFFERS_URL, payload: { ...byId("103911").payload, weekEnd } });
      expect(offer.validity).toBeNull();
      expect(offer.dedupeKey).toBe("product:103911:unknown");
      expect(validateOffer(offer, { today: TODAY }).status).toBe("UNVERIFIED");
    }
  });

  it("takes the year of the end date from the run day", () => {
    const offer = normalize(
      { sourceUrl: DIRK_OFFERS_URL, payload: { ...byId("103911").payload, weekEnd: "di 5 januari" } },
      ctx(vi.fn(), "2026-12-30"),
    );
    expect(offer.validity).toEqual({ start: null, end: "2027-01-05", approximate: false });
  });

  it("marks organic products by their name", () => {
    const named = (title: string) =>
      normalize({ sourceUrl: DIRK_OFFERS_URL, payload: { ...byId("103911").payload, title } });
    expect(named("Biologische halfvolle melk").product.isOrganic).toBe(true);
    expect(named("Bio+ eieren").product.isOrganic).toBe(true);
    expect(named("Biogarde yoghurt").product.isOrganic).toBe(false);
    expect(normalize(byId("103911")).product.isOrganic).toBe(false);
  });

  it.each([
    [{ title: "Iets" }, "id-missing"],
    [{ productId: "1", title: " " }, "title-missing"],
  ])("refuses %j", (payload, reason) => {
    expect(dirkAdapter.normalizeOffer({ sourceUrl: DIRK_OFFERS_URL, payload }, ctx())).toEqual({ ok: false, reason });
    expect(dirkAdapter.normalizeProduct({ sourceUrl: DIRK_OFFERS_URL, payload }, ctx())).toEqual({ ok: false, reason });
  });
});

describe("dirkAdapter", () => {
  it("is a real adapter limited to one run a day", () => {
    expect(dirkAdapter).toMatchObject({ id: "dirk", retailerSlug: "dirk", isMock: false, maxRunsPerDay: 1 });
  });

  it("makes one request, to the offers page, and nothing else", async () => {
    const get = vi.fn(async (url: string) => ({ status: 200, url, text: html }));
    const context = ctx(get);
    expect(await dirkAdapter.fetchOffers(context)).toHaveLength(12);
    expect(await dirkAdapter.fetchUpcomingOffers(context)).toEqual([]);
    expect(await dirkAdapter.fetchStoreLocations(context)).toEqual([]);
    expect(get.mock.calls).toEqual([[DIRK_OFFERS_URL]]);
  });

  it("fails the fetch when no named offer is on the page, so a changed page is noticed", async () => {
    const get = vi.fn(async (url: string) => ({ status: 200, url, text: '<article data-product-id="1"></article>' }));
    await expect(dirkAdapter.fetchOffers(ctx(get))).rejects.toThrow(/no offer cards/);
  });

  it("reads a page the captured robots.txt allows", () => {
    const rules = parseRobots(fixture("robots.txt"));
    expect(isAllowed(rules, "SpesaSmartNL", new URL(DIRK_OFFERS_URL).pathname)).toBe(true);
  });
});
