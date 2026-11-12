import type { RetailerAdapter } from "@/ingestion/adapter";

/** The one BullMQ queue for collection runs. */
export const INGESTION_QUEUE = "ingestion";
export const INGESTION_JOB = "ingest";
export const SCHEDULE_TIME_ZONE = "Europe/Amsterdam";
/** First run of the day, minutes after midnight in Amsterdam (05:15). */
const FIRST_RUN_MINUTE = 5 * 60 + 15;
/** Gap between the scheduled runs of consecutive adapters. */
const STAGGER_MINUTES = 10;
const MINUTES_PER_DAY = 24 * 60;

export type IngestionJobData = { adapterId: string };

/** The part of a BullMQ `Queue` the schedules need; a fake in tests. */
export type SchedulerQueue = {
  upsertJobScheduler(
    jobSchedulerId: string,
    repeat: { pattern: string; tz: string },
    template: { name: string; data: IngestionJobData },
  ): Promise<unknown>;
};

/** Daily cron for the adapter at `index`: 05:15, 05:25, … Europe/Amsterdam. */
export function scheduleAt(index: number): { pattern: string; tz: string } {
  const minuteOfDay = (FIRST_RUN_MINUTE + index * STAGGER_MINUTES) % MINUTES_PER_DAY;
  return { pattern: `${minuteOfDay % 60} ${Math.floor(minuteOfDay / 60)} * * *`, tz: SCHEDULE_TIME_ZONE };
}

/** Upserts one daily job scheduler per adapter; safe to call on every worker start. */
export async function registerSchedules(queue: SchedulerQueue, adapters: RetailerAdapter[]): Promise<void> {
  for (const [index, adapter] of adapters.entries()) {
    await queue.upsertJobScheduler(`${INGESTION_JOB}:${adapter.id}`, scheduleAt(index), {
      name: INGESTION_JOB,
      data: { adapterId: adapter.id },
    });
  }
}
