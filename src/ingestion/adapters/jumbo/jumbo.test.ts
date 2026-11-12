import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { AdapterContext, NormalizedOffer, RawOffer } from "../../adapter";
import { isAllowed, parseRobots } from "../../robots";
import { validateOffer } from "../../validate";
import { JUMBO_OFFERS_URL, jumboAdapter } from "./index";
import { parseJumboOffers } from "./parse";

// A reduced copy of the real page, captured once on 2026-11-12 (see docs/adapters.md).
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const html = fixture("offers.html");
const TODAY = "2026-11-12";

function ctx(get: AdapterContext["http"]["get"] = vi.fn()): AdapterContext {
  return { http: { get }, today: TODAY, now: new Date("2026-11-12T08:00:00Z") };
}

const raws = parseJumboOffers(html, JUMBO_OFFERS_URL);
const byId = (id: string) => raws.find((raw) => raw.payload.id === id)!;
function normalize(raw: RawOffer): NormalizedOffer {
  const result = jumboAdapter.normalizeOffer(raw, ctx());
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

describe("parseJumboOffers", () => {
  it("reads every card of the three kinds, each once", () => {
    expect(raws.map((raw) => [raw.payload.id, raw.payload.card])).toEqual([
      ["3022228", "grid"],
      ["3022097", "grid"],
      ["3023846", "grid"],
      ["3023865", "grid"],
      ["3022229", "grid"],
      ["3022259", "grid"],
      ["3022315", "grid"],
      ["3022166", "grid"],
      ["3013664", "grid"],
      ["wa45_spellen", "heavy"],
      ["3022270", "mass"],
    ]);
  });

  it("takes title, mechanic, dates and link from a grid card", () => {
    expect(byId("3022097")).toEqual({
      sourceUrl: "https://www.jumbo.com/aanbiedingen/rucola-veldsla-of-melanges/3022097",
      payload: {
        id: "3022097",
        card: "grid",
        title: "Rucola, veldsla of melanges",
        mechanic: "voor 0,99",
        qualifier: null,
        group: "Week",
        start: "2026-11-11T00:01:00+01:00",
        end: "2026-11-17T23:59:00+01:00",
        validityText: "wo 11 t/m di 17 nov",
      },
    });
  });

  it("splits a stacked tag into qualifier and mechanic", () => {
    expect(byId("3023865").payload).toMatchObject({ qualifier: "Alleen online", mechanic: "voor 1,09" });
    expect(byId("3022166").payload).toMatchObject({ qualifier: "Alleen in de winkel", mechanic: "25% korting" });
  });

  it("reads a carousel card, which has no dates of its own", () => {
    expect(byId("wa45_spellen").payload).toMatchObject({
      title: "Samen spellen spelen",
      mechanic: "50% korting",
      qualifier: "Online spellen spelen",
      start: null,
      end: null,
      validityText: "wo 4 nov t/m di 5 jan",
    });
  });

  it("takes the id of a store-only card from its link", () => {
    expect(byId("3022270")).toMatchObject({
      sourceUrl: "https://www.jumbo.com/aanbiedingen/mass-promotions/3022270",
      payload: { title: "Alle Jumbo flatbreads", mechanic: "25% korting", validityText: "t/m di 17 nov" },
    });
  });

  it("keeps no image, markup or script", () => {
    const text = JSON.stringify(raws);
    expect(text).not.toMatch(/<|\.(?:jpe?g|png|webp|svg)\b/i);
  });

  it("skips cards without a title or an id and keeps a repeated offer once", () => {
    const card = (attributes: string, title: string, linkId = "1") =>
      `<article data-testid="promotion-card-0" ${attributes}><span data-testid="jum-tag">1+1 gratis</span>` +
      `<h3><a class="title-link" href="/aanbiedingen/x/${linkId}">${title}</a></h3></article>`;
    const page = card('id="1"', "Eerste") + card('id="1"', "Dubbel") + card('id="2"', " ") + card("", "Zonder id", "7");
    expect(parseJumboOffers(page, JUMBO_OFFERS_URL).map((raw) => raw.payload.title)).toEqual(["Eerste", "Zonder id"]);
    // "Zonder id" got its id from the link; without a usable link there is none.
    const orphan = '<article data-testid="promotion-card-0"><h3><a class="title-link">Los</a></h3></article>';
    expect(parseJumboOffers(orphan, JUMBO_OFFERS_URL)).toEqual([]);
  });

  it("never takes a link that leaves jumbo.com", () => {
    const page = (href: string) =>
      `<article data-testid="promotion-card-0" id="9"><h3><a class="title-link" href="${href}">Titel</a></h3></article>`;
    for (const href of ["https://evil.example/aanbiedingen/9", "javascript:alert(1)", "http://www.jumbo.com/a/9"]) {
      expect(parseJumboOffers(page(href), JUMBO_OFFERS_URL)[0]!.sourceUrl).toBe(JUMBO_OFFERS_URL);
    }
  });

  it("returns nothing for a page without cards", () => {
    expect(parseJumboOffers("<html><body><h1>Even geduld</h1></body></html>", JUMBO_OFFERS_URL)).toEqual([]);
  });
});

describe("jumboAdapter.normalizeOffer", () => {
  it("stores a plain offer price as a verified price cut, without a regular price", () => {
    const offer = normalize(byId("3022097"));
    expect(offer).toMatchObject({
      title: "Rucola, veldsla of melanges",
      kind: "WEEKLY",
      promotion: { type: "PRICE_CUT" },
      promoDescription: "voor 0,99",
      currentPriceCents: 99,
      regularPriceCents: null,
      validity: { start: "2026-11-11", end: "2026-11-17", approximate: false },
      conditions: null,
      sourceUrl: "https://www.jumbo.com/aanbiedingen/rucola-veldsla-of-melanges/3022097",
      dedupeKey: "offer:3022097",
      product: {
        externalId: "offer:3022097",
        name: "Rucola, veldsla of melanges",
        brand: null,
        ean: null,
        quantity: null,
      },
    });
    expect(validateOffer(offer, { today: TODAY })).toMatchObject({ status: "VERIFIED", confidence: 0.75 });
  });

  it("reads a quantity deal with its total", () => {
    const offer = normalize(byId("3023846"));
    expect(offer).toMatchObject({
      promotion: { type: "X_FOR_PRICE", quantity: 2, totalCents: 499 },
      currentPriceCents: null,
    });
    expect(validateOffer(offer, { today: TODAY }).status).toBe("VERIFIED");
  });

  it.each([
    ["3022228", { type: "X_PLUS_Y_FREE", buy: 1, free: 1 }],
    ["3022315", { type: "X_PLUS_Y_FREE", buy: 2, free: 1 }],
    ["3022229", { type: "PERCENT_OFF", percent: 25 }],
  ])("keeps the mechanic of %s and invents no price", (id, promotion) => {
    const offer = normalize(byId(id));
    expect(offer).toMatchObject({ promotion, currentPriceCents: null, regularPriceCents: null });
    // No price can be worked out without a regular price: shown as "to verify", with less confidence.
    const verdict = validateOffer(offer, { today: TODAY });
    expect(verdict.status).toBe("UNVERIFIED");
    expect(verdict.issues).toContain("price-unknown");
    expect(verdict.confidence).toBeLessThan(1);
  });

  it("keeps a price per weight as text, not as an item price", () => {
    const offer = normalize(byId("3022259"));
    expect(offer).toMatchObject({
      promotion: { type: "UNKNOWN", text: "1,59 per 100 gram" },
      promoDescription: "1,59 per 100 gram",
      currentPriceCents: null,
    });
    expect(validateOffer(offer, { today: TODAY }).status).toBe("UNVERIFIED");
  });

  it("uses each card's own dates, also when they differ from the week", () => {
    expect(normalize(byId("3022315")).validity).toEqual({ start: "2026-11-02", end: "2026-11-29", approximate: false });
    expect(normalize(byId("3013664")).validity).toEqual({ start: "2026-01-07", end: "2026-12-01", approximate: false });
  });

  it("falls back to the validity line when a card has no dates", () => {
    expect(normalize(byId("wa45_spellen")).validity).toEqual({
      start: "2026-11-04",
      end: "2027-01-05",
      approximate: false,
    });
    expect(normalize(byId("3022270")).validity).toEqual({ start: null, end: "2026-11-17", approximate: false });
  });

  it("records where the offer applies as a condition", () => {
    expect(normalize(byId("3023865"))).toMatchObject({ conditions: "Alleen online", currentPriceCents: 109 });
    expect(normalize(byId("3022166")).conditions).toBe("Alleen in de winkel");
  });

  it("leaves validity unknown when neither dates nor text are usable", () => {
    const raw: RawOffer = {
      sourceUrl: JUMBO_OFFERS_URL,
      payload: {
        id: "1",
        title: "Iets",
        mechanic: "1+1 gratis",
        start: "17 november",
        end: "2026-13-40T00:00:00+01:00",
        validityText: "zolang de voorraad strekt",
      },
    };
    const offer = normalize(raw);
    expect(offer.validity).toBeNull();
    expect(validateOffer(offer, { today: TODAY })).toMatchObject({ status: "UNVERIFIED" });
  });

  it("ignores dates that end before they start", () => {
    const raw: RawOffer = {
      sourceUrl: JUMBO_OFFERS_URL,
      payload: {
        id: "1",
        title: "Iets",
        mechanic: "voor 1,00",
        start: "2026-11-17T00:00:00+01:00",
        end: "2026-11-11T00:00:00+01:00",
        validityText: null,
      },
    };
    expect(normalize(raw).validity).toBeNull();
  });

  it("stores an offer without a tag as an unknown mechanic", () => {
    const offer = normalize({ sourceUrl: JUMBO_OFFERS_URL, payload: { id: "1", title: "Iets", mechanic: null } });
    expect(offer).toMatchObject({
      promotion: { type: "UNKNOWN", text: "" },
      promoDescription: null,
      currentPriceCents: null,
    });
  });

  it.each([
    [{ title: "Iets" }, "id-missing"],
    [{ id: "1", title: "  " }, "title-missing"],
  ])("refuses %j", (payload, reason) => {
    expect(jumboAdapter.normalizeOffer({ sourceUrl: JUMBO_OFFERS_URL, payload }, ctx())).toEqual({ ok: false, reason });
    expect(jumboAdapter.normalizeProduct({ sourceUrl: JUMBO_OFFERS_URL, payload }, ctx())).toEqual({
      ok: false,
      reason,
    });
  });
});

describe("jumboAdapter", () => {
  it("is a real adapter limited to one run a day", () => {
    expect(jumboAdapter).toMatchObject({ id: "jumbo", retailerSlug: "jumbo", isMock: false, maxRunsPerDay: 1 });
  });

  it("makes one request, to the offers page, and nothing else", async () => {
    const get = vi.fn(async (url: string) => ({ status: 200, url, text: html }));
    const context = ctx(get);
    expect(await jumboAdapter.fetchOffers(context)).toHaveLength(11);
    expect(await jumboAdapter.fetchUpcomingOffers(context)).toEqual([]);
    expect(await jumboAdapter.fetchStoreLocations(context)).toEqual([]);
    expect(get.mock.calls).toEqual([[JUMBO_OFFERS_URL]]);
  });

  it("fails the fetch when the page lists no offers, so a changed page is noticed", async () => {
    const get = vi.fn(async (url: string) => ({ status: 200, url, text: "<html><body>Onderhoud</body></html>" }));
    await expect(jumboAdapter.fetchOffers(ctx(get))).rejects.toThrow(/no offer cards/);
  });

  it("reads a page the captured robots.txt allows", () => {
    const rules = parseRobots(fixture("robots.txt"));
    expect(isAllowed(rules, "SpesaSmartNL", new URL(JUMBO_OFFERS_URL).pathname)).toBe(true);
    expect(isAllowed(rules, "SpesaSmartNL", "/mijn/")).toBe(false);
  });
});
