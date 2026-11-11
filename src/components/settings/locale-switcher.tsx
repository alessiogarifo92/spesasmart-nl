"use client";

import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { Link, usePathname } from "@/i18n/navigation";
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
            <Link
              href={pathname}
              locale={locale}
              lang={locale}
              hrefLang={locale}
              aria-current={locale === current ? "true" : undefined}
              className={cn(
                "flex min-h-11 items-center justify-center rounded-pill border px-3 text-body font-semibold",
                locale === current ? "border-accent bg-surface text-accent" : "border-line bg-surface text-text",
              )}
            >
              {names[locale]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
