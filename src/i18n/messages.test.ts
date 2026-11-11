import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import it_ from "../../messages/it.json";
import nl from "../../messages/nl.json";

/** Names of the top-level ICU arguments in a message; text inside plural branches is skipped. */
function placeholders(text: string): string[] {
  const names = new Set<string>();
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "{") {
      depth += 1;
      if (depth === 1) names.add(/^\s*(\w+)/.exec(text.slice(i + 1))?.[1] ?? "");
    } else if (text[i] === "}") {
      depth -= 1;
    }
  }
  return [...names].sort();
}

/** Every leaf key as a dotted path, with the placeholders its text uses. */
function shape(node: unknown, prefix = ""): Map<string, string[]> {
  const entries = new Map<string, string[]>();
  if (typeof node === "string") {
    entries.set(prefix, placeholders(node));
    return entries;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    for (const [path, placeholders] of shape(value, prefix ? `${prefix}.${key}` : key)) {
      entries.set(path, placeholders);
    }
  }
  return entries;
}

describe("message files", () => {
  const reference = shape(nl);

  it.each([
    ["en", en],
    ["it", it_],
  ])("%s has the same keys and placeholders as nl", (_locale, messages) => {
    expect(Object.fromEntries(shape(messages))).toEqual(Object.fromEntries(reference));
  });

  it("reads ICU arguments, not the words inside plural branches", () => {
    expect(placeholders("{count, plural, =0 {Geen} one {# dag} other {# dagen}} tot {date}")).toEqual(["count", "date"]);
    expect(placeholders("geen argumenten")).toEqual([]);
  });

  it("has no empty text", () => {
    for (const messages of [nl, en, it_]) {
      const empty = [...flatten(messages)].filter(([, text]) => text.trim() === "");
      expect(empty).toEqual([]);
    }
  });
});

function* flatten(node: unknown, prefix = ""): Generator<[string, string]> {
  if (typeof node === "string") yield [prefix, node];
  else for (const [k, v] of Object.entries(node as object)) yield* flatten(v, `${prefix}.${k}`);
}
