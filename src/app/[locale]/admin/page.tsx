import type { Metadata } from "next";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { AdminGate } from "@/components/admin/admin-gate";
import { PageHeader } from "@/components/shell/page-header";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { parseEnabledAdapters } from "@/ingestion/switches";
import { cn } from "@/lib/cn";
import { db } from "@/lib/db";
import { adminOverview, type AdminRetailer, type AdminRun, type RetailerSwitch } from "@/server/admin";
import {
  adminLogoutAction,
  renameCategoryAction,
  resolveFeedbackAction,
  retailerSwitchAction,
} from "@/server/admin-actions";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin" });
  return { title: t("title"), robots: { index: false, follow: false } };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-display text-[16px] leading-6 font-semibold">{title}</h2>
      {children}
    </section>
  );
}

const STATUS_TONE: Record<AdminRun["status"], string> = {
  RUNNING: "border-line text-muted",
  SUCCESS: "border-accent text-accent",
  PARTIAL: "border-warn text-warn",
  FAILED: "border-warn text-warn",
  SKIPPED: "border-line text-muted",
};

const fieldClass = "h-11 rounded-card border border-line bg-bg px-3 text-body text-text";

export default async function AdminPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <AdminGate>
      {async () => {
        const t = await getTranslations("admin");
        const format = await getFormatter();
        const overview = await adminOverview(db, parseEnabledAdapters(process.env.INGESTION_ENABLED_ADAPTERS));
        const when = (date: Date) =>
          format.dateTime(date, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Amsterdam" });

        const Switch = ({
          retailer,
          field,
          label,
        }: {
          retailer: AdminRetailer;
          field: RetailerSwitch;
          label: string;
        }) => {
          const on = retailer[field];
          return (
            <form action={retailerSwitchAction} className="flex items-center justify-between gap-3">
              <input type="hidden" name="retailerId" value={retailer.id} />
              <input type="hidden" name="field" value={field} />
              <span className="text-body">{label}</span>
              <button
                type="submit"
                name="value"
                value={on ? "off" : "on"}
                aria-pressed={on}
                aria-label={t(on ? "turnOff" : "turnOn", { label: `${retailer.name}, ${label}` })}
                data-testid={`switch-${retailer.slug}-${field}`}
                className={cn(
                  "inline-flex min-h-11 min-w-20 items-center justify-center rounded-pill border px-4 text-[13px] leading-5 font-semibold",
                  on ? "border-accent text-accent" : "border-line text-muted",
                )}
              >
                {t(on ? "on" : "off")}
              </button>
            </form>
          );
        };

        return (
          <>
            <PageHeader
              title={t("title")}
              trailing={
                <form action={adminLogoutAction}>
                  <button type="submit" className={buttonClass("secondary")}>
                    {t("signOut")}
                  </button>
                </form>
              }
            />

            <Card tone="outlined" className="flex flex-col gap-3" data-testid="admin-review">
              <div className="flex flex-col gap-0.5">
                <h2 className="font-display text-[16px] leading-6 font-semibold">{t("reviewTitle")}</h2>
                <p className="text-muted">{t("reviewCount", { count: overview.reviewCount })}</p>
              </div>
              <ButtonLink href="/admin/matches" variant={overview.reviewCount > 0 ? "primary" : "secondary"}>
                {t("reviewOpen")}
              </ButtonLink>
            </Card>

            <Section title={t("chainsTitle")}>
              <p className="text-label text-muted">{t("adapterHint")}</p>
              {overview.retailers.map((retailer) => (
                <Card key={retailer.id} className="flex flex-col gap-2" data-testid="admin-chain">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="font-semibold">{retailer.name}</h3>
                    <span className="text-label text-muted">{t("chainProducts", { count: retailer.products })}</span>
                  </div>
                  <Switch retailer={retailer} field="active" label={t("switchActive")} />
                  <Switch retailer={retailer} field="adapterEnabled" label={t("switchAdapter")} />
                  {retailer.adapterEnabled && !retailer.listedInEnv && (
                    <p className="text-label text-warn">{t("notListed")}</p>
                  )}
                </Card>
              ))}
            </Section>

            <Section title={t("runsTitle")}>
              {overview.runs.length === 0 && <p className="text-muted">{t("runsEmpty")}</p>}
              {overview.runs.map((run) => (
                <Card key={run.id} className="flex flex-col gap-1" data-testid="admin-run">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate font-semibold">{run.adapter}</span>
                    <span
                      className={cn(
                        "shrink-0 rounded-pill border px-2 py-1 text-[11px] leading-4 font-semibold",
                        STATUS_TONE[run.status],
                      )}
                    >
                      {t(`status.${run.status}`)}
                    </span>
                  </div>
                  <span className="text-label text-muted">
                    {when(run.startedAt)} · {t("runItems", { found: run.itemsFound, updated: run.itemsUpdated })}
                  </span>
                  {run.errorCount > 0 && (
                    <div className="flex flex-col gap-0.5 text-label text-warn">
                      <span className="font-semibold">{t("runErrors", { count: run.errorCount })}</span>
                      {run.errors.map((message, index) => (
                        <span key={index} className="break-words">
                          {message}
                        </span>
                      ))}
                    </div>
                  )}
                </Card>
              ))}
            </Section>

            <Section title={t("feedbackTitle")}>
              {overview.feedback.length === 0 && <p className="text-muted">{t("feedbackEmpty")}</p>}
              {overview.feedback.map((entry) => (
                <Card key={entry.id} className="flex items-center justify-between gap-3" data-testid="admin-feedback">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-label font-semibold text-warn">{t(`feedbackKind.${entry.kind}`)}</span>
                    {entry.productId ? (
                      <Link href={`/product/${entry.productId}`} className="-my-1 inline-flex min-h-11 items-center font-semibold underline">
                        {entry.productName}
                      </Link>
                    ) : (
                      <span className="text-muted">{t("feedbackNoProduct")}</span>
                    )}
                    <span className="text-label text-muted">
                      {[entry.retailerName, when(entry.createdAt)].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                  <form action={resolveFeedbackAction} className="shrink-0">
                    <input type="hidden" name="feedbackId" value={entry.id} />
                    <button type="submit" className={buttonClass("secondary")}>
                      {t("feedbackResolve")}
                    </button>
                  </form>
                </Card>
              ))}
            </Section>

            <Section title={t("categoriesTitle")}>
              {overview.categories.map((category) => (
                <Card key={category.id} className="flex flex-col gap-1" data-testid="admin-category">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="font-semibold">{category.nameNl}</h3>
                    <span className="text-label text-muted">{t("chainProducts", { count: category.products })}</span>
                  </div>
                  <details>
                    <summary className="flex min-h-11 cursor-pointer list-none items-center text-[13px] leading-5 font-semibold text-accent underline [&::-webkit-details-marker]:hidden">
                      {t("categoryEdit")}
                    </summary>
                    <form action={renameCategoryAction} className="flex flex-col gap-2 pt-1">
                      <input type="hidden" name="categoryId" value={category.id} />
                      {(["nameNl", "nameEn", "nameIt"] as const).map((field) => (
                        <label key={field} className="flex flex-col gap-1">
                          <span className="text-label text-muted">{t(field)}</span>
                          <input
                            name={field}
                            defaultValue={category[field]}
                            required
                            maxLength={60}
                            className={fieldClass}
                          />
                        </label>
                      ))}
                      <button type="submit" className={buttonClass("secondary")}>
                        {t("save")}
                      </button>
                    </form>
                  </details>
                </Card>
              ))}
            </Section>
          </>
        );
      }}
    </AdminGate>
  );
}
