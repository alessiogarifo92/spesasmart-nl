import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { AdapterContext, NormalizedOffer, RawOffer } from "../../adapter";
import { isAllowed, parseRobots } from "../../robots";
import { validateOffer } from "../../validate";
import { AH_BONUS_URL, ahAdapter } from "./index";
import { parseAhBonus } from "./parse";

// A reduced copy of the real page, captured once on 2026-11-12 (see docs/ingestion.md).
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const html = fixture("bonus.html");
const TODAY = "2026-11-12";
const WEEK = { start: "2026-11-08", end: "2026-11-14", approximate: false };

function ctx(get: AdapterContext["http"]["get"] = vi.fn(), today = TODAY): AdapterContext {
  return { http: { get }, today, now: new Date("2026-11-12T08:00:00Z") };
}

const raws = parseAhBonus(html, AH_BONUS_URL);
const byId = (id: string) => raws.find((raw) => raw.payload.id === id)!;
function normalize(raw: RawOffer, context = ctx()): NormalizedOffer {
  const result = ahAdapter.normalizeOffer(raw, context);
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}
const withPayload = (id: string, change: RawOffer["payload"]): RawOffer => ({
  sourceUrl: AH_BONUS_URL,
  payload: { ...byId(id).payload, ...change },
});

describe("parseAhBonus", () => {
  it("reads every card once, in page order", () => {
    expect(raws.map((raw) => raw.payload.id)).toEqual([
      "wi169797",
      "wi4095",
      "824816",
      "wi108021",
      "824637",
      "824821",
      "824705",
      "831197",
      "-22738",
      "-22549",
    ]);
  });

  it("takes the text of a product card and the page's Bonus period", () => {
    expect(byId("wi4095")).toEqual({
      sourceUrl: "https://www.ah.nl/producten/product/wi4095/ah-spruitjes",
      payload: {
        id: "wi4095",
        card: "product",
        title: "AH Spruitjes",
        note: null,
        labels: "voor €0.89",
        currentPrice: "0.89",
        originalPrice: "1.49",
        size: "500 g",
        summary: "AH Spruitjes, Nutri-Score A, 500 gram Van €1.49 Voor €0.89, Uit Nederland",
        period: "8 t/m 14 november",
      },
    });
  });

  it("reads a group card with its note and both tier labels", () => {
    expect(byId("824705").payload).toMatchObject({ card: "group", title: "Alle Conimex*", note: "*M.u.v. soepen" });
    expect(byId("824816").payload).toMatchObject({ labels: "2 stuks 35% | 1 stuk 25%", currentPrice: null });
    expect(byId("824705").sourceUrl).toBe("https://www.ah.nl/bonus/groep/824705?week=46");
  });

  it("keeps no image, markup or script", () => {
    expect(JSON.stringify(raws)).not.toMatch(/<|\.(?:jpe?g|png|webp|svg)\b/i);
  });

  it("skips cards without id or title, keeps a repeated card once, refuses foreign links", () => {
    const card = (href: string, title: string) =>
      `<div data-testid="product-card-vertical-container"><a href="${href}"></a>` +
      `<div data-testid="product-card-text-container"><p>${title}</p></div></div>`;
    const page =
      card("/producten/product/wi1/een", "Eerste") +
      card("/producten/product/wi1/een", "Dubbel") +
      card("https://evil.example/producten/product/wi2/twee", "Vreemd") +
      card("/producten/product/wi3/drie", " ") +
      card("/elders", "Zonder id");
    const parsed = parseAhBonus(page, AH_BONUS_URL);
    expect(parsed.map((raw) => raw.payload.title)).toEqual(["Eerste"]);
    expect(parsed[0]!.payload.period).toBeNull();
  });

  it("returns nothing when the page has no cards", () => {
    expect(parseAhBonus("<html><body>Onderhoud</body></html>", AH_BONUS_URL)).toEqual([]);
  });
});

describe("ahAdapter.normalizeOffer", () => {
  it("stores Bonus price, regular price, size and the Bonus week", () => {
    const offer = normalize(byId("wi4095"));
    expect(offer).toMatchObject({
      title: "AH Spruitjes",
      kind: "WEEKLY",
      promotion: { type: "PRICE_CUT" },
      promoDescription: "voor €0.89",
      currentPriceCents: 89,
      regularPriceCents: 149,
      validity: WEEK,
      conditions: null,
      sourceUrl: "https://www.ah.nl/producten/product/wi4095/ah-spruitjes",
      dedupeKey: "wi4095:2026-11-14",
      product: { externalId: "wi4095", brand: null, ean: null, quantity: { amount: 500, unit: "g", count: 1 } },
    });
    expect(validateOffer(offer, { today: TODAY })).toEqual({ status: "VERIFIED", confidence: 1, issues: [] });
  });

  it("reads the single price next to a quantity deal as the regular price of one item", () => {
    const offer = normalize(byId("wi169797"));
    expect(offer).toMatchObject({
      promotion: { type: "X_FOR_PRICE", quantity: 2, totalCents: 199 },
      currentPriceCents: null,
      regularPriceCents: 139,
    });
    expect(validateOffer(offer, { today: TODAY }).status).toBe("VERIFIED");
  });

  it("keeps both prices of a percentage offer", () => {
    expect(normalize(byId("wi108021"))).toMatchObject({
      promotion: { type: "PERCENT_OFF", percent: 40 },
      currentPriceCents: 119,
      regularPriceCents: 199,
    });
  });

  it("stores a group as a range without size, with its mechanic and no price", () => {
    const offer = normalize(byId("824637"));
    expect(offer).toMatchObject({
      title: "Alle AH Quiches en pies",
      promotion: { type: "X_PLUS_Y_FREE", buy: 1, free: 1 },
      promoDescription: "uitgelicht 1+1 gratis",
      currentPriceCents: null,
      regularPriceCents: null,
      dedupeKey: "groep:824637:2026-11-14",
      product: { externalId: "groep:824637", quantity: null },
    });
    expect(validateOffer(offer, { today: TODAY }).status).toBe("UNVERIFIED");
    expect(normalize(byId("824821")).promotion).toEqual({ type: "X_PLUS_Y_FREE", buy: 2, free: 1 });
    expect(normalize(byId("824705")).promotion).toEqual({ type: "NTH_HALF_PRICE", n: 2 });
  });

  it("keeps tier labels as text and gives no price", () => {
    const offer = normalize(byId("824816"));
    expect(offer).toMatchObject({
      promotion: { type: "UNKNOWN", text: "2 stuks 35% | 1 stuk 25%" },
      currentPriceCents: null,
      regularPriceCents: null,
    });
    expect(validateOffer(offer, { today: TODAY }).status).toBe("UNVERIFIED");
  });

  it("reads 'voor 14.99' on a group as its price and records online-only as a condition", () => {
    expect(normalize(byId("831197"))).toMatchObject({
      title: "Coca-Cola 24-pack 330 ml",
      promotion: { type: "PRICE_CUT" },
      currentPriceCents: 1499,
      regularPriceCents: null,
      conditions: "Online only",
    });
  });

  it("keeps an example price with its note and marks a label it does not know as unverified", () => {
    const offer = normalize(byId("-22738"));
    expect(offer).toMatchObject({
      promotion: { type: "UNKNOWN", text: "online Bonus" },
      currentPriceCents: 291,
      regularPriceCents: 449,
      conditions: "Bijv. Traditional pasta sauce",
      product: { externalId: "groep:-22738" },
    });
    expect(validateOffer(offer, { today: TODAY }).status).toBe("UNVERIFIED");
  });

  it("does not read a lone price next to an unknown label", () => {
    const offer = normalize(withPayload("wi169797", { labels: "Bonus Box" }));
    expect(offer).toMatchObject({ currentPriceCents: null, regularPriceCents: null, promotion: { type: "UNKNOWN" } });
  });

  it("gives no price when the card has no label at all", () => {
    const offer = normalize(withPayload("wi169797", { labels: null }));
    expect(offer).toMatchObject({ currentPriceCents: null, regularPriceCents: null, promotion: { type: "UNKNOWN" } });
  });

  it("leaves validity unknown without a readable period", () => {
    for (const period of [null, "binnenkort"]) {
      const offer = normalize(withPayload("wi4095", { period }));
      expect(offer.validity).toBeNull();
      expect(offer.dedupeKey).toBe("wi4095:unknown");
      expect(validateOffer(offer, { today: TODAY }).status).toBe("UNVERIFIED");
    }
  });

  it("takes the year of the period from the run day", () => {
    const offer = normalize(withPayload("wi4095", { period: "4 t/m 10 januari" }), ctx(vi.fn(), "2027-01-05"));
    expect(offer.validity).toMatchObject({ start: "2027-01-04", end: "2027-01-10" });
  });

  it("reads 'per stuk' as one piece and leaves an unreadable size unknown", () => {
    expect(normalize(byId("wi169797")).product.quantity).toMatchObject({ amount: 1, unit: "piece" });
    expect(normalize(withPayload("wi4095", { size: "diverse varianten" })).product.quantity).toBeNull();
  });

  it("marks organic products by their name", () => {
    expect(normalize(withPayload("wi4095", { title: "AH Biologische spruitjes" })).product.isOrganic).toBe(true);
    expect(normalize(byId("wi4095")).product.isOrganic).toBe(false);
  });

  it.each([
    [{ title: "Iets" }, "id-missing"],
    [{ id: "wi1", title: " " }, "title-missing"],
  ])("refuses %j", (payload, reason) => {
    expect(ahAdapter.normalizeOffer({ sourceUrl: AH_BONUS_URL, payload }, ctx())).toEqual({ ok: false, reason });
    expect(ahAdapter.normalizeProduct({ sourceUrl: AH_BONUS_URL, payload }, ctx())).toEqual({ ok: false, reason });
  });
});

describe("ahAdapter", () => {
  it("is a real adapter limited to one run a day", () => {
    expect(ahAdapter).toMatchObject({ id: "ah", retailerSlug: "ah", isMock: false, maxRunsPerDay: 1 });
  });

  it("makes one request, to the Bonus page, and nothing else", async () => {
    const get = vi.fn(async (url: string) => ({ status: 200, url, text: html }));
    const context = ctx(get);
    expect(await ahAdapter.fetchOffers(context)).toHaveLength(10);
    expect(await ahAdapter.fetchUpcomingOffers(context)).toEqual([]);
    expect(await ahAdapter.fetchStoreLocations(context)).toEqual([]);
    expect(get.mock.calls).toEqual([[AH_BONUS_URL]]);
  });

  it("leaves delivery offers out", async () => {
    const page =
      html +
      '<div data-testid="segment-card-container"><a data-testid="product-card-link-container" href="/bonus/groep/1?week=46"></a>' +
      '<p>Gratis bezorging</p><span class="x_promotionLabel_y" aria-label="bij 8 euro"></span></div>';
    const get = vi.fn(async (url: string) => ({ status: 200, url, text: page }));
    expect(parseAhBonus(page, AH_BONUS_URL)).toHaveLength(11);
    expect(await ahAdapter.fetchOffers(ctx(get))).toHaveLength(10);
  });

  it("fails the fetch when no card is on the page, so a changed page is noticed", async () => {
    const get = vi.fn(async (url: string) => ({ status: 200, url, text: "<main></main>" }));
    await expect(ahAdapter.fetchOffers(ctx(get))).rejects.toThrow(/no Bonus cards/);
  });

  it("reads a page the captured robots.txt allows, and never the group pages it disallows", () => {
    const rules = parseRobots(fixture("robots.txt"));
    expect(isAllowed(rules, "SpesaSmartNL", new URL(AH_BONUS_URL).pathname)).toBe(true);
    expect(isAllowed(rules, "SpesaSmartNL", "/bonus/groep/824705?week=46")).toBe(false);
  });
});
