import type { RetailerAdapter } from "@/ingestion/adapter";
import type { runAdapter } from "@/ingestion/runner";
import type { IngestionJobData } from "./schedule";

type IngestionRun = Awaited<ReturnType<typeof runAdapter>>;

export type JobSummary = { runId: string; status: IngestionRun["status"]; itemsFound: number; itemsUpdated: number };

/**
 * The worker's job handler: finds the adapter named in the job and runs it once. An
 * unknown id fails the job; adapter problems are already recorded on the run row.
 */
export function createIngestionProcessor(deps: {
  findAdapter: (id: string) => RetailerAdapter | undefined;
  run: (adapter: RetailerAdapter) => Promise<Pick<IngestionRun, "id" | "status" | "itemsFound" | "itemsUpdated">>;
}) {
  return async (data: IngestionJobData): Promise<JobSummary> => {
    const adapter = deps.findAdapter(data.adapterId);
    if (!adapter) throw new Error(`Unknown adapter "${data.adapterId}"`);
    const run = await deps.run(adapter);
    return { runId: run.id, status: run.status, itemsFound: run.itemsFound, itemsUpdated: run.itemsUpdated };
  };
}
