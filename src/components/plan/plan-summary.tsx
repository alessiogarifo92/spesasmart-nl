import { useTranslations } from "next-intl";
import { useMoney } from "@/components/offers/offer-card";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Disclaimer } from "@/components/ui/disclaimer";
import { explainPlan, type PlanNote, type PlanSettings } from "@/domain/optimizer";
import type { PlanView } from "@/server/plan";

/** "Why this route?": what it saves against one chain and the lines that save the most. */
export function PlanNotes({ view }: { view: PlanView }) {
  const t = useTranslations("plan");
  const money = useMoney();
  const name = (slug: string) => view.retailers[slug] ?? slug;
  const notes = explainPlan(view.plan);
  if (notes.length === 0) return null;

  const text = (note: PlanNote): string => {
    switch (note.code) {
      case "saves-vs-single":
        return t("noteSaves", {
          retailer: name(note.retailerId),
          total: money(note.singleTotalCents),
          saving: money(note.savingCents),
        });
      case "one-store":
        return t("noteOneStore", { retailer: name(note.retailerId) });
      case "offer":
        return note.daysLeft === null
          ? t("noteOffer", { item: note.label, retailer: name(note.retailerId), saving: money(note.savingCents) })
          : t("noteOfferDays", {
              item: note.label,
              retailer: name(note.retailerId),
              saving: money(note.savingCents),
              days: t("daysLeft", { days: note.daysLeft }),
            });
      case "cheaper":
        return t("noteCheaper", {
          item: note.label,
          retailer: name(note.retailerId),
          other: name(note.nextRetailerId),
          difference: money(note.differenceCents),
        });
    }
  };

  return (
    <Card tone="outlined" data-testid="plan-why" className="flex flex-col gap-1.5 px-3.5 py-3">
      <h2 className="text-body font-semibold text-accent">{t("whyTitle")}</h2>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px] leading-5">
        {notes.map((note, index) => (
          <li key={index}>{text(note)}</li>
        ))}
      </ul>
    </Card>
  );
}

/** The estimated total, what it saves, the budget, and the way on to the list. */
export function PlanTotal({ view, settings }: { view: PlanView; settings: PlanSettings }) {
  const t = useTranslations("plan");
  const money = useMoney();
  const { plan } = view;
  const { comparison } = plan;
  const saving = comparison !== null && comparison.savingCents > 0 ? comparison : null;

  return (
    <Card tone="outlined" data-testid="plan-total" className="flex flex-col gap-3 p-5">
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-label text-muted">
            {plan.coveredCount < plan.itemCount
              ? t("totalCovered", { covered: plan.coveredCount, total: plan.itemCount })
              : t("totalLabel")}
          </span>
          <span data-testid="plan-total-amount" className="font-display text-total font-semibold">
            {money(plan.totalCents)}
          </span>
        </div>
        {saving && (
          <span
            data-testid="plan-saving"
            className="shrink-0 font-display text-[16px] leading-6 font-semibold whitespace-nowrap text-accent"
          >
            {t("saved", { amount: money(saving.savingCents) })}
          </span>
        )}
      </div>

      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-label text-muted empty:hidden">
        {saving && (
          <li>
            {t("savedVs", {
              retailer: view.retailers[saving.retailerId] ?? saving.retailerId,
              total: money(saving.totalCents),
            })}
          </li>
        )}
        {plan.offerSavingCents > 0 && <li>{t("offerSaving", { amount: money(plan.offerSavingCents) })}</li>}
        {settings.budgetCents !== null &&
          (plan.overBudgetCents !== null ? (
            <li data-testid="plan-budget" className="font-semibold text-warn">
              {t("budgetOver", { amount: money(plan.overBudgetCents), budget: money(settings.budgetCents) })}
            </li>
          ) : (
            <li data-testid="plan-budget">{t("budgetUnder", { budget: money(settings.budgetCents) })}</li>
          ))}
        {plan.maxStoresExceeded && <li className="text-warn">{t("pinnedExceeded")}</li>}
      </ul>

      <ButtonLink href="/list">{t("toList")}</ButtonLink>
      <Disclaimer estimate />
    </Card>
  );
}

/** What the list costs at each chain on its own, under the same settings. */
export function SingleStores({ view }: { view: PlanView }) {
  const t = useTranslations("plan");
  const money = useMoney();
  const { plan } = view;
  // A chain that has nothing of the list (under this filter) is not a way to buy it.
  const stores = plan.singleStores.filter((store) => store.coveredCount > 0);
  if (stores.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-display text-[16px] leading-6 font-semibold">{t("singleTitle")}</h2>
      <Card className="px-3.5 py-3">
        <ul aria-label={t("singleTitle")} className="m-0 flex list-none flex-col gap-2.5 p-0">
          {stores.map((store) => (
            <li key={store.retailerId} data-testid="single-store" className="flex items-baseline justify-between gap-3">
              <span className="min-w-0">
                <span className="text-body font-semibold">{view.retailers[store.retailerId] ?? store.retailerId}</span>
                <span className="text-label text-muted">
                  {" · "}
                  {store.coveredCount === plan.itemCount
                    ? t("singleAll")
                    : t("singleCovered", { covered: store.coveredCount, total: plan.itemCount })}
                </span>
              </span>
              <span className="shrink-0 font-display text-body font-semibold">{money(store.totalCents)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
