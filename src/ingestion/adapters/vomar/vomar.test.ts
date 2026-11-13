import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { AdapterContext, NormalizedOffer, RawOffer } from "../../adapter";
import { isAllowed, parseRobots } from "../../robots";
import { validateOffer } from "../../validate";
import { extractPageTexts } from "./extract";
import { findFlyerUrl, readDeal, readPdfUrl, VOMAR_FOLDERS_URL, vomarAdapter } from "./index";
import { parseVomarFlyer, readWeekEnd, type PageText, type TextItem } from "./layout";

// Reduced captures of the real flyer of week 46, 2026 (see docs/ingestion.md): the text
// of eight pages with its position, and the two small documents that lead to the PDF.
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const pages = JSON.parse(fixture("flyer-text.json")) as PageText[];
const FLYER = "https://view.publitas.com/folder-deze-week/online-weekendfolder-week-46-mkezgxpk7eqx";
const TODAY = "2026-11-13";

function ctx(http: Partial<AdapterContext["http"]> = {}, today = TODAY): AdapterContext {
  return { http: { get: vi.fn(), getBytes: vi.fn(), ...http }, today, now: new Date(`${today}T08:00:00Z`) };
}

const flyer = parseVomarFlyer(pages, FLYER);
const byName = (name: string) => flyer.offers.find((raw) => raw.payload.name === name)!;
function normalize(raw: RawOffer, context = ctx()): NormalizedOffer {
  const result = vomarAdapter.normalizeOffer(raw, context);
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}
const reasonOf = (raw: RawOffer, context = ctx()) => {
  const result = vomarAdapter.normalizeOffer(raw, context);
  return result.ok ? null : result.reason;
};
const withPayload = (raw: RawOffer, payload: RawOffer["payload"]): RawOffer => ({
  ...raw,
  payload: { ...raw.payload, ...payload },
});

/** One price tag with its product text, laid out as the flyer does. */
function card(x: number, y: number, name: string, options: { former?: string | null; cents?: string } = {}) {
  const item = (text: string, dx: number, dy: number, size: number, width: number): TextItem => ({
    text,
    x: x + dx,
    y: y + dy,
    width,
    size,
    rotated: false,
  });
  const items = [item(name, 0, 0, 11, 80), item("Pak 500 gram", 0, 13, 8, 50), item("2.", 100, 60, 50, 40)];
  items.push(item(options.cents ?? "99", 142, 45, 35, 34));
  if (options.former !== null) items.push(item(options.former ?? "3.49", 110, 8, 11, 22));
  return items;
}
const page = (items: TextItem[]): PageText[] => [
  {
    number: 1,
    width: 600,
    height: 800,
    items: [
      ...items,
      { text: "Acties zijn geldig t/m zaterdag 14 november", x: 20, y: 790, width: 150, size: 7, rotated: false },
    ],
  },
];

describe("parseVomarFlyer", () => {
  it("reads the offers whose parts are found without doubt, page by page", () => {
    expect(flyer.offers.map((raw) => `${raw.payload.page} ${raw.payload.name}`)).toEqual([
      "1 Verse Scharreleieren",
      "1 Dr. Oetker Casa Di Mama Pizza",
      "2 Barefoot of El Burro Wijn",
      "3 Senseo Koffiepads",
      "3 Verse Tompoucen",
      "3 Ananas",
      "3 Druiven Rood",
      "5 Ierse Biefstuk",
      "5 Verse Tonijnsteak",
      "5 Runder Mini Hamburgers",
      "5 Shoarma",
      "11 Ooops! Toiletpapier",
      "11 Dove, Rexona, Odorex, Sanicur, of Melkmeisje",
      "12 Capri-Sun",
      "12 Deepblue Tonijnstukken",
      "12 Lipton Ice Tea",
      "14 Toffifee",
      "14 Emmer met Nootjes",
      "14 Venco Piramides of Red Band Winegums Mix",
      "14 Quaker Cruesli",
      "14 Lay's Oven Baked of Flat Chips",
      "14 LU Scholiertje of Pim's",
      "20 Croma Vloeibaar",
      "20 Actimel",
      "20 Giga Stuk Jong Belegen Kaas",
      "20 Goudse Geraspte Kaas",
      "20 Gerookte Spekreepjes",
      "20 Starbucks Ice Coffee White Chocolate",
    ]);
  });

  it("keeps the printed parts of an offer as they are", () => {
    expect(byName("Verse Scharreleieren").payload).toMatchObject({
      page: 1,
      badge: "30 STUKS",
      price: "5.99",
      regularPrice: "7.49",
      details: "Tray 30 stuks",
      weekEnd: "14 november",
      daysOnly: false,
    });
    expect(byName("Lipton Ice Tea").payload).toMatchObject({
      badge: "2 STUKS",
      price: "1.99",
      regularPrice: "3.58 - 3.96",
      details: "Fles 500 ml",
      exclusion: "m.u.v. gekoeld",
    });
    expect(byName("Verse Scharreleieren").sourceUrl).toBe(FLYER);
  });

  it("dates the offers of the Thursday to Saturday box by the days printed on it", () => {
    expect(byName("Verse Tompoucen").payload).toMatchObject({ daysOnly: true, days: "12 nov, 13 nov, 14 nov" });
    // On the same page, below the box.
    expect(byName("Ananas").payload).toMatchObject({ daysOnly: false });
  });

  it("skips what cannot be paired and says why", () => {
    expect(flyer.skipped).toEqual([
      { page: 2, reason: "no product text next to the price", near: "5.99 (11.98)" },
      { page: 2, reason: "two product texts are about as close to the price", near: "5.24 (6.99)" },
      { page: 12, reason: "no product text next to the price", near: "2.99 (3.25 - 5.99)" },
    ]);
  });

  it("reads the last day of the week from the flyer", () => {
    expect(readWeekEnd(pages)).toBe("14 november");
    expect(readWeekEnd([{ ...pages[0], items: [] }])).toBeNull();
  });

  it("reads a lone card", () => {
    const { offers, skipped } = parseVomarFlyer(page(card(50, 100, "Halfvolle Melk")), FLYER);
    expect(skipped).toEqual([]);
    expect(offers.map((raw) => raw.payload)).toMatchObject([
      { name: "Halfvolle Melk", price: "2.99", regularPrice: "3.49", details: "Pak 500 gram" },
    ]);
  });

  it("takes no offer without a former price above the offer price", () => {
    const { offers, skipped } = parseVomarFlyer(page(card(50, 100, "Halfvolle Melk", { former: null })), FLYER);
    expect(offers).toEqual([]);
    expect(skipped.map((skip) => skip.reason)).toEqual(["former price not found above the offer price"]);
  });

  it("takes no offer when the former price shares its line with other text", () => {
    const items = card(50, 100, "Halfvolle Melk");
    items.push({ text: "- 4.10", x: 186, y: 108, width: 20, size: 11, rotated: false });
    expect(parseVomarFlyer(page(items), FLYER).offers).toEqual([]);
  });

  it("takes no offer when two product texts are equally near the price", () => {
    const items = card(50, 100, "Halfvolle Melk");
    items.push({ text: "Volle Yoghurt", x: 50, y: 150, width: 80, size: 11, rotated: false });
    const { offers, skipped } = parseVomarFlyer(page(items), FLYER);
    expect(offers).toEqual([]);
    expect(skipped.map((skip) => skip.reason)).toEqual(["two product texts are about as close to the price"]);
  });

  it("leaves the last day empty when the flyer does not print it, and nothing is stored then", () => {
    const [only] = page(card(50, 100, "Halfvolle Melk"));
    const { offers } = parseVomarFlyer([{ ...only, items: only.items.slice(0, -1) }], FLYER);
    expect(offers.map((raw) => raw.payload.weekEnd)).toEqual([null]);
    expect(reasonOf(offers[0])).toBe("week-end-unreadable");
  });
});

describe("readDeal", () => {
  const one = (cents: number) => ({ low: cents, high: cents });

  it("reads a plain price cut", () => {
    expect(readDeal("PER STUK", 169, one(199), "Ananas. Per stuk")).toEqual({
      promotion: { type: "PRICE_CUT" },
      currentPriceCents: 169,
      regularPriceCents: 199,
      bundle: false,
    });
    expect(readDeal(null, 119, one(149), "Hollandse Bospeen. ")).toMatchObject({ currentPriceCents: 119 });
  });

  it("keeps no former price when the flyer prints a range", () => {
    expect(readDeal("XL PAK", 399, { low: 555, high: 585 }, "Quaker Cruesli. XL-pak 725-850 gram")).toMatchObject({
      promotion: { type: "PRICE_CUT" },
      currentPriceCents: 399,
      regularPriceCents: null,
    });
  });

  it.each([
    [169, one(169)],
    [199, one(169)],
    [399, { low: 355, high: 585 }],
    [0, one(169)],
  ])("refuses an offer price of %i that is not below the former price", (price, regular) => {
    expect(readDeal("PER STUK", price, regular, "Ananas")).toBe("offer-price-not-below-former-price");
  });

  it("reads N+M free when the two prices add up", () => {
    expect(readDeal("1+1 GRATIS", 229, one(458), "Danone Danette. 4-pack à 125 gram")).toEqual({
      promotion: { type: "X_PLUS_Y_FREE", buy: 1, free: 1 },
      currentPriceCents: null,
      regularPriceCents: 229,
      bundle: false,
    });
    expect(readDeal("2+3 GRATIS", 578, one(1445), "Dove")).toMatchObject({
      promotion: { type: "X_PLUS_Y_FREE", buy: 2, free: 3 },
      regularPriceCents: 289,
    });
  });

  it.each([
    ["1+1 GRATIS", 229, one(459)],
    ["1+1 GRATIS", 239, one(458)],
    ["2+1 GRATIS", 300, { low: 450, high: 480 }],
  ])("refuses %s when %i does not follow from the former price", (badge, price, regular) => {
    expect(readDeal(badge, price, regular, "Danone Danette")).toBe("free-items-do-not-add-up");
  });

  it("reads a percentage when it gives the printed price", () => {
    expect(readDeal("50% KORTING", 499, one(999), "Spathiphyllum. Potmaat: 17 cm")).toEqual({
      promotion: { type: "PERCENT_OFF", percent: 50 },
      currentPriceCents: 499,
      regularPriceCents: 999,
      bundle: false,
    });
    expect(readDeal("25% KORTING", 599, one(799), "Stëlz")).toMatchObject({ currentPriceCents: 599 });
  });

  it("refuses a percentage that does not give the printed price", () => {
    expect(readDeal("50% KORTING", 549, one(999), "Spathiphyllum")).toBe("percentage-does-not-add-up");
    expect(readDeal("50% KORTING", 499, { low: 999, high: 1099 }, "Spathiphyllum")).toBe("percentage-does-not-add-up");
  });

  it("keeps the mechanic and not the prices when the flyer prices one example of a range", () => {
    const text =
      "Vivera Vleesvervangers. Alle soorten. Per stuk van 2.59 tot 3.85 Prijsvoorbeeld: Vivera Groenteburger";
    expect(readDeal("50% KORTING", 130, one(259), text)).toEqual({
      promotion: { type: "PERCENT_OFF", percent: 50 },
      currentPriceCents: null,
      regularPriceCents: null,
      bundle: false,
    });
    expect(readDeal("1+1 GRATIS", 399, one(798), "Pizza. Per stuk van 3.99 tot 4.19 Prijsvoorbeeld: Salame")).toEqual({
      promotion: { type: "X_PLUS_Y_FREE", buy: 1, free: 1 },
      currentPriceCents: null,
      regularPriceCents: null,
      bundle: false,
    });
    // The example must still add up, or the parts were not read from the same offer.
    expect(readDeal("50% KORTING", 150, one(259), text)).toBe("percentage-does-not-add-up");
    expect(readDeal("PER STUK", 130, one(259), text)).toBe("example-price-without-mechanic");
  });

  it("reads a number of items as a price for several", () => {
    expect(readDeal("2 PAKKEN", 199, one(374), "Dubbelfrisss Boost. Pak 1,5 liter")).toEqual({
      promotion: { type: "X_FOR_PRICE", quantity: 2, totalCents: 199 },
      currentPriceCents: null,
      regularPriceCents: 187,
      bundle: true,
    });
    expect(readDeal("2 STUKS", 199, { low: 358, high: 396 }, "Lipton Ice Tea. Fles 500 ml")).toMatchObject({
      promotion: { type: "X_FOR_PRICE", quantity: 2, totalCents: 199 },
      regularPriceCents: null,
    });
    // 3.75 is not twice a whole number of cents.
    expect(readDeal("2 STUKS", 199, one(375), "Lipton Ice Tea")).toMatchObject({ regularPriceCents: null });
  });

  it.each([
    ["30 STUKS", "Verse Scharreleieren. Tray 30 stuks"],
    ["16 ROLLEN", "Ooops! Toiletpapier. 16 rollen. 3-laags"],
    ["12 PACK", "Actimel. 12-pack fles à 100 ml"],
    ["4 STUKS", "Krokante Kabeljauwschnitzel. Pak 4 stuks"],
    ["1 STUK", "Ananas"],
  ])("reads %s as the size of one pack when the small print says so", (badge, text) => {
    expect(readDeal(badge, 299, one(699), text)).toMatchObject({ promotion: { type: "PRICE_CUT" }, bundle: false });
  });

  it("does not take the number in another size for the pack size", () => {
    expect(readDeal("2 STUKS", 199, one(398), "Sap. Pak 12 stuks")).toMatchObject({
      promotion: { type: "X_FOR_PRICE", quantity: 2, totalCents: 199 },
    });
  });

  it.each(["2E HALVE PRIJS", "3 VOOR 5.00", "2+1", "GRATIS BEZORGD", "10% EXTRA", "2e gratis"])(
    "refuses the badge %j it cannot read",
    (badge) => {
      expect(readDeal(badge, 199, one(398), "Sap")).toBe("badge-not-understood");
    },
  );
});

describe("vomarAdapter", () => {
  it("is a real adapter limited to one run a day", () => {
    expect(vomarAdapter).toMatchObject({ id: "vomar", retailerSlug: "vomar", isMock: false, maxRunsPerDay: 1 });
  });

  it("normalises a price cut with its size, validity and source page", () => {
    const offer = normalize(byName("Verse Scharreleieren"));
    expect(offer).toMatchObject({
      title: "Verse Scharreleieren",
      kind: "WEEKLY",
      promotion: { type: "PRICE_CUT" },
      promoDescription: "30 STUKS",
      currentPriceCents: 599,
      regularPriceCents: 749,
      validity: { start: null, end: "2026-11-14", approximate: false },
      conditions: "Tray 30 stuks",
      sourceUrl: `${FLYER}/page/1`,
      dedupeKey: "flyer:verse-scharreleieren:2026-11-14:week",
    });
    expect(offer.product).toMatchObject({
      externalId: "flyer:verse-scharreleieren",
      name: "Verse Scharreleieren",
      brand: null,
      quantity: { amount: 30, unit: "piece" },
    });
    expect(validateOffer(offer, { today: TODAY }).status).toBe("VERIFIED");
  });

  it("dates a Thursday to Saturday offer by its own days", () => {
    const offer = normalize(byName("Verse Tompoucen"));
    expect(offer.validity).toEqual({ start: "2026-11-12", end: "2026-11-14", approximate: false });
    expect(offer.dedupeKey).toBe("flyer:verse-tompoucen:2026-11-14:2026-11-12");
  });

  it("states the range, the stock note and the exclusion as conditions", () => {
    expect(normalize(byName("Lipton Ice Tea"))).toMatchObject({
      promotion: { type: "X_FOR_PRICE", quantity: 2, totalCents: 199 },
      currentPriceCents: null,
      regularPriceCents: null,
      conditions: "Normaal 3.58 - 3.96 · Fles 500 ml · m.u.v. gekoeld",
      product: { quantity: null },
    });
    expect(normalize(byName("Deepblue Tonijnstukken")).conditions).toBe("OP=OP · Water of Zonnebloemolie. 400 gram");
  });

  it("takes the size from the badge when the small print has none", () => {
    expect(normalize(byName("Druiven Rood")).product.quantity).toMatchObject({ amount: 500, unit: "g" });
    expect(normalize(byName("Gerookte Spekreepjes")).product.quantity).toMatchObject({ amount: 200, count: 2 });
    expect(normalize(byName("Ananas")).product.quantity).toBeNull();
  });

  it("stores an offer on a range without a price, to be verified", () => {
    const offer = normalize(byName("Dr. Oetker Casa Di Mama Pizza"));
    expect(offer).toMatchObject({
      promotion: { type: "X_PLUS_Y_FREE", buy: 1, free: 1 },
      currentPriceCents: null,
      regularPriceCents: null,
    });
    expect(validateOffer(offer, { today: TODAY }).status).toBe("UNVERIFIED");
  });

  it("gives every offer of the fixture a known end date and no rejection", () => {
    for (const raw of flyer.offers) {
      const offer = normalize(raw);
      expect(offer.validity?.end).toBe("2026-11-14");
      expect(validateOffer(offer, { today: TODAY }).status).not.toBe("REJECTED");
    }
  });

  it.each([
    [{ price: "5,99" }, "price-unreadable"],
    [{ price: null }, "price-unreadable"],
    [{ regularPrice: null }, "price-unreadable"],
    [{ regularPrice: "7.49 -" }, "price-unreadable"],
    [{ regularPrice: "5.49" }, "offer-price-not-below-former-price"],
    [{ badge: "2E HALVE PRIJS" }, "badge-not-understood"],
    [{ name: null }, "name-missing"],
    [{ name: "•" }, "name-missing"],
    [{ weekEnd: null }, "week-end-unreadable"],
    [{ weekEnd: "veertien november" }, "week-end-unreadable"],
    [{ daysOnly: true, days: null }, "offer-days-unreadable"],
    [{ daysOnly: true, days: "12 nov" }, "offer-days-unreadable"],
    [{ daysOnly: true, days: "11 nov, 13 nov, 14 nov" }, "offer-days-unreadable"],
    [{ daysOnly: true, days: "13 nov, 14 nov, 15 nov" }, "offer-days-unreadable"],
    [{ daysOnly: true, days: "13 nov, 14 foo" }, "offer-days-unreadable"],
  ])("stores nothing for %j", (payload, reason) => {
    expect(reasonOf(withPayload(byName("Verse Scharreleieren"), payload))).toBe(reason);
  });

  it("refuses a flyer whose week has not surely started", () => {
    expect(reasonOf(byName("Verse Scharreleieren"), ctx({}, "2026-11-07"))).toBe("week-not-started");
    expect(reasonOf(byName("Verse Scharreleieren"), ctx({}, "2026-11-08"))).toBeNull();
  });

  it("reads days across New Year in the year of each day", () => {
    const raw = withPayload(byName("Verse Tompoucen"), { weekEnd: "2 januari", days: "31 dec, 1 jan, 2 jan" });
    expect(normalize(raw, ctx({}, "2026-12-30")).validity).toEqual({
      start: "2026-12-31",
      end: "2027-01-02",
      approximate: false,
    });
  });

  it("normalises the product alone", () => {
    const product = vomarAdapter.normalizeProduct(byName("Toffifee"), ctx());
    expect(product).toMatchObject({ ok: true, value: { externalId: "flyer:toffifee", quantity: { amount: 400 } } });
  });

  it("collects nothing else", async () => {
    expect(await vomarAdapter.fetchUpcomingOffers(ctx())).toEqual([]);
    expect(await vomarAdapter.fetchStoreLocations(ctx())).toEqual([]);
  });
});

describe("finding the flyer", () => {
  it("finds the one flyer embedded on the folders page", () => {
    expect(findFlyerUrl(fixture("folders.html"))).toBe(FLYER);
    expect(
      findFlyerUrl(String.raw`{"src":"https:\/\/view.publitas.com\/folder-deze-week\/week-47-abc\/page\/1"}`),
    ).toBe("https://view.publitas.com/folder-deze-week/week-47-abc");
  });

  it.each([
    ["no flyer", "<html><body>Geen folder</body></html>"],
    [
      "two flyers",
      '<iframe src="https://view.publitas.com/folder-deze-week/a"></iframe><iframe src="https://view.publitas.com/folder-deze-week/b"></iframe>',
    ],
    ["another group", '<iframe src="https://view.publitas.com/dagknallers/week-46"></iframe>'],
    ["another host", '<iframe src="https://view.publitas.com.example.org/folder-deze-week/a"></iframe>'],
  ])("finds nothing on a page with %s", (_, html) => {
    expect(findFlyerUrl(html)).toBeNull();
  });

  it("reads the PDF address from Vomar's flyer description", () => {
    const url = readPdfUrl(fixture("publication.json"));
    expect(url).toMatch(/^https:\/\/view\.publitas\.com\/96403\/3526982\/pdfs\/[^?]+\.pdf/);
  });

  it.each([
    ["not JSON", "<html>"],
    ["null", "null"],
    ["another account", JSON.stringify({ accountName: "Iemand B.V.", config: { downloadPdfUrl: `${FLYER}/a.pdf` } })],
    ["no PDF", JSON.stringify({ accountName: "Vomar Voordeelmarkt B.V.", config: {} })],
    [
      "a PDF elsewhere",
      JSON.stringify({ accountName: "Vomar", config: { downloadPdfUrl: "https://example.org/folder.pdf" } }),
    ],
    [
      "a PDF over http",
      JSON.stringify({ accountName: "Vomar", config: { downloadPdfUrl: "http://view.publitas.com/a.pdf" } }),
    ],
    [
      "a file that is no PDF",
      JSON.stringify({ accountName: "Vomar", config: { downloadPdfUrl: "https://view.publitas.com/a.zip" } }),
    ],
    ["a broken address", JSON.stringify({ accountName: "Vomar", config: { downloadPdfUrl: "::" } })],
  ])("accepts no PDF from %s", (_, json) => {
    expect(readPdfUrl(json)).toBeNull();
  });

  it("is allowed by the robots.txt captured with the fixture", () => {
    const rules = parseRobots(fixture("robots.txt"));
    expect(isAllowed(rules, "SpesaSmartNL", new URL(VOMAR_FOLDERS_URL).pathname)).toBe(true);
    expect(isAllowed(rules, "SpesaSmartNL", "/misc/cookies")).toBe(false);
  });
});

/** A PDF with one page per list of lines, written by hand: `[text, x, y from the bottom, size]`. */
function pdf(pageLines: [string, number, number, number][][]): Uint8Array {
  const objects: string[] = [];
  const kids = pageLines.map((_, index) => `${4 + index * 2} 0 R`).join(" ");
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pageLines.length} >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  pageLines.forEach((lines, index) => {
    const stream = lines
      .map(([text, x, y, size]) => `BT /F1 ${size} Tf 1 0 0 1 ${x} ${y} Tm (${text}) Tj ET`)
      .join("\n");
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`,
    );
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let body = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = body.length;
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

describe("extractPageTexts", () => {
  it("reads each run of text with its place and size, measured from the top", async () => {
    const texts = await extractPageTexts(
      pdf([
        [
          ["Halfvolle Melk", 50, 700, 11],
          ["2.", 150, 640, 50],
        ],
        [["Tweede pagina", 20, 780, 8]],
      ]),
    );
    expect(texts).toHaveLength(2);
    expect(texts[0]).toMatchObject({ number: 1, width: 600, height: 800 });
    expect(texts[0].items).toMatchObject([
      { text: "Halfvolle Melk", x: 50, y: 100, size: 11, rotated: false },
      { text: "2.", x: 150, y: 160, size: 50, rotated: false },
    ]);
    expect(texts[0].items[0].width).toBeGreaterThan(40);
    expect(texts[1].items).toMatchObject([{ text: "Tweede pagina", y: 20, size: 8 }]);
  });

  it("refuses bytes that are no PDF", async () => {
    await expect(extractPageTexts(new TextEncoder().encode("<html>not a pdf</html>"))).rejects.toThrow();
  });
});

describe("fetchOffers", () => {
  const cards = Array.from({ length: 12 }, (_, index) => {
    const x = 30 + (index % 3) * 190;
    const y = 780 - Math.floor(index / 3) * 190;
    return { name: `Product ${String.fromCharCode(97 + index)}oos`, x, y };
  });
  /** Twelve cards on one page, in PDF coordinates, laid out like card() above. */
  const flyerPdf = (count = cards.length) =>
    pdf([
      [
        ...cards.slice(0, count).flatMap(({ name, x, y }): [string, number, number, number][] => [
          [name, x, y, 11],
          ["Pak 500 gram", x, y - 13, 8],
          ["3.49", x + 110, y - 8, 11],
          ["2.", x + 100, y - 60, 50],
          ["99", x + 142, y - 45, 35],
        ]),
        ["Acties zijn geldig t/m zaterdag 14 november", 20, 10, 7],
      ],
    ]);
  const PDF_URL = readPdfUrl(fixture("publication.json"))!;

  function http(overrides: { page?: string; description?: string; bytes?: Uint8Array; status?: number } = {}) {
    const get = vi.fn(async (url: string) => ({
      status: 200,
      url,
      text:
        url === VOMAR_FOLDERS_URL
          ? (overrides.page ?? fixture("folders.html"))
          : (overrides.description ?? fixture("publication.json")),
    }));
    const getBytes = vi.fn(async (url: string) => ({
      status: overrides.status ?? 200,
      url,
      bytes: overrides.bytes ?? flyerPdf(),
    }));
    return { get, getBytes };
  }

  it("follows the folders page to the flyer's PDF and reads its offers", async () => {
    const client = http();
    const offers = await vomarAdapter.fetchOffers(ctx(client));
    expect(client.get.mock.calls.map(([url]) => url)).toEqual([VOMAR_FOLDERS_URL, `${FLYER}/data.json`]);
    expect(client.getBytes).toHaveBeenCalledTimes(1);
    expect(client.getBytes).toHaveBeenCalledWith(PDF_URL, { maxBytes: 250_000_000, timeoutMs: 180_000 });
    expect(offers).toHaveLength(12);
    expect(offers[0]).toMatchObject({
      sourceUrl: FLYER,
      payload: { name: "Product aoos", price: "2.99", regularPrice: "3.49", weekEnd: "14 november" },
    });
    expect(normalize(offers[0])).toMatchObject({ currentPriceCents: 299, regularPriceCents: 349 });
  });

  it("stops before the flyer when the folders page embeds none", async () => {
    const client = http({ page: "<html></html>" });
    await expect(vomarAdapter.fetchOffers(ctx(client))).rejects.toThrow(/exactly one weekly flyer/);
    expect(client.get).toHaveBeenCalledTimes(1);
    expect(client.getBytes).not.toHaveBeenCalled();
  });

  it("downloads nothing when the description is not Vomar's", async () => {
    const client = http({ description: JSON.stringify({ accountName: "Iemand", config: {} }) });
    await expect(vomarAdapter.fetchOffers(ctx(client))).rejects.toThrow(/names no Vomar PDF/);
    expect(client.getBytes).not.toHaveBeenCalled();
  });

  it("fails the run when the PDF is not served", async () => {
    await expect(vomarAdapter.fetchOffers(ctx(http({ status: 404 })))).rejects.toThrow(/status 404/);
  });

  it("fails the run when too little can be read, as after a change of layout", async () => {
    await expect(vomarAdapter.fetchOffers(ctx(http({ bytes: flyerPdf(4) })))).rejects.toThrow(/only 4 offers/);
  });
});
