import type { RawValue } from "../adapter";

/** Page text as one line: whitespace runs (non-breaking spaces included) become one space. */
export function cleanText(value: string | undefined | null): string {
  return (value ?? "").replace(/[\s ]+/g, " ").trim();
}

/** A non-empty string field of a raw record, or null. */
export function field(payload: Record<string, RawValue>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** `href` as an absolute https URL on `host` (or a subdomain of it); anything else becomes `fallback`. */
export function sameSiteUrl(href: string | undefined, pageUrl: string, host: string, fallback: string): string {
  if (!href) return fallback;
  try {
    const url = new URL(href, pageUrl);
    const onHost = url.hostname === host || url.hostname.endsWith(`.${host}`);
    return url.protocol === "https:" && onHost ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}
