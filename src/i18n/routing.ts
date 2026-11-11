import { defineRouting } from "next-intl/routing";

/** Locales that are routed and translated today. Dutch is the default. */
export const locales = ["nl", "en", "it"] as const;
export type Locale = (typeof locales)[number];

/**
 * Locales planned for the Dutch market but not translated yet. To enable one,
 * add `messages/<locale>.json` and move it into `locales`.
 */
export const plannedLocales = ["pl", "tr", "ar"] as const;

const rtlLocales: readonly string[] = ["ar"];

export function textDirection(locale: string): "ltr" | "rtl" {
  return rtlLocales.includes(locale) ? "rtl" : "ltr";
}

export const routing = defineRouting({
  locales,
  defaultLocale: "nl",
  localePrefix: "as-needed",
});
