import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { OfferFilters } from "@/components/offers/offer-filters";
import { OfferList } from "@/components/offers/offer-card";
import { PageHeader } from "@/components/shell/page-header";
import { ButtonLink } from "@/components/ui/button";
import { DemoBadge } from "@/components/ui/demo-badge";
import { Disclaimer } from "@/components/ui/disclaimer";
import { EmptyState } from "@/components/ui/empty-state";
import { hasFilters, parseOfferFilters } from "@/domain/offers";
import { amsterdamToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { readDeviceId } from "@/server/device";
import { listedQuantities } from "@/server/lists";
import { listOffers, offerFacets, type OfferView } from "@/server/offers";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Pick<Props, "params">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "offers" });
  return { title: t("title") };
}

type Listed = ReadonlyMap<string, number>;

function Section({ title, offers, listed }: { title: string; offers: OfferView[]; listed: Listed }) {
  if (offers.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-display text-[16px] leading-6 font-semibold">{title}</h2>
      <OfferList offers={offers} label={title} listed={listed} />
    </section>
  );
}

export default async function OffersPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("offers");
  const filters = parseOfferFilters(await searchParams);
  const today = amsterdamToday(new Date());
  const [{ offers, total }, facets, listed] = await Promise.all([
    listOffers(db, { today, filters }),
    offerFacets(db, today),
    listedQuantities(db, await readDeviceId()),
  ]);
  const inState = (...states: OfferView["summary"]["state"][]) =>
    offers.filter((offer) => states.includes(offer.summary.state));

  return (
    <>
      <PageHeader
        title={t("title")}
        eyebrow={t("count", { count: total })}
        trailing={offers.some((offer) => offer.isDemo) ? <DemoBadge /> : undefined}
      />
      {(facets.retailers.length > 0 || hasFilters(filters)) && <OfferFilters filters={filters} facets={facets} />}

      {total === 0 ? (
        hasFilters(filters) ? (
          <EmptyState
            title={t("noMatchTitle")}
            body={t("noMatchBody")}
            action={<ButtonLink href="/offers" variant="secondary">{t("clear")}</ButtonLink>}
          />
        ) : (
          <EmptyState title={t("emptyTitle")} body={t("emptyBody")} />
        )
      ) : (
        <>
          <Section title={t("runningTitle")} offers={inState("ends-today", "running")} listed={listed} />
          <Section title={t("unknownTitle")} offers={inState("unknown-validity")} listed={listed} />
          <Section title={t("upcomingTitle")} offers={inState("upcoming")} listed={listed} />
          {total > offers.length && <p className="text-label text-muted">{t("shownOf", { shown: offers.length, total })}</p>}
          <Disclaimer />
        </>
      )}
    </>
  );
}
