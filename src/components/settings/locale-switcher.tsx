"use client";

import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { getPathname, usePathname } from "@/i18n/navigation";
import { locales } from "@/i18n/routing";

/** Each language is named in itself, so it is readable whatever the current one is. */
const names: Record<(typeof locales)[number], string> = {
  nl: "Nederlands",
  en: "English",
  it: "Italiano",
};

export function LocaleSwitcher() {
  const t = useTranslations("more");
  const current = useLocale();
  const pathname = usePathname();

  return (
    <nav aria-label={t("language")}>
      <ul className="m-0 grid list-none grid-cols-3 gap-2 p-0">
        {locales.map((locale) => (
          <li key={locale}>
            {/*
              A plain link, so the browser loads the page afresh. The client router can replay an
              answer it fetched before the switch, when the language cookie said something else,
              and land on the previous language. The prefix is always written, the default
              language included: it is what tells the server which language was chosen.
            */}
            <a
              href={getPathname({ href: pathname, locale, forcePrefix: true })}
              lang={locale}
              hrefLang={locale}
              // The choice is written before the request leaves, the same session cookie the
              // server sets, so it holds even when the reply is handled by the service worker.
              onClick={() => {
                document.cookie = `NEXT_LOCALE=${locale}; Path=/; SameSite=lax`;
              }}
              aria-current={locale === current ? "true" : undefined}
              className={cn(
                "flex min-h-11 items-center justify-center rounded-pill border px-3 text-body font-semibold",
                locale === current ? "border-accent bg-surface text-accent" : "border-line bg-surface text-text",
              )}
            >
              {names[locale]}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
