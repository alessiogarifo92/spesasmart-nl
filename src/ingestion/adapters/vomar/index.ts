import {
  fail,
  ok,
  parseQuantity,
  parseValidity,
  type IsoDate,
  type Promotion,
  type Quantity,
  type Validity,
} from "@/domain/pricing";
import { daysBetween } from "@/lib/dates";
import type { AdapterContext, NormalizedProduct, RawOffer, RetailerAdapter } from "../../adapter";
import { field } from "../text";
import { extractPageTexts } from "./extract";
import { parseVomarFlyer } from "./layout";

/** The page that embeds this week's flyer. robots.txt (2026-11-13) allows it. */
export const VOMAR_FOLDERS_URL = "https://www.vomar.nl/folders";
/** Where Vomar publishes the flyer. The host has no robots.txt (404). */
const FLYER_HOST = "view.publitas.com";
const FLYER_GROUP = "folder-deze-week";
/** The week-46 flyer was 92 MB; a file far beyond that is not the flyer. */
const MAX_FLYER_BYTES = 250_000_000;
const FLYER_TIMEOUT_MS = 180_000;
/** Fewer offers than this from a whole flyer means the layout changed. */
const MIN_OFFERS = 10;

/** The one flyer embedded on the folders page; null when there is none or more than one. */
export function findFlyerUrl(html: string): string | null {
  const text = html.replace(/\\u002F/gi, "/").replace(/\\\//g, "/");
  const pattern = new RegExp(String.raw`https://${FLYER_HOST.replace(/\./g, "\\.")}/${FLYER_GROUP}/([a-z0-9-]+)`, "g");
  const slugs = new Set([...text.matchAll(pattern)].map((match) => match[1]));
  if (slugs.size !== 1) return null;
  return `https://${FLYER_HOST}/${FLYER_GROUP}/${[...slugs][0]}`;
}

/** The PDF address from the flyer's own description; only Vomar's flyer on the flyer host is accepted. */
export function readPdfUrl(json: string): string | null {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const { accountName, config } = data as { accountName?: unknown; config?: { downloadPdfUrl?: unknown } };
  if (typeof accountName !== "string" || !/\bvomar\b/i.test(accountName)) return null;
  const pdf = config?.downloadPdfUrl;
  if (typeof pdf !== "string") return null;
  try {
    const url = new URL(pdf);
    return url.protocol === "https:" && url.hostname === FLYER_HOST && url.pathname.endsWith(".pdf") ? url.href : null;
  } catch {
    return null;
  }
}

const cents = (text: string) => Math.round(Number(text) * 100);

/** "7.49" or "6.49 - 6.65": the price before the offer, or the range across an assortment. */
function readRegular(text: string | null): { low: number; high: number } | null {
  const match = /^(\d{1,3}\.\d{2})(?: - (\d{1,3}\.\d{2}))?$/.exec(text ?? "");
  if (!match) return null;
  const low = cents(match[1]);
  const high = match[2] === undefined ? low : cents(match[2]);
  return low > 0 && high >= low ? { low, high } : null;
}

const COUNT_UNITS = "stuks?|flessen|pakken|blikken|zakken|potten|dozen|kratten|rollen|pack|bakken|bekers|netten";
const FREE_BADGE = /^(\d)\+(\d) gratis$/i;
const PERCENT_BADGE = /^(\d{1,2})% korting$/i;
const COUNT_BADGE = new RegExp(`^(\\d{1,2}) (${COUNT_UNITS})$`, "i");
/** A badge with a mechanic in it that none of the patterns above reads. */
/** "Per stuk van 3.99 tot 4.19. Prijsvoorbeeld: Salame": the printed prices are those of one product of the range. */
const PRICE_EXAMPLE = /prijsvoorbeeld|per stuk van \d/i;
/** The size as the whole badge: "500 GRAM", "1.5 LITER". */
const SIZE_BADGE = /^\d+(?:[.,]\d+)? (?:gram|kilo|ml|cl|liter)$/i;
const UNREAD_MECHANIC = /\+|%|gratis|korting|halve|voor\b|\be\b/i;

type Deal = {
  promotion: Promotion;
  currentPriceCents: number | null;
  regularPriceCents: number | null;
  /** The printed price covers several items whose single size the flyer does not state. */
  bundle: boolean;
};

/**
 * Turns the printed figures into a deal, and checks them against each other: the offer
 * price must be below the former price, and a stated mechanic must give the printed
 * price. A figure that does not add up means a part was read from the wrong place.
 */
export function readDeal(
  badge: string | null,
  price: number,
  regular: { low: number; high: number },
  text: string,
): Deal | string {
  const single = regular.low === regular.high ? regular.low : null;
  // The mechanic holds for the whole range; the two prices only for the example, so they are checked and not kept.
  const example = PRICE_EXAMPLE.test(text);
  if (price <= 0 || price >= regular.low) return "offer-price-not-below-former-price";

  const free = FREE_BADGE.exec(badge ?? "");
  if (free) {
    const buy = Number(free[1]);
    const total = buy + Number(free[2]);
    // The former price is that of the whole set; the offer price is what the set costs now.
    if (single === null || single % total !== 0) return "free-items-do-not-add-up";
    const unit = single / total;
    if (unit * buy !== price) return "free-items-do-not-add-up";
    return {
      promotion: { type: "X_PLUS_Y_FREE", buy, free: Number(free[2]) },
      currentPriceCents: null,
      regularPriceCents: example ? null : unit,
      bundle: false,
    };
  }

  const percent = PERCENT_BADGE.exec(badge ?? "");
  if (percent) {
    const off = Number(percent[1]);
    if (single === null || off <= 0) return "percentage-does-not-add-up";
    if (Math.abs((single * (100 - off)) / 100 - price) > 1) return "percentage-does-not-add-up";
    return {
      promotion: { type: "PERCENT_OFF", percent: off },
      currentPriceCents: example ? null : price,
      regularPriceCents: example ? null : single,
      bundle: false,
    };
  }
  // A plain price next to "price example" would be one product's price under the name of a range.
  if (example) return "example-price-without-mechanic";

  const count = COUNT_BADGE.exec(badge ?? "");
  if (count) {
    const quantity = Number(count[1]);
    // "30 STUKS" over "Tray 30 stuks" is the size of one pack, not a number of packs.
    const packSize = new RegExp(`(?:^|[^\\d,.])${quantity}[- ]?(?:${COUNT_UNITS})\\b`, "i").test(text);
    if (quantity >= 2 && !packSize) {
      return {
        promotion: { type: "X_FOR_PRICE", quantity, totalCents: price },
        currentPriceCents: null,
        regularPriceCents: single !== null && single % quantity === 0 ? single / quantity : null,
        bundle: true,
      };
    }
  } else if (badge !== null && UNREAD_MECHANIC.test(badge)) {
    return "badge-not-understood";
  }

  return { promotion: { type: "PRICE_CUT" }, currentPriceCents: price, regularPriceCents: single, bundle: false };
}

/** The size from the small print: the last sentence that is one plain size ("Tray 30 stuks", "Per 250 gram"). */
function readQuantity(details: string | null, badge: string | null): Quantity | null {
  const sentences = (details ?? "").split(/\. /).reverse();
  for (const sentence of sentences) {
    const size = parseQuantity(
      sentence
        .replace(/\.$/, "")
        .replace(/^(?:per|[a-z-]*(?:pak|zak|fles|tray|net|box|bak|blik|pot|beker|schaal|doos))\s+/i, "")
        .replace(/^à /i, ""),
    );
    if (size.ok) return size.value;
  }
  if (badge !== null && SIZE_BADGE.test(badge)) {
    const size = parseQuantity(badge);
    if (size.ok) return size.value;
  }
  return null;
}

const MONTHS = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

/** "12 nov, 13 nov, 14 nov" as dates in the week that ends on `weekEnd`: consecutive days only. */
function readDays(text: string | null, weekEnd: IsoDate): { start: IsoDate; end: IsoDate } | null {
  const dates: IsoDate[] = [];
  for (const label of (text ?? "").split(", ")) {
    const match = /^(\d{1,2}) ([a-z]{3})$/.exec(label);
    const month = match ? MONTHS.indexOf(match[2]) : -1;
    if (!match || month < 0) return null;
    // The year is the week's own; a week across New Year takes the year that puts the day inside it.
    const year = Number(weekEnd.slice(0, 4));
    const candidates = [year, year - 1].map(
      (candidate) => `${candidate}-${String(month + 1).padStart(2, "0")}-${match[1].padStart(2, "0")}`,
    );
    const date = candidates.find((candidate) => {
      const before = daysBetween(candidate, weekEnd);
      return before >= 0 && before <= 6;
    });
    if (date === undefined) return null;
    dates.push(date);
  }
  dates.sort();
  if (dates.length < 2) return null;
  for (let index = 1; index < dates.length; index++) {
    if (daysBetween(dates[index - 1], dates[index]) !== 1) return null;
  }
  return { start: dates[0], end: dates[dates.length - 1] };
}

/**
 * The flyer prints its last day ("t/m zaterdag 14 november") and no first day, so the
 * start stays unknown. A flyer that ends more than six days ahead may not have started:
 * its offers are refused until a later run finds it inside its last week.
 */
function readValidity(payload: RawOffer["payload"], today: IsoDate): Validity | string {
  const weekEnd = field(payload, "weekEnd");
  const parsed = weekEnd === null ? null : parseValidity(`t/m ${weekEnd}`, { today });
  if (!parsed || !parsed.ok) return "week-end-unreadable";
  const end = parsed.value.end;
  const ahead = daysBetween(today, end);
  if (ahead > 6) return "week-not-started";
  if (payload.daysOnly === true) {
    const days = readDays(field(payload, "days"), end);
    return days === null ? "offer-days-unreadable" : { ...days, approximate: false };
  }
  return { start: null, end, approximate: false };
}

function slug(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeProduct(raw: RawOffer) {
  const name = field(raw.payload, "name");
  if (name === null || slug(name) === "") return fail("name-missing");
  const product: NormalizedProduct = {
    // The flyer has no product numbers: the printed name is the only stable key.
    externalId: `flyer:${slug(name)}`,
    name,
    brand: null,
    ean: null,
    quantity: readQuantity(field(raw.payload, "details"), field(raw.payload, "badge")),
    categorySlug: null,
    isOrganic: /\bbio(?:logisch\w*)?\b/i.test(name),
    attributes: {},
  };
  return ok(product);
}

/**
 * Vomar's weekly flyer. Vomar publishes its offers only as a designed flyer, so this
 * adapter reads the flyer's text by position (see layout.ts) and keeps an offer only
 * when its figures agree with each other; the rest is reported as a run error and not
 * stored. Three requests per run: the folders page, the flyer's description, its PDF.
 * Dagknallers (a separate flyer whose offers are not dated per day) are not read.
 */
export const vomarAdapter: RetailerAdapter = {
  id: "vomar",
  retailerSlug: "vomar",
  isMock: false,
  maxRunsPerDay: 1,
  async fetchOffers(ctx: AdapterContext) {
    const page = await ctx.http.get(VOMAR_FOLDERS_URL);
    const flyerUrl = findFlyerUrl(page.text);
    if (flyerUrl === null) throw new Error("the folders page does not embed exactly one weekly flyer");
    const description = await ctx.http.get(`${flyerUrl}/data.json`);
    const pdfUrl = readPdfUrl(description.text);
    if (pdfUrl === null) throw new Error("the flyer's description names no Vomar PDF on the flyer host");
    const pdf = await ctx.http.getBytes(pdfUrl, { maxBytes: MAX_FLYER_BYTES, timeoutMs: FLYER_TIMEOUT_MS });
    if (pdf.status !== 200) throw new Error(`the flyer PDF answered with status ${pdf.status}`);

    // The PDF is read in memory and dropped: only names, prices and dates leave this function.
    const { offers } = parseVomarFlyer(await extractPageTexts(pdf.bytes), flyerUrl);
    if (offers.length < MIN_OFFERS) {
      throw new Error(`only ${offers.length} offers could be read from the flyer; its layout may have changed`);
    }
    return offers;
  },
  fetchUpcomingOffers: async () => [],
  fetchStoreLocations: async () => [],
  normalizeProduct,
  normalizeOffer(raw, ctx) {
    const product = normalizeProduct(raw);
    if (!product.ok) return product;
    const { payload } = raw;
    const price = /^\d{1,3}\.\d{2}$/.test(field(payload, "price") ?? "") ? cents(field(payload, "price")!) : null;
    const regular = readRegular(field(payload, "regularPrice"));
    if (price === null || regular === null) return fail("price-unreadable");
    const badge = field(payload, "badge");
    // "Per stuk van 7.99 tot" loses its second figure when the flyer sets it as a price of its own.
    const details = field(payload, "details")?.replace(/\s*Per stuk van \d+[.,]\d{2} tot$/i, "") || null;
    const deal = readDeal(badge, price, regular, `${product.value.name}. ${field(payload, "details") ?? ""}`);
    if (typeof deal === "string") return fail(deal);
    const validity = readValidity(payload, ctx.today);
    if (typeof validity === "string") return fail(validity);

    const labels = field(payload, "labels");
    const conditions = [
      labels !== null && /op ?= ?op/i.test(labels) ? "OP=OP" : null,
      regular.low !== regular.high ? `Normaal ${field(payload, "regularPrice")}` : null,
      details,
      field(payload, "exclusion"),
    ].filter((part): part is string => part !== null);
    const pageNumber = typeof payload.page === "number" ? payload.page : 1;
    return ok({
      // A price for several items says nothing about the size of one: no unit price is derived from it.
      product: deal.bundle ? { ...product.value, quantity: null } : product.value,
      title: product.value.name,
      kind: "WEEKLY" as const,
      promotion: deal.promotion,
      promoDescription: badge,
      currentPriceCents: deal.currentPriceCents,
      regularPriceCents: deal.regularPriceCents,
      validity,
      conditions: conditions.length > 0 ? conditions.join(" · ") : null,
      sourceUrl: `${raw.sourceUrl}/page/${pageNumber}`,
      rawPayload: payload,
      dedupeKey: `${product.value.externalId}:${validity.end}:${validity.start ?? "week"}`,
    });
  },
};
