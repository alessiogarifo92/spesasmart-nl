import type { RetailerAdapter } from "./adapter";
import { MOCK_ADAPTERS } from "./adapters/mock";

/** Every adapter the worker schedules. Real adapters are added by their own tickets. */
export function allAdapters(): RetailerAdapter[] {
  return [...MOCK_ADAPTERS];
}

export function findAdapter(id: string): RetailerAdapter | undefined {
  return allAdapters().find((adapter) => adapter.id === id);
}

/** "all" or one adapter id; throws for an unknown id, naming the known ones. */
export function selectAdapters(selection: string): RetailerAdapter[] {
  if (selection === "all") return allAdapters();
  const adapter = findAdapter(selection);
  if (!adapter) {
    const known = allAdapters().map((candidate) => candidate.id).join(", ");
    throw new Error(`Unknown adapter "${selection}"; known: ${known}`);
  }
  return [adapter];
}
