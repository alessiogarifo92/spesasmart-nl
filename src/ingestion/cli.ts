/**
 * One collection run without Redis: `tsx src/ingestion/cli.ts <adapter-id|all>`.
 * Prints one line per run: adapter, status, items found, items updated, errors.
 */
import "dotenv/config";
import { createRunnerDeps } from "./deps";
import { selectAdapters } from "./registry";
import { runAll } from "./runner";

async function main() {
  const selection = process.argv[2];
  if (!selection) {
    console.error("Usage: tsx src/ingestion/cli.ts <adapter-id|all>");
    process.exit(2);
  }
  const adapters = selectAdapters(selection);
  const { db } = await import("@/lib/db");
  try {
    const runs = await runAll(adapters, createRunnerDeps(db, process.env));
    for (const run of runs) {
      const errors = Array.isArray(run.errors) ? run.errors.length : 0;
      console.log(
        `${run.adapter} ${run.status} found=${run.itemsFound} updated=${run.itemsUpdated} errors=${errors}`,
      );
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
