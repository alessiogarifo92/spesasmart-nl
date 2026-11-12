import type { Plan, RetailerId } from "./types";

/** One sentence of "why this route?", as a code the interface turns into text. */
export type PlanNote =
  /** The plan against the cheapest single chain that sells everything the plan covers. */
  | { code: "saves-vs-single"; retailerId: RetailerId; singleTotalCents: number; savingCents: number }
  /** The plan is one chain, and no single chain does better for what it covers. */
  | { code: "one-store"; retailerId: RetailerId }
  | { code: "offer"; label: string; retailerId: RetailerId; savingCents: number; daysLeft: number | null }
  | { code: "cheaper"; label: string; retailerId: RetailerId; nextRetailerId: RetailerId; differenceCents: number };

/**
 * The few facts that explain a plan: what it saves against one chain, then the lines that
 * save the most, offers first. Never more than `maxLines` line notes, and nothing for an
 * empty plan. Every amount comes from the plan; nothing is estimated here.
 */
export function explainPlan(plan: Plan, maxLines = 2): PlanNote[] {
  const notes: PlanNote[] = [];
  if (plan.stops.length === 0) return notes;

  if (plan.comparison !== null && plan.comparison.savingCents > 0) {
    notes.push({
      code: "saves-vs-single",
      retailerId: plan.comparison.retailerId,
      singleTotalCents: plan.comparison.totalCents,
      savingCents: plan.comparison.savingCents,
    });
  } else if (plan.stops.length === 1 && plan.comparison === null) {
    notes.push({ code: "one-store", retailerId: plan.stops[0].retailerId });
  }

  const lineNotes: { saving: number; note: PlanNote }[] = [];
  for (const stop of plan.stops) {
    for (const line of stop.lines) {
      const { reason } = line;
      if (reason.code === "offer" && reason.savingCents !== null && reason.savingCents > 0) {
        lineNotes.push({
          saving: reason.savingCents,
          note: {
            code: "offer",
            label: line.label,
            retailerId: stop.retailerId,
            savingCents: reason.savingCents,
            daysLeft: reason.daysLeft,
          },
        });
      } else if (
        reason.code === "cheapest" &&
        reason.nextRetailerId !== null &&
        reason.differenceCents !== null &&
        reason.differenceCents > 0
      ) {
        lineNotes.push({
          saving: reason.differenceCents,
          note: {
            code: "cheaper",
            label: line.label,
            retailerId: stop.retailerId,
            nextRetailerId: reason.nextRetailerId,
            differenceCents: reason.differenceCents,
          },
        });
      }
    }
  }
  // Largest saving first; the sort is stable, so equal savings keep the plan's order.
  lineNotes.sort((a, b) => b.saving - a.saving);
  return [...notes, ...lineNotes.slice(0, Math.max(0, maxLines)).map((entry) => entry.note)];
}
