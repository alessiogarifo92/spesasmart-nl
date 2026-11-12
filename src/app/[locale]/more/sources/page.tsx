import type { Metadata } from "next";
import { connection } from "next/server";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { Disclaimer } from "@/components/ui/disclaimer";
import { Link } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { chainSources } from "@/server/sources";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "sources" });
  return { title: t("title") };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-display text-[16px] leading-6 font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Points({ items }: { items: string[] }) {
  return (
    <ul className="flex list-disc flex-col gap-1.5 pl-5 text-muted">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export default async function SourcesPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("sources");
  const format = await getFormatter();
  // Read on every request: without this the build would freeze each chain's state into a static page.
  await connection();
  const chains = await chainSources(db, new Date());

  return (
    <>
      <Link href="/more" className="-mb-2 inline-flex min-h-11 min-w-11 items-center self-start pt-2 text-[13px] font-semibold">
        ‹ {t("back")}
      </Link>
      <PageHeader title={t("title")} />
      <Section title={t("chainsTitle")}>
        <p className="text-muted">{t("chainsBody")}</p>
        <Card tone="outlined" className="flex flex-col gap-3">
          {chains.map((chain) => (
            <div key={chain.slug} data-testid={`source-${chain.slug}`} className="flex flex-col gap-0.5">
              <span className="font-semibold">{chain.name}</span>
              <span className="text-[13px] leading-5 text-muted">
                {t(`kind.${chain.kind}`)}
                {chain.lastCollectedAt &&
                  ` · ${t("collected", {
                    date: format.dateTime(chain.lastCollectedAt, {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "Europe/Amsterdam",
                    }),
                  })}`}
              </span>
            </div>
          ))}
        </Card>
        <p className="text-muted">{t("openData")}</p>
      </Section>
      <Section title={t("rulesTitle")}>
        <Points items={[t("rule1"), t("rule2"), t("rule3"), t("rule4"), t("rule5")]} />
      </Section>
      <Section title={t("unknownTitle")}>
        <Points items={[t("unknown1"), t("unknown2"), t("unknown3"), t("unknown4")]} />
      </Section>
      <Section title={t("reportTitle")}>
        <p className="text-muted">{t("reportBody")}</p>
      </Section>
      <Section title={t("independentTitle")}>
        <p className="text-muted">{t("independentBody")}</p>
        <Disclaimer />
      </Section>
    </>
  );
}
