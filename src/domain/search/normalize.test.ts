import { describe, expect, it } from "vitest";
import { normalizeName } from "./normalize";

describe("normalizeName", () => {
  it("lower-cases and strips accents", () => {
    expect(normalizeName("Crème Fraîche 200 ml")).toBe("creme fraiche 200 ml");
    expect(normalizeName("Müsli Knäckebröd")).toBe("musli knackebrod");
  });

  it("drops punctuation and collapses whitespace", () => {
    expect(normalizeName("  Toiletpapier 3-laags,   8 rollen! ")).toBe("toiletpapier 3 laags 8 rollen");
    expect(normalizeName("Kip/kalkoen (filet)")).toBe("kip kalkoen filet");
  });

  it("keeps decimal separators inside numbers", () => {
    expect(normalizeName("Cola 1,5 L")).toBe("cola 1,5 l");
    expect(normalizeName("Cola 1.5 L")).toBe("cola 1,5 l");
  });

  it("spells out the ampersand", () => {
    expect(normalizeName("Zuivel & eieren")).toBe("zuivel en eieren");
  });

  it("returns an empty string when nothing searchable is left", () => {
    expect(normalizeName("")).toBe("");
    expect(normalizeName(" – ! ")).toBe("");
  });
});
