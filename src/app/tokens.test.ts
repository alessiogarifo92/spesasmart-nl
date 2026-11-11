import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/lib/contrast";

const css = readFileSync(join(__dirname, "globals.css"), "utf8");

/** Custom properties of the first rule whose selector matches. */
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`No rule for ${selector}`);
  const block = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  return Object.fromEntries(
    [...block.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]),
  );
}

const themes = {
  dark: tokens(":root {"),
  "light (system)": tokens(':root:not([data-theme="dark"])'),
  "light (chosen)": tokens(':root[data-theme="light"]'),
};

/** Every text colour on every background it is used on. */
const pairs: [string, string][] = [
  ["text", "bg"],
  ["text", "surface"],
  ["muted", "bg"],
  ["muted", "surface"],
  ["accent", "bg"],
  ["accent", "surface"],
  ["warn", "bg"],
  ["warn", "surface"],
  ["danger", "bg"],
  ["danger", "surface"],
  ["on-accent", "accent"],
];

describe.each(Object.entries(themes))("%s theme", (_name, theme) => {
  it.each(pairs)("%s on %s reaches 4.5:1", (foreground, background) => {
    expect(contrastRatio(theme[foreground], theme[background])).toBeGreaterThanOrEqual(4.5);
  });
});

describe("light theme", () => {
  it("is the same whether the system or the user asks for it", () => {
    expect(themes["light (chosen)"]).toEqual(themes["light (system)"]);
  });
});
