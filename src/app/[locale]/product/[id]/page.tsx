import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { ProductCard } from "@/components/products/product-card";
import { ReportForm } from "@/components/products/report-form";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { DemoBadge } from "@/components/ui/demo-badge";
import { Disclaimer } from "@/components/ui/disclaimer";
import { cn } from "@/lib/cn";
import { amsterdamToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { compareProduct, type ComparisonRow } from "@/server/comparison";
import { readDeviceId } from "@/server/device";
import { reportAction } from "@/server/feedback-actions";
import { listedQuantities } from "@/server/lists";

type Props = { params: Promise<{ locale: string; id: string }> };

const isId = (value: string) => /^[a-z0-9]{8,40}$/.test(value);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, id } = await params;
  const t = await getTranslations({ locale, namespace: "product" });
  const product = isId(id)
    ? await db.product.findFirst({ where: { id, retailer: { active: true } }, select: { name: true } })
    : null;
  return { title: product ? `${product.name} · ${t("comparisonTitle")}` : t("comparisonTitle") };
}

const TIER = { SAME: "tierSame", SIMILAR: "tierSimilar", ALTERNATIVE: "tierAlternative" } as const;

function Rows({
  title,
  hint,
  rows,
  productId,
  listed,
}: {
  title: string;
  hint?: string;
  rows: ComparisonRow[];
  productId: string;
  listed: ReadonlyMap<string, number>;
}) {
  const t = useTranslations("product");
  if (rows.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-display text-[16px] leading-6 font-semibold">{title}</h2>
        {hint && <p className="text-label text-muted">{hint}</p>}
      </div>
      <ul aria-label={title} className="m-0 flex list-none flex-col gap-3 p-0">
        {rows.map((row) => (
          <li key={row.matchId} className="flex flex-col" data-testid="comparison-row" data-tier={row.type}>
            <div className="flex items-center justify-between gap-3 px-1">
              <span className={cn("text-label font-semibold", row.type === "SAME" ? "text-accent" : "text-text")}>
                {t(TIER[row.type])}
              </span>
              <ReportForm
                action={reportAction}
                productId={productId}
                matchId={row.matchId}
                label={t("reportMatch")}
                description={t("reportMatchNamed", { name: row.product.name, retailer: row.product.retailer.name })}
                sent={t("reported")}
                failed={t("reportFailed")}
              />
            </div>
            <ProductCard
              product={row.product}
              lowestPrice={row.lowestPrice}
              bestUnitPrice={row.bestUnitPrice}
              listed={listed.get(row.product.id)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function ProductPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  if (!isId(id)) notFound();
  const [comparison, listed] = await Promise.all([
    compareProduct(db, id, amsterdamToday(new Date())),
    listedQuantities(db, await readDeviceId()),
  ]);
  if (!comparison) notFound();
  const t = await getTranslations("product");
  const { product, equals, alternatives } = comparison;
  const demo = [product, ...equals.map((row) => row.product), ...alternatives.map((row) => row.product)].some(
    (item) => item.isDemo,
  );

  return (
    <>
      <PageHeader
        title={t("comparisonTitle")}
        eyebrow={product.retailer.name}
        trailing={demo ? <DemoBadge /> : undefined}
      />
      <div className="flex flex-col">
        <ProductCard
          product={product}
          lowestPrice={product.lowestPrice}
          bestUnitPrice={product.bestUnitPrice}
          listed={listed.get(product.id)}
          compare={false}
        />
        <div className="px-1">
          <ReportForm
            action={reportAction}
            productId={product.id}
            label={t("reportPrice")}
            description={t("reportPriceNamed", { name: product.name, retailer: product.retailer.name })}
            sent={t("reported")}
            failed={t("reportFailed")}
          />
        </div>
      </div>

      {equals.length === 0 && alternatives.length === 0 ? (
        <Card tone="outlined" className="flex flex-col gap-1 p-5">
          <h2 className="font-display text-[18px] leading-6 font-semibold">{t("noMatchesTitle")}</h2>
          <p className="text-muted">{t("noMatchesBody")}</p>
        </Card>
      ) : (
        <>
          <Rows title={t("elsewhereTitle")} rows={equals} productId={product.id} listed={listed} />
          <Rows
            title={t("alternativesTitle")}
            hint={t("alternativesHint")}
            rows={alternatives}
            productId={product.id}
            listed={listed}
          />
          <p className="text-label text-muted">{t("matchNote")}</p>
        </>
      )}
      <Disclaimer />
    </>
  );
}
