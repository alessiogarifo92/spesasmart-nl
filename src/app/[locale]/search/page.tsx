import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ProductList } from "@/components/products/product-card";
import { useQuantityLabel } from "@/components/products/quantity-label";
import { PageHeader } from "@/components/shell/page-header";
import { DemoBadge } from "@/components/ui/demo-badge";
import { Disclaimer } from "@/components/ui/disclaimer";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchField } from "@/components/ui/search-field";
import { isEmptyQuery, parseQuery, type ParsedQuery } from "@/domain/search";
import { amsterdamToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { searchContext, searchProducts, type SearchHit } from "@/server/search";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "search" });
  const q = textOf((await searchParams).q);
  return { title: q ? `${q} · ${t("title")}` : t("title") };
}

function textOf(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim().slice(0, 120) ?? "";
}

/** What the search understood, so a synonym or a recognised size is never a surprise. */
function Understood({ query, category }: { query: ParsedQuery; category: string | null }) {
  const t = useTranslations("search");
  const pieces = useTranslations("product")("pieces");
  const quantityLabel = useQuantityLabel();
  const parts = [
    query.ean ? t("partEan", { ean: query.ean }) : null,
    query.terms.length > 0 ? query.terms.join(" ") : null,
    query.quantity ? t("partSize", { size: quantityLabel(query.quantity, pieces) }) : null,
    query.brand ? t("partBrand", { brand: query.brand }) : null,
    category ? t("partCategory", { category }) : null,
    query.organic ? t("partOrganic") : null,
    ...query.attributes.map((attribute) => t(`attribute.${attribute as "glutenFree" | "vegan" | "lactoseFree"}`)),
    query.cheapestFirst ? t("partCheapest") : null,
  ].filter(Boolean);
  return (
    <p className="text-label text-muted" data-testid="search-understood">
      {t("understood")}: <span className="text-text">{parts.join(" · ")}</span>
    </p>
  );
}

function Section({ title, hits }: { title: string; hits: SearchHit[] }) {
  if (hits.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-display text-[16px] leading-6 font-semibold">{title}</h2>
      <ProductList items={hits} label={title} />
    </section>
  );
}

export default async function SearchPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("search");
  const home = await getTranslations("home");
  const q = textOf((await searchParams).q);
  const field = (
    <SearchField label={home("searchLabel")} placeholder={home("searchPlaceholder")} submitLabel={home("searchSubmit")} defaultValue={q} />
  );

  const context = q ? await searchContext(db) : {};
  const query = parseQuery(q, context);
  if (isEmptyQuery(query)) {
    return (
      <>
        <PageHeader title={t("title")} />
        {field}
        <EmptyState title={t("emptyTitle")} body={t("emptyBody")} />
      </>
    );
  }

  const { hits, total, sizeFound } = await searchProducts(db, { query, today: amsterdamToday(new Date()) });
  const names = context.categories?.find((category) => category.slug === query.categorySlug)?.names;
  const category = names ? names[{ nl: 0, en: 1, it: 2 }[locale] ?? 0] : null;

  return (
    <>
      <PageHeader
        title={t("title")}
        eyebrow={t("count", { count: total })}
        trailing={hits.some((hit) => hit.product.isDemo) ? <DemoBadge /> : undefined}
      />
      {field}
      <Understood query={query} category={category} />

      {total === 0 ? (
        <EmptyState title={t("noResultsTitle", { query: q })} body={t("noResultsBody")} />
      ) : (
        <>
          {sizeFound ? (
            <>
              <Section title={t("sizeTitle")} hits={hits.filter((hit) => hit.sizeMatch)} />
              <Section title={t("otherSizesTitle")} hits={hits.filter((hit) => !hit.sizeMatch)} />
            </>
          ) : (
            <>
              {query.quantity && <p className="text-label text-warn">{t("sizeNotFound")}</p>}
              <ProductList items={hits} label={t("resultsLabel")} />
            </>
          )}
          {total > hits.length && <p className="text-label text-muted">{t("shownOf", { shown: hits.length, total })}</p>}
          <Disclaimer />
        </>
      )}
    </>
  );
}
