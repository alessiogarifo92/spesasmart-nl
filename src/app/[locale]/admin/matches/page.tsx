import type { Metadata } from "next";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { AdminGate } from "@/components/admin/admin-gate";
import { PageHeader } from "@/components/shell/page-header";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { MATCH_DECISIONS, REVIEW_PAGE_SIZE, reviewQueue, type ReviewSide } from "@/server/admin";
import { decideMatchAction } from "@/server/admin-actions";

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ page?: string | string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin" });
  return { title: t("queueTitle"), robots: { index: false, follow: false } };
}

function pageNumber(value: string | string[] | undefined): number {
  const page = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1;
}

export default async function AdminMatchesPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const page = pageNumber((await searchParams).page);

  return (
    <AdminGate>
      {async () => {
        const t = await getTranslations("admin");
        const pieces = (await getTranslations("product"))("pieces");
        const format = await getFormatter();
        const { items, total } = await reviewQueue(db, page);
        const pages = Math.max(1, Math.ceil(total / REVIEW_PAGE_SIZE));

        const size = (side: ReviewSide): string => {
          if (side.unit === null || side.packageAmount === null) return t("unknownSize");
          const unit = side.unit === "G" ? "g" : side.unit === "ML" ? "ml" : pieces;
          const one = `${format.number(side.packageAmount)} ${unit}`;
          return side.packageCount > 1 ? `${side.packageCount} × ${one}` : one;
        };
        const Side = ({ side }: { side: ReviewSide }) => (
          <div className="flex flex-col gap-0.5">
            <span className="text-label text-muted">{side.retailerName}</span>
            <Link href={`/product/${side.id}`} className="-my-1 inline-flex min-h-11 items-center font-semibold underline">
              {side.name}
            </Link>
            <span className="text-label text-muted">
              {[
                side.brand,
                size(side),
                side.priceCents === null
                  ? t("noPrice")
                  : format.number(side.priceCents / 100, { style: "currency", currency: "EUR" }),
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
        );

        return (
          <>
            <PageHeader title={t("queueTitle")} eyebrow={t("reviewCount", { count: total })} />
            <ButtonLink href="/admin" variant="secondary" className="self-start">
              {t("queueBack")}
            </ButtonLink>
            {items.length === 0 ? (
              <p className="text-muted">{t("queueEmpty")}</p>
            ) : (
              <p className="text-muted">{t("queueIntro")}</p>
            )}
            {items.map((item) => (
              <Card key={item.id} tone="outlined" className="flex flex-col gap-3" data-testid="review-item">
                {item.reported && <span className="text-label font-semibold text-warn">{t("reported")}</span>}
                <Side side={item.left} />
                <Side side={item.right} />
                <span className="text-label text-muted">
                  {t("suggested", {
                    type: t(`type.${item.matchType}`),
                    percent: format.number(item.confidence, { style: "percent", maximumFractionDigits: 0 }),
                  })}
                </span>
                <form action={decideMatchAction} className="grid grid-cols-2 gap-2">
                  <input type="hidden" name="matchId" value={item.id} />
                  {MATCH_DECISIONS.map((decision) => (
                    <button
                      key={decision}
                      type="submit"
                      name="decision"
                      value={decision}
                      className={buttonClass(
                        decision === "REJECT" ? "warn" : decision === item.matchType ? "primary" : "secondary",
                        "px-2 text-[13px] leading-5",
                      )}
                    >
                      {t(`decide.${decision}`)}
                    </button>
                  ))}
                </form>
              </Card>
            ))}
            {pages > 1 && (
              <nav className="flex items-center justify-between gap-3">
                {page > 1 ? (
                  <ButtonLink href={`/admin/matches?page=${page - 1}`} variant="secondary">
                    {t("pagePrevious")}
                  </ButtonLink>
                ) : (
                  <span />
                )}
                <span className="text-label text-muted">{t("pageOf", { page, pages })}</span>
                {page < pages ? (
                  <ButtonLink href={`/admin/matches?page=${page + 1}`} variant="secondary">
                    {t("pageNext")}
                  </ButtonLink>
                ) : (
                  <span />
                )}
              </nav>
            )}
          </>
        );
      }}
    </AdminGate>
  );
}
