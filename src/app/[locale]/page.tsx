import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { OfferList } from "@/components/offers/offer-card";
import { PlanCard } from "@/components/plan/plan-card";
import { PageHeader } from "@/components/shell/page-header";
import { ButtonLink } from "@/components/ui/button";
import { DemoBadge } from "@/components/ui/demo-badge";
import { Disclaimer } from "@/components/ui/disclaimer";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchField } from "@/components/ui/search-field";
import { DEFAULT_PLAN_SETTINGS } from "@/domain/optimizer";
import { Link } from "@/i18n/navigation";
import { amsterdamToday, isoWeek } from "@/lib/dates";
import { db } from "@/lib/db";
import { readDeviceId } from "@/server/device";
import { homeOffers, type OfferView } from "@/server/offers";
import { buildPlan } from "@/server/plan";

// The header shows today's date, the offers change daily and the plan is the device's own: rendered per request.
export const dynamic = "force-dynamic";

function OfferSection({ title, offers, allLabel }: { title: string; offers: OfferView[]; allLabel?: string }) {
  if (offers.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-[16px] leading-6 font-semibold">{title}</h2>
        {allLabel && (
          <Link
            href="/offers"
            className="-my-3 inline-flex min-h-11 items-center pl-3 text-label font-medium text-accent"
          >
            {allLabel}
          </Link>
        )}
      </div>
      <OfferList offers={offers} label={title} />
    </section>
  );
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");
  const plan = await getTranslations("plan");
  const format = await getFormatter();
  const now = new Date();
  const today = amsterdamToday(now);
  const date = format.dateTime(now, { weekday: "short", day: "numeric", month: "short" });
  const deviceId = await readDeviceId();
  const [offers, view] = await Promise.all([
    homeOffers(db, today),
    deviceId ? buildPlan(db, deviceId, DEFAULT_PLAN_SETTINGS, today) : null,
  ]);
  const shown = [...offers.endingToday, ...offers.thisWeek, ...offers.upcoming];

  return (
    <>
      <PageHeader
        title={t("title")}
        eyebrow={`${t("week", { week: isoWeek(today) })} · ${date}`}
        trailing={view?.isDemo || shown.some((offer) => offer.isDemo) ? <DemoBadge /> : undefined}
      />
      {view && view.openCount > 0 ? (
        <PlanCard view={view} />
      ) : view && view.itemCount > 0 ? (
        <EmptyState
          title={plan("allCheckedTitle")}
          body={plan("allCheckedBody")}
          action={<ButtonLink href="/list">{plan("toList")}</ButtonLink>}
        />
      ) : (
        <EmptyState
          title={t("planEmptyTitle")}
          body={t("planEmptyBody")}
          action={<ButtonLink href="/list">{t("planEmptyAction")}</ButtonLink>}
        />
      )}
      <SearchField label={t("searchLabel")} placeholder={t("searchPlaceholder")} submitLabel={t("searchSubmit")} />

      {offers.total === 0 ? (
        <EmptyState title={t("noOffersTitle")} body={t("noOffersBody")} />
      ) : (
        <>
          <OfferSection title={t("endsTodayTitle")} offers={offers.endingToday} allLabel={t("allOffers")} />
          <OfferSection
            title={t("watchTitle")}
            offers={offers.thisWeek}
            allLabel={offers.endingToday.length === 0 ? t("allOffers") : undefined}
          />
          <OfferSection title={t("upcomingTitle")} offers={offers.upcoming} />
          <Disclaimer />
        </>
      )}
    </>
  );
}
