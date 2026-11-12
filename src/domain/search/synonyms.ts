/**
 * Basic Dutch, Italian and English shopping words, mapped to the Dutch word
 * product names use. Keys are normalised (see `normalizeName`); multi-word
 * phrases are replaced before single words. This is a starter list, not a
 * dictionary: a word that is missing simply searches as typed.
 */
export const PRODUCT_SYNONYMS: Record<string, string> = {
  // dairy and eggs
  latte: "melk",
  milk: "melk",
  "latte parzialmente scremato": "halfvolle melk",
  "semi skimmed milk": "halfvolle melk",
  yogurt: "yoghurt",
  "yogurt greco": "griekse yoghurt",
  "greek yogurt": "griekse yoghurt",
  "greek yoghurt": "griekse yoghurt",
  uova: "eieren",
  eggs: "eieren",
  ei: "eieren",
  "bevanda di avena": "haverdrink",
  "oat drink": "haverdrink",
  "oat milk": "haverdrink",
  havermelk: "haverdrink",
  // meat, fruit, vegetables
  pollo: "kip",
  chicken: "kip",
  "petto di pollo": "kipfilet",
  "chicken breast": "kipfilet",
  banane: "bananen",
  bananas: "bananen",
  banana: "bananen",
  banaan: "bananen",
  mele: "appels",
  apples: "appels",
  apple: "appels",
  pomodori: "tomaten",
  tomatoes: "tomaten",
  tomaat: "tomaten",
  piselli: "doperwten",
  peas: "doperwten",
  erwten: "doperwten",
  // bakery and pantry
  pane: "brood",
  bread: "brood",
  "pane integrale": "volkoren brood",
  "wholemeal bread": "volkoren brood",
  "burro di arachidi": "pindakaas",
  "peanut butter": "pindakaas",
  avena: "havermout",
  "fiocchi di avena": "havermout",
  oats: "havermout",
  caffe: "koffie",
  coffee: "koffie",
  "caffe in grani": "koffiebonen",
  "coffee beans": "koffiebonen",
  patatine: "chips",
  crisps: "chips",
  // household and care
  detersivo: "wasmiddel",
  "laundry detergent": "wasmiddel",
  detergent: "wasmiddel",
  "carta igienica": "toiletpapier",
  "toilet paper": "toiletpapier",
  wcpapier: "toiletpapier",
  "wc papier": "toiletpapier",
  dentifricio: "tandpasta",
  toothpaste: "tandpasta",
  pannolini: "luiers",
  diapers: "luiers",
  nappies: "luiers",
};

/** Words that switch a filter on instead of being searched as text. */
export const FLAG_WORDS: Record<string, "organic" | "cheap" | "glutenFree" | "vegan" | "lactoseFree"> = {
  bio: "organic",
  biologisch: "organic",
  biologische: "organic",
  biologico: "organic",
  biologica: "organic",
  organic: "organic",
  goedkoop: "cheap",
  goedkope: "cheap",
  goedkoopste: "cheap",
  cheap: "cheap",
  cheapest: "cheap",
  economico: "cheap",
  economica: "cheap",
  glutenvrij: "glutenFree",
  glutenvrije: "glutenFree",
  "gluten free": "glutenFree",
  "senza glutine": "glutenFree",
  vegan: "vegan",
  veganistisch: "vegan",
  vegano: "vegan",
  lactosevrij: "lactoseFree",
  lactosevrije: "lactoseFree",
  "lactose free": "lactoseFree",
  "senza lattosio": "lactoseFree",
};

/** Words that carry no meaning for a product search. */
export const STOP_WORDS = new Set([
  "de", "het", "een", "en", "van", "voor", "met", "the", "a", "an", "of", "with", "il", "lo", "la", "i", "gli", "le", "un", "una", "di", "con",
]);
