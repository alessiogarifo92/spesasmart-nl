import { useTranslations } from "next-intl";
import { useMoney } from "@/components/offers/offer-card";
import { Card } from "@/components/ui/card";
import { RouteStop, RouteStops } from "@/components/ui/route-stops";
import { Link } from "@/i18n/navigation";
import type { PlanView } from "@/server/plan";

/** The week's plan on the home screen: total, saving and the stops, leading to the full route. */
export function PlanCard({ view }: { view: PlanView }) {
  const t = useTranslations("plan");
  const money = useMoney();
  const { plan } = view;
  const saving = plan.comparison !== null && plan.comparison.savingCents > 0 ? plan.comparison.savingCents : null;
  const link = (
    <Link
      href="/plan"
      className="-my-2 inline-flex min-h-11 items-center self-start text-[13px] leading-5 font-semibold text-accent"
    >
      {t("cardLink")}
    </Link>
  );

  if (plan.stops.length === 0) {
    return (
      <Card tone="outlined" data-testid="plan-card" className="flex flex-col gap-3 p-5">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-[18px] leading-6 font-semibold">{t("nothingFoundTitle")}</h2>
          <p className="text-muted">{t("nothingFoundBody")}</p>
        </div>
        {link}
      </Card>
    );
  }

  return (
    <Card tone="outlined" data-testid="plan-card" className="flex flex-col gap-4 p-5">
      <div className="flex items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-label text-muted">
            {t("cardEyebrow", { name: view.list.name, count: view.openCount })}
          </span>
          <span className="font-display text-total font-semibold">{money(plan.totalCents)}</span>
        </div>
        {saving !== null && (
          <span className="shrink-0 font-display text-[16px] leading-6 font-semibold whitespace-nowrap text-accent">
            {t("saved", { amount: money(saving) })}
          </span>
        )}
      </div>

      <RouteStops label={t("stopsLabel")}>
        {plan.stops.map((stop, index) => (
          <RouteStop key={stop.retailerId} connected={index < plan.stops.length - 1}>
            <div className="flex justify-between gap-3">
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[15px] leading-5 font-semibold">
                  {view.retailers[stop.retailerId] ?? stop.retailerId}
                </span>
                <span className="text-label text-muted">{t("stopCount", { count: stop.lines.length })}</span>
              </span>
              <span className="shrink-0 font-display text-[15px] leading-5 font-medium">
                {money(stop.subtotalCents)}
              </span>
            </div>
          </RouteStop>
        ))}
      </RouteStops>

      {plan.missing.length > 0 && (
        <p className="text-label font-semibold text-warn">{t("cardMissing", { count: plan.missing.length })}</p>
      )}
      {link}
    </Card>
  );
}
