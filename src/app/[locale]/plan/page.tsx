import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PlanSettings } from "@/components/plan/plan-settings";
import { PlanStops } from "@/components/plan/plan-stops";
import { PlanNotes, PlanTotal, SingleStores } from "@/components/plan/plan-summary";
import { PageHeader } from "@/components/shell/page-header";
import { ButtonLink } from "@/components/ui/button";
import { DemoBadge } from "@/components/ui/demo-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { parsePlanSettings } from "@/domain/optimizer";
import { amsterdamToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { readDeviceId } from "@/server/device";
import { buildPlan } from "@/server/plan";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "plan" });
  return { title: t("title") };
}

export default async function PlanPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("plan");
  const settings = parsePlanSettings(await searchParams);
  const deviceId = await readDeviceId();
  const view = deviceId ? await buildPlan(db, deviceId, settings, amsterdamToday(new Date())) : null;

  if (!view || view.itemCount === 0) {
    return (
      <>
        <PageHeader title={t("title")} />
        <EmptyState
          title={t("emptyTitle")}
          body={t("emptyBody")}
          action={<ButtonLink href="/list">{t("emptyAction")}</ButtonLink>}
        />
      </>
    );
  }

  const header = (
    <PageHeader
      title={t("title")}
      eyebrow={t("eyebrow", { name: view.list.name, count: view.openCount })}
      trailing={view.isDemo ? <DemoBadge /> : undefined}
    />
  );
  if (view.openCount === 0) {
    return (
      <>
        {header}
        <EmptyState
          title={t("allCheckedTitle")}
          body={t("allCheckedBody")}
          action={<ButtonLink href="/list">{t("toList")}</ButtonLink>}
        />
      </>
    );
  }

  return (
    <>
      {header}
      <PlanSettings settings={settings} />
      {view.plan.stops.length === 0 && <EmptyState title={t("nothingFoundTitle")} body={t("nothingFoundBody")} />}
      <PlanStops view={view} settings={settings} />
      {view.plan.stops.length > 0 && (
        <>
          <PlanNotes view={view} />
          <PlanTotal view={view} settings={settings} />
          <SingleStores view={view} />
        </>
      )}
    </>
  );
}
