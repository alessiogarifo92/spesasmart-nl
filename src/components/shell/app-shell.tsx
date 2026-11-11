import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { BottomNav } from "./bottom-nav";

/** Single column, safe-area aware, with the bottom navigation always in reach. */
export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations("nav");
  return (
    <>
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-30 focus:rounded-card focus:bg-accent focus:px-4 focus:py-3 focus:text-on-accent"
      >
        {t("skip")}
      </a>
      <main
        id="content"
        className="mx-auto flex w-full max-w-130 flex-col gap-4 px-5 pt-[env(safe-area-inset-top)] pb-[calc(env(safe-area-inset-bottom)+88px)] pl-[max(20px,env(safe-area-inset-left))] pr-[max(20px,env(safe-area-inset-right))]"
      >
        {children}
      </main>
      <BottomNav />
    </>
  );
}
