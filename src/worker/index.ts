/**
 * Ingestion worker: registers one daily job per adapter on the `ingestion` queue and
 * processes the jobs one at a time. `npm run worker`; needs REDIS_URL and DATABASE_URL.
 */
import "dotenv/config";
import { Queue, Worker } from "bullmq";
import { createRunnerDeps } from "@/ingestion/deps";
import { rebuildMatches } from "@/ingestion/match-products";
import { allAdapters, findAdapter } from "@/ingestion/registry";
import { runAdapter } from "@/ingestion/runner";
import { createIngestionProcessor } from "./process";
import { INGESTION_QUEUE, registerSchedules, type IngestionJobData } from "./schedule";

async function main() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error("REDIS_URL is not set; see .env.example");
  const { db } = await import("@/lib/db");
  // BullMQ workers need maxRetriesPerRequest: null on their Redis connection.
  const connection = { url: redisUrl, maxRetriesPerRequest: null };

  const queue = new Queue<IngestionJobData>(INGESTION_QUEUE, { connection });
  const adapters = allAdapters();
  await registerSchedules(queue, adapters);

  const processor = createIngestionProcessor({
    findAdapter,
    // A fresh deps object per job: a new HTTP client re-reads robots.txt on every run.
    run: async (adapter) => {
      const run = await runAdapter(adapter, createRunnerDeps(db, process.env));
      // New listings may be the same product as one another chain already has.
      if (run.status !== "FAILED" && run.status !== "SKIPPED") await rebuildMatches(db);
      return run;
    },
  });
  const worker = new Worker<IngestionJobData>(INGESTION_QUEUE, (job) => processor(job.data), {
    connection,
    concurrency: 1,
  });
  worker.on("completed", (job, summary) => {
    console.log(`worker: ${job.data.adapterId} ${JSON.stringify(summary)}`);
  });
  worker.on("failed", (job, error) => {
    console.error(`worker: ${job?.data.adapterId ?? "unknown job"} failed: ${error.message}`);
  });
  console.log(`worker: ${adapters.length} adapters scheduled on queue "${INGESTION_QUEUE}"`);

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    console.log(`worker: ${signal} received, finishing the current job`);
    await worker.close();
    await queue.close();
    await db.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
