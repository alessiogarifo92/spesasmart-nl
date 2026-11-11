import { useLocale, useTranslations } from "next-intl";
import { buttonClass } from "@/components/ui/button";
import { ChipLink } from "@/components/ui/chip";
import {
  hasFilters,
  NO_FILTERS,
  offerFiltersQuery,
  toggleRetailer,
  type OfferFilters as Filters,
} from "@/domain/offers";
import { getPathname, Link } from "@/i18n/navigation";
import type { OfferFacets } from "@/server/offers";

const href = (filters: Filters) => `/offers${offerFiltersQuery(filters)}`;

/** Chains and period are one-tap chips; category, brand and organic sit in a small form. All of it is plain links and a GET form. */
export function OfferFilters({ filters, facets }: { filters: Filters; facets: OfferFacets }) {
  const t = useTranslations("offers");
  const locale = useLocale();
  const categoryName = (c: OfferFacets["categories"][number]) =>
    locale === "en" ? c.nameEn : locale === "it" ? c.nameIt : c.nameNl;
  const periods: { label: string; filters: Filters; selected: boolean }[] = [
    { label: t("periodAll"), filters: { ...filters, within: null, upcoming: false }, selected: !filters.within && !filters.upcoming },
    ...([1, 3, 7] as const).map((days) => ({
      label: t("within", { days }),
      filters: { ...filters, within: days, upcoming: false },
      selected: filters.within === days,
    })),
    { label: t("periodUpcoming"), filters: { ...filters, within: null, upcoming: true }, selected: filters.upcoming },
  ];
  const extraCount = [filters.category, filters.brand, filters.organic].filter(Boolean).length;
  const selectClass = "h-12 w-full rounded-card border border-line bg-surface px-3 text-input text-text";

  return (
    <section aria-label={t("filtersLabel")} className="flex flex-col gap-3">
      <div role="group" aria-label={t("chains")} className="flex flex-wrap gap-2">
        {facets.retailers.map((retailer) => (
          <ChipLink
            key={retailer.slug}
            href={href(toggleRetailer(filters, retailer.slug))}
            selected={filters.retailers.includes(retailer.slug)}
          >
            {retailer.name}
          </ChipLink>
        ))}
      </div>
      <div role="group" aria-label={t("period")} className="flex flex-wrap gap-2">
        {periods.map((period) => (
          <ChipLink key={period.label} href={href(period.filters)} selected={period.selected}>
            {period.label}
          </ChipLink>
        ))}
      </div>

      <details className="rounded-card border border-line" open={extraCount > 0}>
        <summary className="flex min-h-11 cursor-pointer items-center px-4 text-[13px] font-semibold">
          {t("moreFilters")}
          {extraCount > 0 && ` (${extraCount})`}
        </summary>
        <form action={getPathname({ href: "/offers", locale })} className="flex flex-col gap-3 px-4 pb-4">
          {filters.retailers.map((slug) => (
            <input key={slug} type="hidden" name="retailer" value={slug} />
          ))}
          {filters.upcoming && <input type="hidden" name="when" value="upcoming" />}
          {filters.within && <input type="hidden" name="within" value={filters.within} />}
          <label className="flex flex-col gap-1.5 text-label text-muted">
            {t("category")}
            <select name="category" defaultValue={filters.category ?? ""} className={selectClass}>
              <option value="">{t("categoryAll")}</option>
              {facets.categories.map((category) => (
                <option key={category.slug} value={category.slug}>
                  {categoryName(category)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-label text-muted">
            {t("brand")}
            <select name="brand" defaultValue={filters.brand ?? ""} className={selectClass}>
              <option value="">{t("brandAll")}</option>
              {facets.brands.map((brand) => (
                <option key={brand} value={brand}>
                  {brand}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-h-11 items-center gap-3 text-body">
            <input type="checkbox" name="organic" value="1" defaultChecked={filters.organic} className="size-5 accent-(--accent)" />
            {t("organic")}
          </label>
          <button type="submit" className={buttonClass("primary")}>
            {t("apply")}
          </button>
        </form>
      </details>

      {hasFilters(filters) && (
        <Link href={href(NO_FILTERS)} className="inline-flex min-h-11 items-center self-start text-[13px] font-semibold text-accent underline">
          {t("clear")}
        </Link>
      )}
    </section>
  );
}
