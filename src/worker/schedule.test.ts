import { describe, expect, it } from "vitest";
import { allAdapters } from "@/ingestion/registry";
import { INGESTION_QUEUE, registerSchedules, scheduleAt, type SchedulerQueue } from "./schedule";

function fakeQueue() {
  const calls: Parameters<SchedulerQueue["upsertJobScheduler"]>[] = [];
  const queue: SchedulerQueue = {
    async upsertJobScheduler(...args) {
      calls.push(args);
      return undefined;
    },
  };
  return { queue, calls };
}

describe("registerSchedules", () => {
  it("upserts one daily job per adapter from 05:15 Amsterdam, ten minutes apart", async () => {
    const { queue, calls } = fakeQueue();
    await registerSchedules(queue, allAdapters());

    expect(INGESTION_QUEUE).toBe("ingestion");
    expect(calls).toEqual([
      ["ingest:mock:ah", { pattern: "15 5 * * *", tz: "Europe/Amsterdam" }, { name: "ingest", data: { adapterId: "mock:ah" } }],
      ["ingest:mock:jumbo", { pattern: "25 5 * * *", tz: "Europe/Amsterdam" }, { name: "ingest", data: { adapterId: "mock:jumbo" } }],
      ["ingest:mock:vomar", { pattern: "35 5 * * *", tz: "Europe/Amsterdam" }, { name: "ingest", data: { adapterId: "mock:vomar" } }],
      ["ingest:mock:dirk", { pattern: "45 5 * * *", tz: "Europe/Amsterdam" }, { name: "ingest", data: { adapterId: "mock:dirk" } }],
    ]);
  });

  it("is idempotent: registering again upserts the same scheduler ids", async () => {
    const { queue, calls } = fakeQueue();
    await registerSchedules(queue, allAdapters());
    await registerSchedules(queue, allAdapters());
    const ids = calls.map(([id]) => id);
    expect(new Set(ids).size).toBe(4);
  });

  it("rolls the minutes over into the next hour and the next day", () => {
    expect(scheduleAt(4)).toEqual({ pattern: "55 5 * * *", tz: "Europe/Amsterdam" });
    expect(scheduleAt(5)).toEqual({ pattern: "5 6 * * *", tz: "Europe/Amsterdam" });
    expect(scheduleAt(113)).toEqual({ pattern: "5 0 * * *", tz: "Europe/Amsterdam" });
  });
});
