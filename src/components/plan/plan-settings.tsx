import { useLocale, useTranslations } from "next-intl";
import { buttonClass } from "@/components/ui/button";
import { ChipLink } from "@/components/ui/chip";
import {
  budgetText,
  DEFAULT_PLAN_SETTINGS,
  PLAN_MODES,
  planSettingsQuery,
  type Mode,
  type PlanSettings as Settings,
} from "@/domain/optimizer";
import { getPathname } from "@/i18n/navigation";

export const planHref = (settings: Settings) => `/plan${planSettingsQuery(settings)}`;

const MODE_KEY: Record<Mode, "modeMaxSavings" | "modeFewestStores" | "modeOffersOnly" | "modeOrganicOnly"> = {
  "max-savings": "modeMaxSavings",
  "fewest-stores": "modeFewestStores",
  "offers-only": "modeOffersOnly",
  "organic-only": "modeOrganicOnly",
};

/**
 * Number of stores and what to optimise for are one-tap chips; substitutes and the budget
 * sit in a small form. All of it is plain links and a GET form: the plan is in the address.
 */
export function PlanSettings({ settings }: { settings: Settings }) {
  const t = useTranslations("plan");
  const locale = useLocale();
  const extraCount = [!settings.similar, settings.budgetCents !== null].filter(Boolean).length;

  return (
    <section aria-label={t("settingsLabel")} className="flex flex-col gap-3">
      <div role="group" aria-label={t("storesLabel")} className="flex flex-wrap gap-2">
        {([1, 2, 3] as const).map((count) => (
          <ChipLink
            key={count}
            href={planHref({ ...settings, maxStores: count })}
            selected={settings.maxStores === count}
          >
            {t("stores", { count })}
          </ChipLink>
        ))}
      </div>
      <div role="group" aria-label={t("modeLabel")} className="flex flex-wrap gap-2">
        {PLAN_MODES.map((mode) => (
          <ChipLink key={mode} href={planHref({ ...settings, mode })} selected={settings.mode === mode}>
            {t(MODE_KEY[mode])}
          </ChipLink>
        ))}
      </div>

      <details className="rounded-card border border-line" open={extraCount > 0}>
        <summary className="flex min-h-11 cursor-pointer items-center px-4 text-[13px] font-semibold">
          {t("moreSettings")}
          {extraCount > 0 && ` (${extraCount})`}
        </summary>
        <div className="flex flex-col gap-4 px-4 pb-4">
          <div className="flex flex-col items-start gap-1.5">
            <ChipLink href={planHref({ ...settings, similar: !settings.similar })} selected={settings.similar}>
              {t("similar")}
            </ChipLink>
            <p className="text-label text-muted">{t("similarHint")}</p>
          </div>

          <form action={getPathname({ href: "/plan", locale })} className="flex flex-col gap-1.5">
            {settings.maxStores !== DEFAULT_PLAN_SETTINGS.maxStores && (
              <input type="hidden" name="stores" value={settings.maxStores} />
            )}
            {settings.mode !== DEFAULT_PLAN_SETTINGS.mode && <input type="hidden" name="mode" value={settings.mode} />}
            {!settings.similar && <input type="hidden" name="similar" value="0" />}
            <label htmlFor="plan-budget" className="text-label text-muted">
              {t("budgetLabel")}
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                id="plan-budget"
                name="budget"
                inputMode="decimal"
                maxLength={8}
                autoComplete="off"
                enterKeyHint="done"
                defaultValue={settings.budgetCents === null ? "" : budgetText(settings.budgetCents)}
                placeholder={t("budgetPlaceholder")}
                className="h-12 w-28 min-w-0 grow rounded-card border border-line bg-surface px-4 text-input text-text placeholder:text-muted"
              />
              <button type="submit" className={buttonClass("secondary", "h-12")}>
                {t("budgetApply")}
              </button>
              {settings.budgetCents !== null && (
                <ChipLink href={planHref({ ...settings, budgetCents: null })} className="min-h-12">
                  {t("budgetClear")}
                </ChipLink>
              )}
            </div>
          </form>
        </div>
      </details>
    </section>
  );
}
