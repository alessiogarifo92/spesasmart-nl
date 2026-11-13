import { describe, expect, it } from "vitest";
import { isEmptyQuery, parseQuery, MAX_TERMS } from "./query";

const context = {
  brands: ["Molenhof", "Bruisbron", "Frisblad"],
  categories: [
    { slug: "zuivel-eieren", names: ["Zuivel & eieren", "Dairy & eggs", "Latticini e uova"] },
    { slug: "dranken", names: ["Dranken", "Drinks", "Bevande"] },
  ],
};

describe("parseQuery: size", () => {
  it("reads the examples from the ticket", () => {
    expect(parseQuery("halfvolle melk 1 liter")).toMatchObject({
      terms: ["halfvolle", "melk"],
      quantity: { amount: 1000, unit: "ml", count: 1, totalAmount: 1000 },
    });
    expect(parseQuery("kipfilet 500 gram")).toMatchObject({
      terms: ["kipfilet"],
      quantity: { amount: 500, unit: "g", totalAmount: 500 },
    });
  });

  it("reads multipacks, decimals and compact notation", () => {
    expect(parseQuery("cola 6 x 330 ml")).toMatchObject({
      terms: ["cola"],
      quantity: { count: 6, amount: 330, totalAmount: 1980 },
    });
    expect(parseQuery("cola 6x330ml").quantity).toMatchObject({ count: 6, amount: 330, unit: "ml" });
    expect(parseQuery("cola 1,5 l").quantity).toMatchObject({ amount: 1500, unit: "ml" });
    expect(parseQuery("cola 1.5 L").quantity).toMatchObject({ amount: 1500, unit: "ml" });
    expect(parseQuery("eieren 10 stuks").quantity).toMatchObject({ amount: 10, unit: "piece" });
  });

  it("reads Italian and English unit words", () => {
    expect(parseQuery("latte 1 litro")).toMatchObject({ terms: ["melk"], quantity: { amount: 1000, unit: "ml" } });
    expect(parseQuery("pollo 500 grammi")).toMatchObject({ terms: ["kip"], quantity: { amount: 500, unit: "g" } });
    expect(parseQuery("milk 1 litre").quantity).toMatchObject({ amount: 1000, unit: "ml" });
    expect(parseQuery("uova 10 pezzi")).toMatchObject({ terms: ["eieren"], quantity: { amount: 10, unit: "piece" } });
  });

  it("leaves a number without a unit as a search term", () => {
    expect(parseQuery("cola 6")).toMatchObject({ terms: ["cola", "6"], quantity: null });
    expect(parseQuery("7up")).toMatchObject({ terms: ["7up"], quantity: null });
  });

  it("keeps a size inside a word out of it", () => {
    expect(parseQuery("omega 3 gel")).toMatchObject({ quantity: null });
  });
});

describe("parseQuery: barcode", () => {
  it("recognises a valid EAN-13, also with spaces", () => {
    expect(parseQuery("2000000000015")).toMatchObject({ ean: "2000000000015", terms: [] });
    expect(parseQuery("2 000000 000015").ean).toBe("2000000000015");
  });

  it("searches an invalid barcode as text instead of dropping it", () => {
    expect(parseQuery("2000000000016")).toMatchObject({ ean: null, terms: ["2000000000016"] });
  });
});

describe("parseQuery: synonyms and flags", () => {
  it("maps Italian and English words to the Dutch product word", () => {
    expect(parseQuery("latte").terms).toEqual(["melk"]);
    expect(parseQuery("Chicken breast").terms).toEqual(["kipfilet"]);
    expect(parseQuery("burro di arachidi").terms).toEqual(["pindakaas"]);
    expect(parseQuery("caffè in grani").terms).toEqual(["koffiebonen"]);
    expect(parseQuery("carta igienica").terms).toEqual(["toiletpapier"]);
  });

  it("prefers the longest phrase", () => {
    expect(parseQuery("yogurt greco").terms).toEqual(["griekse", "yoghurt"]);
    expect(parseQuery("yogurt").terms).toEqual(["yoghurt"]);
  });

  it("does not rewrite parts of other words", () => {
    expect(parseQuery("panettone").terms).toEqual(["panettone"]);
    expect(parseQuery("eiwit").terms).toEqual(["eiwit"]);
  });

  it("turns flag words into filters", () => {
    expect(parseQuery("wasmiddel goedkoop")).toMatchObject({ terms: ["wasmiddel"], cheapestFirst: true });
    expect(parseQuery("biologische havermout")).toMatchObject({ terms: ["havermout"], organic: true });
    expect(parseQuery("pasta senza glutine")).toMatchObject({ terms: ["pasta"], attributes: ["glutenFree"] });
    expect(parseQuery("detersivo economico")).toMatchObject({ terms: ["wasmiddel"], cheapestFirst: true });
    expect(parseQuery("vegan")).toMatchObject({ terms: [], attributes: ["vegan"] });
  });

  it("drops stop words and duplicates", () => {
    expect(parseQuery("de melk van de melk").terms).toEqual(["melk"]);
    expect(parseQuery("pane con il latte").terms).toEqual(["brood", "melk"]);
  });
});

describe("parseQuery: brand and category", () => {
  it("recognises a known brand in any case and keeps the catalogue spelling", () => {
    expect(parseQuery("molenhof koffiebonen 1 kg", context)).toMatchObject({
      brand: "Molenhof",
      terms: ["koffiebonen"],
      quantity: { amount: 1000, unit: "g" },
    });
    expect(parseQuery("BRUISBRON", context)).toMatchObject({ brand: "Bruisbron", terms: [] });
  });

  it("does not see a brand inside another word", () => {
    expect(parseQuery("molenhofje", context).brand).toBeNull();
  });

  it("recognises a category name in each language when other words remain", () => {
    expect(parseQuery("dranken cola", context)).toMatchObject({ categorySlug: "dranken", terms: ["cola"] });
    expect(parseQuery("bevande cola", context)).toMatchObject({ categorySlug: "dranken", terms: ["cola"] });
  });

  it("searches a bare category name as text as well as a category", () => {
    expect(parseQuery("dranken", context)).toMatchObject({ categorySlug: null, terms: ["dranken"] });
  });

  it("knows no brands or categories without context", () => {
    expect(parseQuery("molenhof dranken")).toMatchObject({
      brand: null,
      categorySlug: null,
      terms: ["molenhof", "dranken"],
    });
  });
});

describe("parseQuery: edge cases", () => {
  it("handles empty and whitespace-only input", () => {
    expect(isEmptyQuery(parseQuery(""))).toBe(true);
    expect(isEmptyQuery(parseQuery("   "))).toBe(true);
    expect(isEmptyQuery(parseQuery("de het"))).toBe(true);
    expect(isEmptyQuery(parseQuery("melk"))).toBe(false);
    expect(isEmptyQuery(parseQuery("bio"))).toBe(false);
    expect(isEmptyQuery(parseQuery("2000000000015"))).toBe(false);
  });

  it("cuts very long input and strips punctuation and accents", () => {
    expect(parseQuery("x".repeat(500)).raw).toHaveLength(120);
    expect(parseQuery("Crème fraîche!!").terms).toEqual(["creme", "fraiche"]);
    expect(parseQuery("'; DROP TABLE products;--").terms).toEqual(["drop", "table", "products"]);
  });

  it("keeps the query as typed in raw", () => {
    expect(parseQuery("  Latte 1 Litro ").raw).toBe("Latte 1 Litro");
  });

  it("searches the first eight words of a long query and drops the rest", () => {
    const query = parseQuery("b c d f g h j k l m n p");
    expect(query.terms).toEqual(["b", "c", "d", "f", "g", "h", "j", "k"]);
    expect(MAX_TERMS).toBe(8);
  });
});
