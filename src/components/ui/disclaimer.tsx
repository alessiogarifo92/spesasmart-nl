import { useTranslations } from "next-intl";

/** The line required wherever a price or a total is shown. */
export function Disclaimer({ estimate = false }: { estimate?: boolean }) {
  const t = useTranslations("common");
  return (
    <p className="text-[11px] leading-4 text-muted">
      {estimate && `${t("estimate")} `}
      {t("disclaimer")}
    </p>
  );
}
