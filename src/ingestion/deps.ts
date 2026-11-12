import { setTimeout as delay } from "node:timers/promises";
import type { PrismaClient } from "@/generated/prisma/client";
import { createHttpClient } from "./http";
import type { RunnerDeps } from "./runner";
import { parseEnabledAdapters } from "./switches";

/** Reads INGESTION_USER_AGENT and INGESTION_ENABLED_ADAPTERS. */
type IngestionEnv = Record<string, string | undefined>;

/**
 * Runner dependencies for real runs (worker and CLI): the system clock, real `fetch` and
 * a fresh HTTP client per run. A missing or contact-less user agent fails the run that
 * asks for a client, with the reason recorded on the run.
 */
export function createRunnerDeps(db: PrismaClient, env: IngestionEnv): RunnerDeps {
  const now = () => new Date();
  return {
    db,
    now,
    enabledAdapters: parseEnabledAdapters(env.INGESTION_ENABLED_ADAPTERS),
    createHttp: () =>
      createHttpClient({
        userAgent: env.INGESTION_USER_AGENT ?? "",
        fetch: globalThis.fetch,
        now,
        sleep: async (ms) => {
          await delay(ms);
        },
      }),
  };
}
