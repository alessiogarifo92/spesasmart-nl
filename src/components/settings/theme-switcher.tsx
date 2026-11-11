"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { isTheme, THEME_STORAGE_KEY, themes, type Theme } from "./theme";

const labels = { system: "themeSystem", dark: "themeDark", light: "themeLight" } as const;
const listeners = new Set<() => void>();

function read(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function choose(theme: Theme) {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Private mode: the choice lasts for this page only.
  }
  listeners.forEach((listener) => listener());
}

export function ThemeSwitcher() {
  const t = useTranslations("more");
  const current = useSyncExternalStore<Theme>(subscribe, read, () => "system");

  return (
    <div role="radiogroup" aria-label={t("theme")} className="grid grid-cols-3 gap-2">
      {themes.map((theme) => (
        <button
          key={theme}
          type="button"
          role="radio"
          aria-checked={current === theme}
          onClick={() => choose(theme)}
          className={cn(
            "min-h-11 rounded-pill border px-3 text-body font-semibold",
            current === theme ? "border-accent bg-surface text-accent" : "border-line bg-surface text-text",
          )}
        >
          {t(labels[theme])}
        </button>
      ))}
    </div>
  );
}
