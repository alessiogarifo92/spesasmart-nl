import type { RetailerAdapter } from "./adapter";
import { ahAdapter } from "./adapters/ah";
import { dirkAdapter } from "./adapters/dirk";
import { jumboAdapter } from "./adapters/jumbo";
import { MOCK_ADAPTERS } from "./adapters/mock";
import { vomarAdapter } from "./adapters/vomar";

/**
 * Adapters that make real requests. Each one runs only when its id is listed in
 * INGESTION_ENABLED_ADAPTERS and its chain has `adapterEnabled` switched on.
 */
export const REAL_ADAPTERS: readonly RetailerAdapter[] = [ahAdapter, jumboAdapter, vomarAdapter, dirkAdapter];

/** Every adapter the worker schedules. */
export function allAdapters(): RetailerAdapter[] {
  return [...MOCK_ADAPTERS, ...REAL_ADAPTERS];
}

export function findAdapter(id: string): RetailerAdapter | undefined {
  return allAdapters().find((adapter) => adapter.id === id);
}

/** "all" or one adapter id; throws for an unknown id, naming the known ones. */
export function selectAdapters(selection: string): RetailerAdapter[] {
  if (selection === "all") return allAdapters();
  const adapter = findAdapter(selection);
  if (!adapter) {
    const known = allAdapters()
      .map((candidate) => candidate.id)
      .join(", ");
    throw new Error(`Unknown adapter "${selection}"; known: ${known}`);
  }
  return [adapter];
}
