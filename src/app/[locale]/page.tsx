import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { PageHeader } from "@/components/shell/page-header";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchField } from "@/components/ui/search-field";
import { amsterdamToday, isoWeek } from "@/lib/dates";

// The header shows today's date, so the page is rendered per request.
export const dynamic = "force-dynamic";

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");
  const format = await getFormatter();
  const now = new Date();
  const date = format.dateTime(now, { weekday: "short", day: "numeric", month: "short" });

  return (
    <>
      <PageHeader
        title={t("title")}
        eyebrow={`${t("week", { week: isoWeek(amsterdamToday(now)) })} · ${date}`}
      />
      <EmptyState
        title={t("planEmptyTitle")}
        body={t("planEmptyBody")}
        action={<ButtonLink href="/list">{t("planEmptyAction")}</ButtonLink>}
      />
      <SearchField label={t("searchLabel")} placeholder={t("searchPlaceholder")} submitLabel={t("searchSubmit")} />
    </>
  );
}
