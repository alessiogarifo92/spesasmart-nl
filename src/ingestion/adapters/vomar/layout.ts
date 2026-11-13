import type { RawOffer } from "../../adapter";
import { cleanText } from "../text";

/**
 * Reads offers out of the positioned text of Vomar's weekly flyer (layout seen in
 * week 46 of 2026). The flyer is a designed page, not a list, so an offer is taken
 * only when its parts are found by position without doubt: one large price, one
 * small former price right above it, and one text block that is unmistakably the
 * nearest. Everything else is skipped and counted, never guessed.
 */

/** One run of text: `y` is the baseline measured from the top of the page, `size` the font size. */
export type TextItem = { text: string; x: number; y: number; width: number; size: number; rotated: boolean };
export type PageText = { number: number; width: number; height: number; items: TextItem[] };

export type FlyerOffers = { offers: RawOffer[]; skipped: { page: number; reason: string; near: string }[] };

type Box = { left: number; right: number; top: number; bottom: number };
type Tag = Box & { euros: TextItem; price: string; regular: string; badge: string; parts: TextItem[] };
type Block = Box & { labels: string[]; name: string[]; details: string[] };

const EUROS = /^(\d{1,2})\.$/;
const ROUND = /^(\d{1,2})\.-$/;
const CENTS = /^\d{2}$/;
const REGULAR = /^\d{1,3}\.\d{2}(?: - \d{1,3}\.\d{2})?$/;
const DAY_LABEL = /^(\d{1,2}) (jan|feb|mrt|apr|mei|jun|jul|aug|sep|okt|nov|dec)$/;
const WEEK_END = /^Acties zijn geldig t\/m (?:[a-z]+ )?(\d{1,2} [a-z]+)$/i;
const NOT_A_NAME = /^(?:alle soorten|per |pak |prijsvoorbeeld|m\.u\.v\.|van \d)/i;
const EXCLUSION = /^m\.u\.v\.? /i;
const DAYS_BANNER = /^All[eé]+n op donderdag, vrijdag & zaterdag!$/i;

/** Smallest font size of the large offer price. */
const MIN_PRICE_SIZE = 30;
/** Largest font size of product text. */
const MAX_TEXT_SIZE = 15;
/** Farthest a product text may be from its price tag, in points. */
const MAX_DISTANCE = 220;

const boxOf = (item: TextItem): Box => ({
  left: item.x,
  right: item.x + item.width,
  top: item.y - item.size,
  bottom: item.y,
});

function union(boxes: Box[]): Box {
  return {
    left: Math.min(...boxes.map((box) => box.left)),
    right: Math.max(...boxes.map((box) => box.right)),
    top: Math.min(...boxes.map((box) => box.top)),
    bottom: Math.max(...boxes.map((box) => box.bottom)),
  };
}

function gap(a: Box, b: Box): number {
  const dx = Math.max(0, a.left - b.right, b.left - a.right);
  const dy = Math.max(0, a.top - b.bottom, b.top - a.bottom);
  return Math.hypot(dx, dy);
}

/** The flyer draws some text twice (fill and outline): keep one of each. */
function distinct(items: TextItem[]): TextItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.text}|${item.x}|${item.y}|${item.size}`;
    if (item.text.trim() === "" || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** A price tag: the large price, the former price right above it and the badge on top. */
function readTag(euros: TextItem, items: TextItem[]): Tag | string | null {
  const size = euros.size;
  let price: string;
  let priceBox = boxOf(euros);
  const round = ROUND.exec(euros.text);
  if (round) {
    price = `${round[1]}.00`;
  } else {
    const whole = EUROS.exec(euros.text);
    if (!whole) return null;
    const cents = items.filter(
      (item) =>
        !item.rotated &&
        CENTS.test(item.text) &&
        item.size >= 0.62 * size &&
        item.size <= 0.85 * size &&
        item.x >= euros.x + euros.width - 0.35 * size &&
        item.x <= euros.x + euros.width + 0.2 * size &&
        euros.y - item.y >= 0 &&
        euros.y - item.y <= 0.4 * size,
    );
    if (cents.length !== 1) return "offer price unreadable";
    price = `${whole[1]}.${cents[0].text}`;
    priceBox = union([priceBox, boxOf(cents[0])]);
  }

  const regulars = items.filter(
    (item) =>
      !item.rotated &&
      REGULAR.test(item.text) &&
      item.size >= 0.14 * size &&
      item.size <= 0.32 * size &&
      euros.y - item.y >= 0.8 * size &&
      euros.y - item.y <= 1.15 * size &&
      Math.abs(item.x - euros.x) <= 0.5 * size,
  );
  if (regulars.length !== 1) return "former price not found above the offer price";
  const regular = regulars[0];
  // Anything else printed on the same line ("- 4.89", "per kilo") changes what the figure means.
  const sameLine = items.filter(
    (item) =>
      item !== regular &&
      !item.rotated &&
      Math.abs(item.y - regular.y) <= 1 &&
      Math.abs(item.size - regular.size) <= 1 &&
      item.x > regular.x &&
      item.x <= regular.x + regular.width + 2 * regular.size,
  );
  if (sameLine.length > 0) return "former price has more text on its line";

  const badgeItems = items
    .filter((item) => {
      const centre = item.x + item.width / 2;
      return (
        !item.rotated &&
        item !== regular &&
        item.size >= 0.3 * size &&
        item.y < regular.y - 1 &&
        item.y >= regular.y - 1.6 * size &&
        centre >= priceBox.left - size &&
        centre <= priceBox.right + size
      );
    })
    .sort((a, b) => a.y - b.y || a.x - b.x);
  // "500", "GRAM" and "500 GRAM" are all drawn: a run inside a longer one on the same line is dropped.
  const badgeTexts = badgeItems
    .filter(
      (item) =>
        !badgeItems.some(
          (other) =>
            other !== item &&
            other.y === item.y &&
            other.text.length > item.text.length &&
            other.text.includes(item.text) &&
            other.x <= item.x + 1 &&
            other.x + other.width >= item.x + item.width - 1,
        ),
    )
    .map((item) => cleanText(item.text));
  const box = union([priceBox, boxOf(regular), ...badgeItems.map(boxOf)]);
  return { ...box, euros, price, regular: regular.text, badge: badgeTexts.join(" "), parts: [regular, ...badgeItems] };
}

/** Product texts: lines sharing a left edge, close together. The largest lines are the name. */
function readBlocks(items: TextItem[], used: Set<TextItem>): Block[] {
  const lines = items.filter(
    (item) => !item.rotated && !used.has(item) && item.size <= MAX_TEXT_SIZE && !REGULAR.test(item.text),
  );
  // Columns first (lines sharing a left edge), then each column is cut where the lines stop following each other.
  const columns: TextItem[][] = [];
  for (const line of lines) {
    const column = columns.find((candidate) => Math.abs(candidate[0].x - line.x) <= 1.5);
    if (column) column.push(line);
    else columns.push([line]);
  }
  const groups: TextItem[][] = [];
  for (const column of columns) {
    column.sort((a, b) => a.y - b.y);
    let group: TextItem[] = [];
    for (const line of column) {
      const previous = group.at(-1);
      if (previous && line.y - previous.y > 2.5 * Math.max(previous.size, line.size)) {
        groups.push(group);
        group = [];
      }
      group.push(line);
    }
    if (group.length > 0) groups.push(group);
  }

  const blocks: Block[] = [];
  for (const group of groups) {
    const nameSize = Math.max(...group.map((line) => line.size));
    if (nameSize < 9.5) continue;
    const isName = (line: TextItem) => line.size >= nameSize - 0.6;
    const first = group.findIndex(isName);
    let last = first;
    while (last + 1 < group.length && isName(group[last + 1])) last++;
    // Name lines must sit together: a second large run further down is another product.
    if (group.slice(last + 1).some(isName)) continue;
    const name = joinLines(group.slice(first, last + 1).map((line) => line.text));
    // A product name is short, has lower-case letters and is not a line of small print.
    if (last - first >= 4 || name.length > 70 || !/[a-zà-ÿ]/.test(name) || NOT_A_NAME.test(name)) continue;
    blocks.push({
      ...union(group.map(boxOf)),
      labels: group.slice(0, first).map((line) => cleanText(line.text)),
      name: group.slice(first, last + 1).map((line) => cleanText(line.text)),
      details: group.slice(last + 1).map((line) => cleanText(line.text)),
    });
  }
  return blocks;
}

/** A product text belongs left of its price tag, or above it. */
function eligible(block: Block, tag: Tag): boolean {
  const left = block.right <= tag.left + 5 && block.top < tag.bottom + 10 && block.bottom > tag.top;
  const above = block.bottom <= tag.top + 15 && block.left < tag.right && block.right > tag.left;
  return left || above;
}

/** Words broken over two lines ("Mini Ham-" / "burgers") are joined again. */
function joinLines(lines: string[]): string {
  // Lone bullets are what is left of a list whose entries sit in another column.
  const kept = lines.filter((line) => !/^[•·\s]*$/.test(line));
  return cleanText(kept.join(" ").replace(/([a-zà-ÿ])- (?=[a-zà-ÿ])/g, "$1"));
}

/** The flyer's own end date, printed on the front page. */
export function readWeekEnd(pages: PageText[]): string | null {
  for (const page of pages) {
    for (const item of page.items) {
      const match = WEEK_END.exec(cleanText(item.text));
      if (match) return match[1];
    }
  }
  return null;
}

export function parseVomarFlyer(pages: PageText[], sourceUrl: string): FlyerOffers {
  const weekEnd = readWeekEnd(pages);
  const offers: RawOffer[] = [];
  const skipped: FlyerOffers["skipped"] = [];

  for (const page of pages) {
    const items = distinct(page.items);
    const tags: Tag[] = [];
    const used = new Set<TextItem>();
    for (const item of items) {
      if (item.rotated || item.size < MIN_PRICE_SIZE) continue;
      const tag = readTag(item, items);
      if (tag === null) continue;
      if (typeof tag === "string") skipped.push({ page: page.number, reason: tag, near: item.text });
      else tags.push(tag);
    }
    for (const tag of tags) for (const part of tag.parts) used.add(part);
    const blocks = readBlocks(items, used);

    // "Only on Thursday, Friday and Saturday": the banner closes the box above it, which carries its dates.
    const banner = items.find((item) => !item.rotated && DAYS_BANNER.test(cleanText(item.text)));
    const days = banner
      ? [...new Set(items.filter((item) => DAY_LABEL.test(item.text) && item.y < banner.y).map((item) => item.text))]
      : [];

    const nearest = (tag: Tag) =>
      blocks
        .filter((block) => eligible(block, tag))
        .map((block) => ({ block, distance: gap(block, tag) }))
        .filter((candidate) => candidate.distance <= MAX_DISTANCE)
        .sort((a, b) => a.distance - b.distance);

    for (const tag of tags) {
      const near = `${tag.price} (${tag.regular})`;
      const skip = (reason: string) => skipped.push({ page: page.number, reason, near });
      const candidates = nearest(tag);
      if (candidates.length === 0) {
        skip("no product text next to the price");
        continue;
      }
      const [best, second] = candidates;
      if (second && second.distance < best.distance * 1.5 + 10) {
        skip("two product texts are about as close to the price");
        continue;
      }
      // The text must not be nearer to another price.
      const rival = tags.some(
        (other) => other !== tag && eligible(best.block, other) && gap(best.block, other) <= best.distance,
      );
      if (rival) {
        skip("the product text is as close to another price");
        continue;
      }
      const inDaysBox = banner !== undefined && tag.bottom < banner.y;
      // An exclusion printed next to the price ("M.u.v. gekoeld") is part of the offer.
      const exclusions = items.filter(
        (item) => !item.rotated && EXCLUSION.test(item.text) && gap(boxOf(item), tag) <= 30,
      );
      offers.push({
        sourceUrl,
        payload: {
          page: page.number,
          name: joinLines(best.block.name),
          labels: best.block.labels.join(" | ") || null,
          details: joinLines(best.block.details) || null,
          exclusion: exclusions.map((item) => cleanText(item.text)).join(" ") || null,
          badge: tag.badge || null,
          price: tag.price,
          regularPrice: tag.regular,
          weekEnd,
          days: inDaysBox ? days.join(", ") : null,
          daysOnly: inDaysBox,
        },
      });
    }
  }
  return { offers, skipped };
}
