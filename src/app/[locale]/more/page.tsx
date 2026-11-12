import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LocaleSwitcher } from "@/components/settings/locale-switcher";
import { ThemeSwitcher } from "@/components/settings/theme-switcher";
import { PageHeader } from "@/components/shell/page-header";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Disclaimer } from "@/components/ui/disclaimer";
import { readDeviceId } from "@/server/device";
import { forgetDeviceAction } from "@/server/list-actions";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "more" });
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

export default async function MorePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("more");
  const hasData = (await readDeviceId()) !== null;

  return (
    <>
      <PageHeader title={t("title")} />
      <Section title={t("language")}>
        <LocaleSwitcher />
      </Section>
      <Section title={t("theme")}>
        <ThemeSwitcher />
      </Section>
      <div className="only-in-browser">
        <Section title={t("installTitle")}>
          <Card tone="outlined" className="flex flex-col gap-2 text-muted">
            <p>{t("installAndroid")}</p>
            <p>{t("installIos")}</p>
          </Card>
        </Section>
      </div>
      <Section title={t("aboutTitle")}>
        <p className="text-muted">{t("aboutBody")}</p>
        <Disclaimer />
      </Section>
      <Section title={t("privacyTitle")}>
        <p className="text-muted">{t("privacyBody")}</p>
        {hasData && (
          <details>
            <summary className="flex min-h-11 cursor-pointer list-none items-center text-[13px] leading-5 font-semibold text-warn underline [&::-webkit-details-marker]:hidden">
              {t("forgetTitle")}
            </summary>
            <form action={forgetDeviceAction} className="flex flex-col gap-2 pt-1">
              <p className="text-muted">{t("forgetBody")}</p>
              <button type="submit" className={buttonClass("warn", "w-full")}>
                {t("forgetConfirm")}
              </button>
            </form>
          </details>
        )}
      </Section>
    </>
  );
}
