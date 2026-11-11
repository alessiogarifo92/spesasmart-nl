import { useTranslations } from "next-intl";

/** Shown on every screen that displays demo rows (`isDemo`). */
export function DemoBadge() {
  const t = useTranslations("common");
  return (
    <span
      title={t("demoDataHint")}
      className="inline-flex shrink-0 items-center rounded-pill border border-line px-2 py-1 text-[11px] leading-4 font-semibold text-muted"
    >
      {t("demoData")}
      <span className="sr-only">: {t("demoDataHint")}</span>
    </span>
  );
}
