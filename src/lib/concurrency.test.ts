import { describe, expect, it } from "vitest";
import { mapLimited } from "./concurrency";

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

describe("mapLimited", () => {
  it("keeps the order of the input and never runs more than the limit at once", async () => {
    let running = 0;
    let peak = 0;
    const results = await mapLimited([5, 1, 4, 2, 3, 6, 7], 3, async (value, index) => {
      running += 1;
      peak = Math.max(peak, running);
      for (let i = 0; i < value; i++) await tick();
      running -= 1;
      return `${index}:${value}`;
    });
    expect(results).toEqual(["0:5", "1:1", "2:4", "3:2", "4:3", "5:6", "6:7"]);
    expect(peak).toBe(3);
  });

  it("handles an empty list, a limit above the list and a limit below one", async () => {
    expect(await mapLimited([], 4, async () => 1)).toEqual([]);
    expect(await mapLimited([1, 2], 10, async (value) => value * 2)).toEqual([2, 4]);
    expect(await mapLimited([1, 2], 0, async (value) => value * 2)).toEqual([2, 4]);
  });

  it("rejects when a task fails and starts no further task", async () => {
    const started: number[] = [];
    const run = mapLimited([1, 2, 3, 4], 1, async (value) => {
      started.push(value);
      if (value === 2) throw new Error("boom");
      return value;
    });
    await expect(run).rejects.toThrow("boom");
    expect(started).toEqual([1, 2]);
  });
});
