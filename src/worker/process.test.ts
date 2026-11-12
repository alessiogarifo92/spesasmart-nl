import { describe, expect, it, vi } from "vitest";
import { mockDirk } from "@/ingestion/adapters/mock";
import { findAdapter } from "@/ingestion/registry";
import { createIngestionProcessor } from "./process";

describe("createIngestionProcessor", () => {
  it("runs the adapter named in the job and returns a summary of the run", async () => {
    const run = vi.fn(async () => ({ id: "run-1", status: "SUCCESS" as const, itemsFound: 4, itemsUpdated: 4 }));
    const process = createIngestionProcessor({ findAdapter, run });
    await expect(process({ adapterId: "mock:dirk" })).resolves.toEqual({
      runId: "run-1",
      status: "SUCCESS",
      itemsFound: 4,
      itemsUpdated: 4,
    });
    expect(run).toHaveBeenCalledWith(mockDirk);
  });

  it("fails the job for an unknown adapter without running anything", async () => {
    const run = vi.fn();
    const process = createIngestionProcessor({ findAdapter, run });
    await expect(process({ adapterId: "lidl" })).rejects.toThrow(/Unknown adapter "lidl"/);
    expect(run).not.toHaveBeenCalled();
  });
});
