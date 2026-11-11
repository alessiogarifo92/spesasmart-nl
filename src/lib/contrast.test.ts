import { describe, expect, it } from "vitest";
import { contrastRatio, luminance } from "./contrast";

describe("contrast", () => {
  it("gives black on white the maximum ratio", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 5);
  });

  it("gives identical colours a ratio of 1", () => {
    expect(contrastRatio("#5ee0a0", "#5ee0a0")).toBe(1);
  });

  it("matches a known pair", () => {
    // #767676 on white is the classic 4.54:1 boundary grey.
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
  });

  it("rejects anything that is not #rrggbb", () => {
    expect(() => luminance("#fff")).toThrow(RangeError);
    expect(() => luminance("rgb(0,0,0)")).toThrow(RangeError);
    expect(() => contrastRatio("mint", "#000000")).toThrow(RangeError);
  });
});
