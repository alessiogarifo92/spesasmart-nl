import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import it_ from "../../messages/it.json";
import nl from "../../messages/nl.json";

/** Every leaf key as a dotted path, with the placeholders its text uses. */
function shape(node: unknown, prefix = ""): Map<string, string[]> {
  const entries = new Map<string, string[]>();
  if (typeof node === "string") {
    entries.set(prefix, [...node.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort());
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
