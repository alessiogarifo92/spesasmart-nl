import { parsePriceCents } from "@/domain/pricing";
import type { Mode, Options } from "./types";

/** What the shopper can set on the plan screen. Carried in the address, so a plan can be reloaded and shared. */
export type PlanSettings = {
  maxStores: 1 | 2 | 3;
  mode: Mode;
  /** A very similar product (same size, another brand) may replace the one picked when it is cheaper. */
  similar: boolean;
  /** Budget in cents; null for none. */
  budgetCents: number | null;
};

export const PLAN_MODES: readonly Mode[] = ["max-savings", "fewest-stores", "offers-only", "organic-only"];

export const DEFAULT_PLAN_SETTINGS: PlanSettings = {
  maxStores: 2,
  mode: "max-savings",
  similar: true,
  budgetCents: null,
};

/** A budget above this is a typing mistake, not a grocery budget. */
export const MAX_BUDGET_CENTS = 9_999_00;

type RawParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | null {
  const text = Array.isArray(value) ? value[0] : value;
  return text === undefined ? null : text.trim();
}

/** A budget typed in euros ("60", "60,50", "€ 60.5"); null when empty, not a price, zero or absurd. */
export function parseBudget(text: string | null): number | null {
  if (text === null || text.length > 12) return null;
  // One decimal ("60,5") is how people type half a euro; the price parser wants two.
  const price = parsePriceCents(text.replace(/([.,]\d)$/, "$10"));
  return price.ok && price.value <= MAX_BUDGET_CENTS ? price.value : null;
}

/** Reads the settings from search parameters; anything unrecognised falls back to the default, never an error. */
export function parsePlanSettings(params: RawParams): PlanSettings {
  const stores = first(params.stores);
  const mode = first(params.mode);
  return {
    maxStores: stores === "1" ? 1 : stores === "3" ? 3 : stores === "2" ? 2 : DEFAULT_PLAN_SETTINGS.maxStores,
    mode: PLAN_MODES.find((known) => known === mode) ?? DEFAULT_PLAN_SETTINGS.mode,
    similar: first(params.similar) !== "0",
    budgetCents: parseBudget(first(params.budget)),
  };
}

/** The budget as it is written in the address and prefilled in the field: "60" or "60.50". */
export function budgetText(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

/** The query string for a set of settings ("" for the defaults), with a stable parameter order. */
export function planSettingsQuery(settings: PlanSettings): string {
  const query = new URLSearchParams();
  if (settings.maxStores !== DEFAULT_PLAN_SETTINGS.maxStores) query.set("stores", String(settings.maxStores));
  if (settings.mode !== DEFAULT_PLAN_SETTINGS.mode) query.set("mode", settings.mode);
  if (!settings.similar) query.set("similar", "0");
  if (settings.budgetCents !== null) query.set("budget", budgetText(settings.budgetCents));
  const text = query.toString();
  return text ? `?${text}` : "";
}

/** What the optimiser takes. Another size never competes on price; a very similar product does when allowed. */
export function toOptions(settings: PlanSettings): Options {
  return {
    maxStores: settings.maxStores,
    mode: settings.mode,
    substitutes: settings.similar ? "similar" : "same",
    budgetCents: settings.budgetCents,
  };
}
