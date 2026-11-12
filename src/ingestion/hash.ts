import { createHash } from "node:crypto";
import { normalizeName } from "@/domain/search/normalize";
import type { NormalizedOffer } from "./adapter";

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** JSON with object keys sorted at every level, so equal content gives equal text. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Content hash of an offer that the source identifies with a stable key. */
export function dedupeKeyHash(retailerSlug: string, dedupeKey: string): string {
  return sha256(`${retailerSlug}:${dedupeKey}`);
}

/**
 * The deduplication key of an offer within a retailer (`Offer.contentHash`). Collecting
 * the same offer again gives the same hash; a changed price, mechanic or validity gives a
 * new one. With a `dedupeKey` the source's own key decides instead.
 */
export function offerContentHash(retailerSlug: string, offer: NormalizedOffer): string {
  if (offer.dedupeKey !== undefined) return dedupeKeyHash(retailerSlug, offer.dedupeKey);
  return sha256(
    `${retailerSlug}:${canonicalJson({
      externalId: offer.product.externalId,
      title: normalizeName(offer.title),
      kind: offer.kind,
      promotion: offer.promotion,
      currentPriceCents: offer.currentPriceCents,
      regularPriceCents: offer.regularPriceCents,
      validFrom: offer.validity?.start ?? null,
      validUntil: offer.validity?.end ?? null,
    })}`,
  );
}
