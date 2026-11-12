import { describe, expect, it } from "vitest";
import { sourceKind } from "./sources";

describe("sourceKind", () => {
  it.each([
    [0, 0, "none"],
    [0, 12, "demo"],
    [5, 0, "real"],
    [5, 12, "mixed"],
    [1, 1, "mixed"],
  ] as const)("%i real and %i demo offers is %s", (real, demo, kind) => {
    expect(sourceKind(real, demo)).toBe(kind);
  });
});
