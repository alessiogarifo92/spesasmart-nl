import { useTranslations } from "next-intl";

export default function Loading() {
  const t = useTranslations("common");
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-2 pt-4">
      <span className="sr-only">{t("loading")}</span>
      <div className="h-7 w-40 rounded-card bg-surface" />
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="h-28 rounded-card bg-surface" />
      ))}
    </div>
  );
}
