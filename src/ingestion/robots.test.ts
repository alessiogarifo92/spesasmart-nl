import { describe, expect, it } from "vitest";
import { isAllowed, parseRobots } from "./robots";

const TOKEN = "SpesaSmartNL";

function allowed(text: string, path: string, token = TOKEN): boolean {
  return isAllowed(parseRobots(text), token, path);
}

describe("parseRobots / isAllowed", () => {
  it("allows everything when the file is empty or has no group", () => {
    expect(allowed("", "/aanbiedingen")).toBe(true);
    expect(allowed("Sitemap: https://example.test/sitemap.xml", "/aanbiedingen")).toBe(true);
  });

  it("applies the * group when no group names the token", () => {
    const text = "User-agent: *\nDisallow: /winkelwagen\n";
    expect(allowed(text, "/winkelwagen/items")).toBe(false);
    expect(allowed(text, "/aanbiedingen")).toBe(true);
  });

  it("prefers the group naming the token over *", () => {
    const text = ["User-agent: *", "Disallow: /", "", "User-agent: spesasmartnl", "Disallow: /zoeken"].join("\n");
    expect(allowed(text, "/aanbiedingen")).toBe(true);
    expect(allowed(text, "/zoeken?q=melk")).toBe(false);
  });

  it("picks the most specific matching user-agent token", () => {
    const text = ["User-agent: Spesa", "Disallow: /", "", "User-agent: SpesaSmartNL", "Allow: /"].join("\n");
    expect(allowed(text, "/aanbiedingen")).toBe(true);
    expect(allowed(text, "/aanbiedingen", "SpesaBot")).toBe(false);
  });

  it("ignores groups for other crawlers", () => {
    const text = "User-agent: Googlebot\nDisallow: /\n";
    expect(allowed(text, "/aanbiedingen")).toBe(true);
  });

  it("lets several user-agent lines share one group and merges repeated groups", () => {
    const text = [
      "User-agent: Googlebot",
      "User-agent: SpesaSmartNL",
      "Disallow: /a",
      "",
      "User-agent: SpesaSmartNL",
      "Disallow: /b",
    ].join("\n");
    expect(allowed(text, "/a")).toBe(false);
    expect(allowed(text, "/b")).toBe(false);
    expect(allowed(text, "/c")).toBe(true);
  });

  it("uses the longest matching rule", () => {
    const text = "User-agent: *\nDisallow: /aanbiedingen\nAllow: /aanbiedingen/week\n";
    expect(allowed(text, "/aanbiedingen/week/46")).toBe(true);
    expect(allowed(text, "/aanbiedingen/dag")).toBe(false);
  });

  it("lets Allow win a tie of equal length", () => {
    const text = "User-agent: *\nDisallow: /aanbieding\nAllow: /aanbieding\n";
    expect(allowed(text, "/aanbiedingen")).toBe(true);
  });

  it("supports the * wildcard", () => {
    const text = "User-agent: *\nDisallow: /*?sort=\nDisallow: /producten/*/reviews\n";
    expect(allowed(text, "/aanbiedingen?sort=prijs")).toBe(false);
    expect(allowed(text, "/aanbiedingen?page=2")).toBe(true);
    expect(allowed(text, "/producten/melk/reviews")).toBe(false);
    expect(allowed(text, "/producten/melk")).toBe(true);
  });

  it("supports the $ end anchor", () => {
    const text = "User-agent: *\nDisallow: /*.pdf$\n";
    expect(allowed(text, "/folder/week.pdf")).toBe(false);
    expect(allowed(text, "/folder/week.pdf?download=1")).toBe(true);
  });

  it("treats regex characters in a path literally", () => {
    const text = "User-agent: *\nDisallow: /a.b(c)\n";
    expect(allowed(text, "/a.b(c)/d")).toBe(false);
    expect(allowed(text, "/axb(c)")).toBe(true);
  });

  it("treats an empty Disallow as allowing everything", () => {
    const text = "User-agent: *\nDisallow:\n";
    expect(allowed(text, "/anything")).toBe(true);
  });

  it("tolerates comments, CRLF, blank lines and directive case", () => {
    const text = "# robots\r\nUSER-AGENT: * # everyone\r\n\r\ndisallow: /checkout # no carts\r\nCrawl-delay: 10\r\n";
    expect(allowed(text, "/checkout/1")).toBe(false);
    expect(allowed(text, "/aanbiedingen")).toBe(true);
  });

  it("ignores rules that appear before any user-agent line", () => {
    expect(allowed("Disallow: /\nUser-agent: *\nDisallow: /x\n", "/y")).toBe(true);
  });

  it("matches the path case-sensitively and the token case-insensitively", () => {
    const text = "User-agent: SPESASMARTNL\nDisallow: /Aanbiedingen\n";
    expect(allowed(text, "/Aanbiedingen")).toBe(false);
    expect(allowed(text, "/aanbiedingen")).toBe(true);
  });

  it("always allows /robots.txt itself", () => {
    expect(allowed("User-agent: *\nDisallow: /\n", "/robots.txt")).toBe(true);
  });
});
