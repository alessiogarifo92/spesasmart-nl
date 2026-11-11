"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { Link, usePathname } from "@/i18n/navigation";

const items = [
  { href: "/", key: "plan", icon: "M5 4v7a4 4 0 0 0 4 4h2a4 4 0 0 1 4 4v1 M5 4h.01 M15 20h.01" },
  { href: "/offers", key: "offers", icon: "M4 12 12 4h7v7l-8 8z M15.5 8.5h.01" },
  { href: "/list", key: "list", icon: "M9 6h10 M9 12h10 M9 18h10 M5 6h.01 M5 12h.01 M5 18h.01" },
  { href: "/more", key: "more", icon: "M5 12h.01 M12 12h.01 M19 12h.01" },
] as const;

function isCurrent(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function BottomNav() {
  const t = useTranslations("nav");
  const pathname = usePathname();

  return (
    <nav
      aria-label={t("label")}
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-bg pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto grid max-w-130 list-none grid-cols-4 px-2 pt-1 pb-1">
        {items.map(({ href, key, icon }) => {
          const current = isCurrent(pathname, href);
          return (
            <li key={key}>
              <Link
                href={href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex min-h-13 flex-col items-center justify-center gap-0.5 rounded-card text-label",
                  current ? "font-semibold text-accent" : "text-muted",
                )}
              >
                <svg
                  aria-hidden="true"
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={current ? 2.4 : 2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d={icon} />
                </svg>
                {t(key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
