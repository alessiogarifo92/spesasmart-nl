/**
 * Demo catalogue. Every name, brand, barcode and price in this file is invented
 * and every row it produces carries `isDemo: true`; the interface labels it
 * "Demodata". Brands are fictional and barcodes use the GS1 in-store range
 * (prefix 20), which is never assigned to a real product.
 */
import type { CategorySlug, RetailerSlug } from "./reference";

type Unit = "G" | "ML" | "PIECE";

export type DemoProduct = {
  /** The real-world product this row stands for; shared across chains. */
  concept: string;
  category: CategorySlug;
  unit: Unit;
  packageAmount: number;
  packageCount?: number;
  brand?: string;
  ean?: string;
  isOrganic?: boolean;
  attributes?: Record<string, boolean>;
  /** Name and regular price in cents, per chain that sells it. */
  variants: Partial<Record<RetailerSlug, { name: string; regularCents: number }>>;
};

/** EAN-13 in the in-store range with a valid check digit. */
export function demoEan(sequence: number): string {
  const body = `20${String(sequence).padStart(10, "0")}`;
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return `${body}${(10 - (sum % 10)) % 10}`;
}

const vegan = { vegan: true, vegetarian: true, lactoseFree: true };
const vegetarian = { vegetarian: true };

export const DEMO_PRODUCTS: DemoProduct[] = [
  {
    concept: "halfvolle-melk-1l", category: "zuivel-eieren", unit: "ML", packageAmount: 1000, attributes: vegetarian,
    variants: {
      ah: { name: "Halfvolle melk 1 L", regularCents: 119 },
      jumbo: { name: "Melk halfvol 1 liter", regularCents: 115 },
      vomar: { name: "Halfvolle melk pak 1 L", regularCents: 109 },
      dirk: { name: "Halfvolle melk 1000 ml", regularCents: 99 },
    },
  },
  {
    concept: "griekse-yoghurt-500g", category: "zuivel-eieren", unit: "G", packageAmount: 500, attributes: vegetarian,
    variants: {
      ah: { name: "Griekse yoghurt naturel 500 g", regularCents: 219 },
      jumbo: { name: "Yoghurt Griekse stijl 500 gram", regularCents: 199 },
      dirk: { name: "Griekse yoghurt 10% vet 500 g", regularCents: 189 },
    },
  },
  {
    concept: "eieren-10", category: "zuivel-eieren", unit: "PIECE", packageAmount: 10, attributes: vegetarian,
    variants: {
      ah: { name: "Vrije uitloop eieren 10 stuks", regularCents: 329 },
      jumbo: { name: "Scharreleieren 10 stuks", regularCents: 319 },
      vomar: { name: "Eieren vrije uitloop M 10 st", regularCents: 299 },
      dirk: { name: "Scharreleieren doos 10 stuks", regularCents: 289 },
    },
  },
  {
    concept: "haverdrink-1l", category: "zuivel-eieren", unit: "ML", packageAmount: 1000, attributes: vegan,
    variants: {
      ah: { name: "Haverdrink ongezoet 1 L", regularCents: 189 },
      jumbo: { name: "Haverdrank ongezoet 1 liter", regularCents: 179 },
    },
  },
  {
    concept: "kipfilet-500g", category: "vlees-vis", unit: "G", packageAmount: 500,
    variants: {
      ah: { name: "Kipfilet 500 g", regularCents: 549 },
      jumbo: { name: "Kipfilet 500 gram", regularCents: 529 },
      vomar: { name: "Kipfilet schaal 500 g", regularCents: 519 },
      dirk: { name: "Kipfilet 500 g", regularCents: 499 },
    },
  },
  {
    concept: "bananen-1kg", category: "groente-fruit", unit: "G", packageAmount: 1000, attributes: vegan,
    variants: {
      ah: { name: "Bananen 1 kg", regularCents: 169 },
      jumbo: { name: "Bananen tros 1 kg", regularCents: 165 },
      vomar: { name: "Bananen 1 kg", regularCents: 159 },
      dirk: { name: "Bananen per kilo", regularCents: 149 },
    },
  },
  {
    concept: "elstar-appels-1kg", category: "groente-fruit", unit: "G", packageAmount: 1000, attributes: vegan,
    variants: {
      ah: { name: "Elstar appels 1 kg", regularCents: 249 },
      jumbo: { name: "Appels Elstar zak 1 kg", regularCents: 239 },
      dirk: { name: "Elstar appelen 1 kg", regularCents: 219 },
    },
  },
  {
    concept: "trostomaten-500g", category: "groente-fruit", unit: "G", packageAmount: 500, attributes: vegan,
    variants: {
      ah: { name: "Trostomaten 500 g", regularCents: 189 },
      vomar: { name: "Tros tomaten 500 gram", regularCents: 169 },
      dirk: { name: "Trostomaten bakje 500 g", regularCents: 159 },
    },
  },
  {
    concept: "volkoren-brood-800g", category: "brood-bakkerij", unit: "G", packageAmount: 800, attributes: vegan,
    variants: {
      ah: { name: "Volkoren brood heel 800 g", regularCents: 199 },
      jumbo: { name: "Volkorenbrood 800 gram", regularCents: 189 },
      vomar: { name: "Volkoren brood 800 g", regularCents: 179 },
      dirk: { name: "Volkoren heel brood 800 g", regularCents: 169 },
    },
  },
  {
    concept: "spaghetti-500g", category: "voorraadkast", unit: "G", packageAmount: 500, attributes: vegan,
    variants: {
      ah: { name: "Spaghetti 500 g", regularCents: 109 },
      jumbo: { name: "Spaghetti pasta 500 gram", regularCents: 99 },
      vomar: { name: "Spaghetti 500 g", regularCents: 95 },
      dirk: { name: "Spaghetti 500 g", regularCents: 89 },
    },
  },
  {
    concept: "glutenvrije-penne-400g", category: "voorraadkast", unit: "G", packageAmount: 400,
    attributes: { ...vegan, glutenFree: true },
    variants: {
      ah: { name: "Glutenvrije penne 400 g", regularCents: 249 },
      jumbo: { name: "Penne glutenvrij 400 gram", regularCents: 239 },
    },
  },
  {
    concept: "pindakaas-350g", category: "voorraadkast", unit: "G", packageAmount: 350, attributes: vegan,
    variants: {
      ah: { name: "Pindakaas naturel 350 g", regularCents: 229 },
      jumbo: { name: "Pindakaas pot 350 gram", regularCents: 219 },
      vomar: { name: "Pindakaas naturel pot 350 g", regularCents: 209 },
    },
  },
  {
    concept: "bio-havermout-500g", category: "voorraadkast", unit: "G", packageAmount: 500, isOrganic: true, attributes: vegan,
    variants: {
      ah: { name: "Biologische havermout 500 g", regularCents: 149 },
      jumbo: { name: "Havermout biologisch 500 gram", regularCents: 145 },
      dirk: { name: "Bio havermout 500 g", regularCents: 135 },
    },
  },
  {
    concept: "molenhof-koffiebonen-1kg", category: "koffie-thee", unit: "G", packageAmount: 1000,
    brand: "Molenhof", ean: demoEan(1), attributes: vegan,
    variants: {
      ah: { name: "Molenhof Koffiebonen Aroma 1 kg", regularCents: 1299 },
      jumbo: { name: "Molenhof koffiebonen aroma 1000 g", regularCents: 1199 },
      dirk: { name: "Molenhof Aroma bonen 1 kg", regularCents: 1149 },
    },
  },
  {
    concept: "bruisbron-cola-6x330ml", category: "dranken", unit: "ML", packageAmount: 330, packageCount: 6,
    brand: "Bruisbron", ean: demoEan(2), attributes: vegan,
    variants: {
      ah: { name: "Bruisbron Cola 6 x 330 ml", regularCents: 399 },
      jumbo: { name: "Bruisbron cola blik 6x330ml", regularCents: 389 },
      vomar: { name: "Bruisbron Cola 6-pack 330 ml", regularCents: 379 },
    },
  },
  {
    concept: "doperwten-diepvries-450g", category: "diepvries", unit: "G", packageAmount: 450, attributes: vegan,
    variants: {
      ah: { name: "Doperwten extra fijn 450 g", regularCents: 139 },
      jumbo: { name: "Diepvries doperwten 450 gram", regularCents: 129 },
      vomar: { name: "Doperwten diepvries 450 g", regularCents: 119 },
    },
  },
  {
    concept: "zoute-chips-200g", category: "snoep-snacks", unit: "G", packageAmount: 200, attributes: vegan,
    variants: {
      ah: { name: "Chips naturel 200 g", regularCents: 129 },
      jumbo: { name: "Naturel chips 200 gram", regularCents: 119 },
      dirk: { name: "Chips naturel zak 200 g", regularCents: 99 },
    },
  },
  {
    concept: "frisblad-wasmiddel-1l", category: "huishouden", unit: "ML", packageAmount: 1000,
    brand: "Frisblad", ean: demoEan(3),
    variants: {
      ah: { name: "Frisblad Vloeibaar wasmiddel color 1 L", regularCents: 799 },
      jumbo: { name: "Frisblad wasmiddel vloeibaar color 1 liter", regularCents: 749 },
      dirk: { name: "Frisblad Color wasmiddel 1 L", regularCents: 699 },
    },
  },
  {
    concept: "toiletpapier-8", category: "huishouden", unit: "PIECE", packageAmount: 8,
    variants: {
      ah: { name: "Toiletpapier 3-laags 8 rollen", regularCents: 479 },
      jumbo: { name: "Toiletpapier 3 laags 8 rol", regularCents: 459 },
      vomar: { name: "Toiletpapier 3-laags 8 rollen", regularCents: 449 },
      dirk: { name: "Toiletpapier 3-laags 8 rollen", regularCents: 449 },
    },
  },
  {
    concept: "tandpasta-75ml", category: "verzorging", unit: "ML", packageAmount: 75,
    variants: {
      ah: { name: "Tandpasta fresh mint 75 ml", regularCents: 129 },
      jumbo: { name: "Tandpasta freshmint 75ml", regularCents: 119 },
      vomar: { name: "Tandpasta fresh mint tube 75 ml", regularCents: 109 },
    },
  },
  {
    concept: "luiers-maat4-40", category: "baby", unit: "PIECE", packageAmount: 40,
    variants: {
      ah: { name: "Luiers maat 4 40 stuks", regularCents: 899 },
      jumbo: { name: "Luiers maat 4 pak 40 stuks", regularCents: 849 },
      dirk: { name: "Luiers maat 4 (40 stuks)", regularCents: 799 },
    },
  },
];

type Mechanic =
  | { promoType: "PRICE_CUT"; currentCents: number }
  | { promoType: "X_PLUS_Y_FREE"; promoParams: { buy: number; free: number } }
  | { promoType: "NTH_HALF_PRICE"; promoParams: { n: number } }
  | { promoType: "X_FOR_PRICE"; promoParams: { quantity: number; totalCents: number } }
  | { promoType: "PERCENT_OFF"; promoParams: { percent: number }; currentCents: number };

export type DemoOffer = {
  /** Stable key: the seed derives the offer's content hash from it. */
  key: string;
  concept: string;
  retailer: RetailerSlug;
  kind?: "WEEKLY" | "DAILY";
  /** Wording of the mechanic as a chain would print it. */
  promoDescription?: string;
  /** Validity as day offsets from the seed day; `null` end means unknown. */
  fromOffset: number | null;
  untilOffset: number | null;
  conditions?: string;
} & Mechanic;

/** Offsets cover every state the interface handles: running, ending today, upcoming, expired, unknown. */
export const DEMO_OFFERS: DemoOffer[] = [
  { key: "dirk-kipfilet", concept: "kipfilet-500g", retailer: "dirk", promoType: "PRICE_CUT", currentCents: 349, fromOffset: -2, untilOffset: 4 },
  { key: "vomar-bananen-dag", concept: "bananen-1kg", retailer: "vomar", kind: "DAILY", promoType: "PRICE_CUT", currentCents: 99, promoDescription: "Dagknaller", fromOffset: 0, untilOffset: 0 },
  { key: "ah-yoghurt-1plus1", concept: "griekse-yoghurt-500g", retailer: "ah", promoType: "X_PLUS_Y_FREE", promoParams: { buy: 1, free: 1 }, promoDescription: "1+1 gratis", fromOffset: -2, untilOffset: 4 },
  { key: "jumbo-koffie-2e-halve", concept: "molenhof-koffiebonen-1kg", retailer: "jumbo", promoType: "NTH_HALF_PRICE", promoParams: { n: 2 }, promoDescription: "2e halve prijs", fromOffset: 5, untilOffset: 11 },
  { key: "jumbo-wasmiddel-2voor", concept: "frisblad-wasmiddel-1l", retailer: "jumbo", promoType: "X_FOR_PRICE", promoParams: { quantity: 2, totalCents: 1100 }, promoDescription: "2 voor 11,00", fromOffset: -1, untilOffset: 5 },
  { key: "ah-cola-25", concept: "bruisbron-cola-6x330ml", retailer: "ah", promoType: "PERCENT_OFF", promoParams: { percent: 25 }, currentCents: 299, promoDescription: "25% korting", fromOffset: -2, untilOffset: 4 },
  { key: "vomar-melk", concept: "halfvolle-melk-1l", retailer: "vomar", promoType: "PRICE_CUT", currentCents: 89, fromOffset: -3, untilOffset: 3 },
  { key: "dirk-spaghetti-2voor", concept: "spaghetti-500g", retailer: "dirk", promoType: "X_FOR_PRICE", promoParams: { quantity: 2, totalCents: 150 }, promoDescription: "2 voor 1,50", fromOffset: 4, untilOffset: 10 },
  { key: "jumbo-eieren-onbekend", concept: "eieren-10", retailer: "jumbo", promoType: "PRICE_CUT", currentCents: 259, fromOffset: null, untilOffset: null },
  { key: "ah-appels-verlopen", concept: "elstar-appels-1kg", retailer: "ah", promoType: "PRICE_CUT", currentCents: 179, fromOffset: -7, untilOffset: -1 },
  { key: "vomar-pindakaas-2e-halve", concept: "pindakaas-350g", retailer: "vomar", promoType: "NTH_HALF_PRICE", promoParams: { n: 2 }, promoDescription: "2e halve prijs", fromOffset: -3, untilOffset: 3 },
  { key: "dirk-toiletpapier", concept: "toiletpapier-8", retailer: "dirk", promoType: "PRICE_CUT", currentCents: 379, fromOffset: -2, untilOffset: 4 },
  { key: "ah-tomaten", concept: "trostomaten-500g", retailer: "ah", promoType: "PRICE_CUT", currentCents: 149, fromOffset: -2, untilOffset: 1 },
  { key: "jumbo-brood", concept: "volkoren-brood-800g", retailer: "jumbo", promoType: "PRICE_CUT", currentCents: 149, fromOffset: -1, untilOffset: 5 },
  { key: "dirk-chips-2plus1", concept: "zoute-chips-200g", retailer: "dirk", promoType: "X_PLUS_Y_FREE", promoParams: { buy: 2, free: 1 }, promoDescription: "2+1 gratis", fromOffset: -2, untilOffset: 4 },
  { key: "jumbo-luiers", concept: "luiers-maat4-40", retailer: "jumbo", promoType: "PRICE_CUT", currentCents: 699, fromOffset: 5, untilOffset: 11, conditions: "Maximaal 4 per klant" },
  { key: "vomar-doperwten", concept: "doperwten-diepvries-450g", retailer: "vomar", promoType: "PRICE_CUT", currentCents: 89, fromOffset: -3, untilOffset: 3 },
  { key: "ah-havermout-bio", concept: "bio-havermout-500g", retailer: "ah", promoType: "PRICE_CUT", currentCents: 119, fromOffset: -2, untilOffset: 4 },
];
