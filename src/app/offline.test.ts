import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import it_ from "../../messages/it.json";
import nl from "../../messages/nl.json";

// The offline page is static so it can be served without the network; this
// keeps its text identical to the message files.
const html = readFileSync(join(__dirname, "../../public/offline.html"), "utf8");

describe("offline page", () => {
  it("shows the Dutch text by default", () => {
    expect(html).toContain(`<h1 id="title">${nl.offline.title}</h1>`);
    expect(html).toContain(`<p id="body">${nl.offline.body}</p>`);
  });

  it("embeds the English and Italian text from the message files", () => {
    const embedded = JSON.parse(/<script id="texts"[^>]*>([\s\S]*?)<\/script>/.exec(html)![1]);
    expect(embedded).toEqual({ en: en.offline, it: it_.offline });
  });

  it("loads nothing from the network", () => {
    expect(html).not.toMatch(/<link|src=|@import|url\(/);
  });
});
