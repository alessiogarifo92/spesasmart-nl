import { describe, expect, it } from "vitest";
import { coreTokens, nameSimilarity } from "./tokens";

describe("coreTokens", () => {
  it("drops sizes and unit words", () => {
    expect(coreTokens("Halfvolle melk 1 L", null)).toEqual(["halfvolle", "melk"]);
    expect(coreTokens("Melk halfvol 1 liter", null)).toEqual(["melk", "halfvol"]);
    expect(coreTokens("Kipfilet 500 gram", null)).toEqual(["kipfilet"]);
    expect(coreTokens("Kaas 1,5 kg", null)).toEqual(["kaas"]);
    expect(coreTokens("Luiers 40 stuks", null)).toEqual(["luiers"]);
    expect(coreTokens("Eieren 10 st", null)).toEqual(["eieren"]);
    expect(coreTokens("Wijn 75 cl", null)).toEqual(["wijn"]);
    expect(coreTokens("Tandpasta freshmint 75ml", null)).toEqual(["tandpasta", "freshmint"]);
    expect(coreTokens("Bananen 1 kilo", null)).toEqual(["bananen"]);
    expect(coreTokens("Koffie 250 gr", null)).toEqual(["koffie"]);
  });

  it("drops multipack notation in every written form", () => {
    expect(coreTokens("Bruisbron cola blik 6x330ml", "Bruisbron")).toEqual(["cola"]);
    expect(coreTokens("Bruisbron Cola 6 x 330 ml", "Bruisbron")).toEqual(["cola"]);
    expect(coreTokens("Bruisbron Cola 6-pack 330 ml", "Bruisbron")).toEqual(["cola"]);
    expect(coreTokens("Yoghurt 4x125g", null)).toEqual(["yoghurt"]);
  });

  it("drops packaging and filler words", () => {
    expect(coreTokens("Halfvolle melk pak 1 L", null)).toEqual(["halfvolle", "melk"]);
    expect(coreTokens("Pindakaas naturel pot 350 g", null)).toEqual(["pindakaas", "naturel"]);
    expect(coreTokens("Kipfilet schaal 500 g", null)).toEqual(["kipfilet"]);
    expect(coreTokens("Ca. 400 g kaas van de boer", null)).toEqual(["kaas", "boer"]);
    expect(coreTokens("Tray met een doos, fles, zak, bak en blik in verpakking circa", null)).toEqual(["in"]);
    expect(coreTokens("Het brood", null)).toEqual(["brood"]);
  });

  it("drops the tokens of the brand, normalised the same way", () => {
    expect(coreTokens("Molenhof Koffiebonen Aroma 1 kg", "Molenhof")).toEqual(["koffiebonen", "aroma"]);
    expect(coreTokens("Zonnig Veld appelsap 1 L", "ZONNIG veld")).toEqual(["appelsap"]);
    expect(coreTokens("Café Noir espresso", "Cafe Noir")).toEqual(["espresso"]);
    // Without a brand nothing is guessed to be one.
    expect(coreTokens("Molenhof koffiebonen", null)).toEqual(["molenhof", "koffiebonen"]);
  });

  it("strips accents and punctuation through normalizeName", () => {
    expect(coreTokens("Crème fraîche 200 ml", null)).toEqual(["creme", "fraiche"]);
    expect(coreTokens("Crème brûlée (2 stuks)", null)).toEqual(["creme", "brulee"]);
  });

  it("keeps words that only contain a number in the middle of a word", () => {
    // "3-laags" becomes "3 laags": the number goes, the word stays; "8 rollen" is a count.
    expect(coreTokens("Toiletpapier 3-laags 8 rollen", null)).toEqual(["toiletpapier", "laags"]);
  });

  it("keeps a number that names the product: 'maat 4' is one word, and not the same as 'maat 5'", () => {
    expect(coreTokens("Luiers maat 4 (40 stuks)", null)).toEqual(["luiers", "maat4"]);
    expect(coreTokens("Luiers maat 5 40 st", null)).toEqual(["luiers", "maat5"]);
    expect(coreTokens("Koffiecapsules nr 7 20 stuks", null)).toEqual(["koffiecapsules", "nr7"]);
    // Without a number after it the word is an ordinary word, and a size is still a size.
    expect(coreTokens("Luiers maat 500 g", null)).toEqual(["luiers", "maat"]);
    expect(nameSimilarity(["luiers", "maat4"], ["luiers", "maat4"])).toBe(1);
    // "maat4" and "maat5" share most of their letters, but a numbered word is equal or different.
    expect(nameSimilarity(["luiers", "maat4"], ["luiers", "maat5"])).toBe(0.5);
  });

  it("drops the word for organic: that is compared as a fact, not as a name", () => {
    expect(coreTokens("Biologische havermout 500 g", null)).toEqual(["havermout"]);
    expect(coreTokens("Bio havermout", null)).toEqual(["havermout"]);
    expect(coreTokens("Havermout biologisch 500 gram", null)).toEqual(["havermout"]);
  });

  it("drops packaging diminutives and 'per'", () => {
    expect(coreTokens("Bananen per kilo", null)).toEqual(["bananen"]);
    expect(coreTokens("Tandpasta freshmint tube 75 ml", null)).toEqual(["tandpasta", "freshmint"]);
    expect(coreTokens("Blauwe bessen bakje 125 gr", null)).toEqual(["blauwe", "bessen"]);
    expect(coreTokens("Melk 1 ltr", null)).toEqual(["melk"]);
  });

  it("removes duplicates and keeps the first position", () => {
    expect(coreTokens("Melk halfvol melk", null)).toEqual(["melk", "halfvol"]);
  });

  it("returns an empty list for a name that is only a size or packaging", () => {
    expect(coreTokens("500 g", null)).toEqual([]);
    expect(coreTokens("6 x 330 ml", null)).toEqual([]);
    expect(coreTokens("1,5 L", null)).toEqual([]);
    expect(coreTokens("Pak 1 liter", null)).toEqual([]);
    expect(coreTokens("Molenhof 1 kg", "Molenhof")).toEqual([]);
    expect(coreTokens("", null)).toEqual([]);
    expect(coreTokens(" – ! ", null)).toEqual([]);
  });
});

describe("nameSimilarity", () => {
  it("scores identical lists 1", () => {
    expect(nameSimilarity(["melk"], ["melk"])).toBe(1);
    expect(nameSimilarity(["halfvolle", "melk"], ["melk", "halfvolle"])).toBe(1);
  });

  it("matches a prefix of at least 4 letters fully when it is most of the word", () => {
    expect(nameSimilarity(["halfvolle", "melk"], ["melk", "halfvol"])).toBe(1);
    expect(nameSimilarity(["biologisch"], ["biologische"])).toBe(1);
    expect(nameSimilarity(["kaas"], ["kaasje"])).toBe(1);
  });

  it("does not take the first half of a compound for the same word", () => {
    // 4 of 11 letters: "tros" says nothing about "trostomaten", or bananas would match tomatoes.
    expect(nameSimilarity(["bananen", "tros"], ["trostomaten"])).toBe(0);
    expect(nameSimilarity(["melk"], ["melkpoeder"])).toBe(0);
    expect(nameSimilarity(["kaas"], ["kaasplank"])).toBe(0);
    // From 5 letters the shorter word still counts as part of the compound, at 0.8.
    expect(nameSimilarity(["tomaat"], ["tomaatsaus"])).toBe(0.8);
    expect(nameSimilarity(["volkoren"], ["volkorenbrood"])).toBe(0.8);
  });

  it("reads two words as the compound the other side writes", () => {
    expect(nameSimilarity(["volkoren", "brood"], ["volkorenbrood"])).toBe(1);
    expect(nameSimilarity(["volkorenbrood"], ["brood", "volkoren"])).toBe(1);
    expect(nameSimilarity(["tros", "tomaten"], ["trostomaten"])).toBe(1);
    expect(nameSimilarity(["tandpasta", "fresh", "mint"], ["freshmint", "tandpasta"])).toBe(1);
    // A word of its own is still a difference.
    expect(nameSimilarity(["volkoren", "brood", "heel"], ["volkorenbrood"])).toBe(0.5);
    // Nothing is joined when the compound is already present.
    expect(nameSimilarity(["volkorenbrood", "brood"], ["volkorenbrood", "volkoren"])).toBe(0.5);
  });

  it("does not match a prefix of 3 letters", () => {
    // "kip" shares one trigram with the six of "kipfilet": Dice 2/7, under 0.6.
    expect(nameSimilarity(["kip"], ["kipfilet"])).toBe(0);
    expect(nameSimilarity(["bio"], ["biologische"])).toBe(0);
  });

  it("counts a contained word of at least 5 letters as 0.8 (Dutch compounds)", () => {
    expect(nameSimilarity(["eieren"], ["scharreleieren"])).toBe(0.8);
    expect(nameSimilarity(["appel"], ["stoofappel"])).toBe(0.8);
    // "melk" in "karnemelk" is only 4 letters; its trigram Dice is 4/9.
    expect(nameSimilarity(["melk"], ["karnemelk"])).toBe(0);
  });

  it("counts a close spelling by its trigram Dice coefficient from 0.6 up", () => {
    // haverdrink and haverdrank share 5 of their 8 trigrams each: 10/16.
    expect(nameSimilarity(["haverdrink"], ["haverdrank"])).toBe(0.625);
    // tomaat and tomaten share 2 of 4 and 5 trigrams: 4/9, under 0.6.
    expect(nameSimilarity(["tomaat"], ["tomaten"])).toBe(0);
  });

  it("scores lists without any matching token 0", () => {
    expect(nameSimilarity(["kipfilet"], ["halfvolle", "melk"])).toBe(0);
  });

  it("divides by the longer list", () => {
    expect(nameSimilarity(["halfvolle", "melk"], ["melk"])).toBe(0.5);
    expect(nameSimilarity(["griekse", "yoghurt", "naturel"], ["yoghurt", "griekse", "stijl"])).toBeCloseTo(2 / 3, 10);
    expect(nameSimilarity(["scharreleieren"], ["vrije", "uitloop", "eieren"])).toBeCloseTo(0.8 / 3, 10);
  });

  it("pairs each token with its best unused partner", () => {
    // "eieren" takes its exact partner (1), not the compound (0.8); the compound stays unpaired.
    expect(nameSimilarity(["scharreleieren", "eieren"], ["eieren"])).toBe(0.5);
    // One partner cannot be used twice.
    expect(nameSimilarity(["melk", "melkpoeder"], ["melk"])).toBe(0.5);
  });

  it("does not depend on argument order or token order", () => {
    const cases: [string[], string[]][] = [
      [
        ["scharreleieren", "eieren", "vrije"],
        ["eieren", "scharrel", "vrij"],
      ],
      [
        ["halfvol", "halfvolle", "melk"],
        ["halfvolle", "melk"],
      ],
      [
        ["haverdrink", "ongezoet"],
        ["haverdrank", "ongezoete", "drank"],
      ],
      [
        ["kaas", "kaasplank", "plank"],
        ["kaasplank", "kaas"],
      ],
      // "melk" scores 1 against both; which one it takes decides whether "poeder" can pair.
      [
        ["melk", "poeder"],
        ["melkweg", "melkpoeder"],
      ],
    ];
    for (const [a, b] of cases) {
      const expected = nameSimilarity(a, b);
      expect(nameSimilarity(b, a)).toBe(expected);
      expect(nameSimilarity([...a].reverse(), b)).toBe(expected);
      expect(nameSimilarity(a, [...b].reverse())).toBe(expected);
    }
  });

  it("scores 0 when either list is empty", () => {
    expect(nameSimilarity([], [])).toBe(0);
    expect(nameSimilarity([], ["melk"])).toBe(0);
    expect(nameSimilarity(["melk"], [])).toBe(0);
  });
});
