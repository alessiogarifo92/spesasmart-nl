import type { RetailerAdapter } from "./adapter";

/** Reads INGESTION_ENABLED_ADAPTERS ("jumbo,dirk"): adapter ids allowed to make real requests. */
export function parseEnabledAdapters(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((id) => id.trim().toLowerCase())
    .filter((id) => id !== "");
}

export type SwitchDecision = { run: true } | { run: false; reason: string };

/**
 * The two kill switches of a real adapter: its id in INGESTION_ENABLED_ADAPTERS and the
 * retailer's `adapterEnabled` column. Either one off stops it. A mock adapter makes no
 * requests, so it always runs.
 */
export function adapterSwitch(input: {
  adapter: RetailerAdapter;
  enabledAdapters: string[];
  retailerAdapterEnabled: boolean;
}): SwitchDecision {
  const { adapter, enabledAdapters, retailerAdapterEnabled } = input;
  if (adapter.isMock) return { run: true };
  if (!enabledAdapters.includes(adapter.id.toLowerCase())) {
    return { run: false, reason: `adapter "${adapter.id}" is not listed in INGESTION_ENABLED_ADAPTERS` };
  }
  if (!retailerAdapterEnabled) {
    return { run: false, reason: `retailer "${adapter.retailerSlug}" has adapterEnabled switched off` };
  }
  return { run: true };
}
