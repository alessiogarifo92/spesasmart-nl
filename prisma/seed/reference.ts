/** Reference data: real chains and the app's own category tree. Not demo data. */

export const RETAILERS = [
  { slug: "ah", name: "Albert Heijn", website: "https://www.ah.nl" },
  { slug: "jumbo", name: "Jumbo", website: "https://www.jumbo.com" },
  { slug: "vomar", name: "Vomar", website: "https://www.vomar.nl" },
  { slug: "dirk", name: "Dirk", website: "https://www.dirk.nl" },
] as const;

export type RetailerSlug = (typeof RETAILERS)[number]["slug"];

export const CATEGORIES = [
  { slug: "groente-fruit", nameNl: "Groente & fruit", nameEn: "Fruit & vegetables", nameIt: "Frutta e verdura" },
  { slug: "vlees-vis", nameNl: "Vlees & vis", nameEn: "Meat & fish", nameIt: "Carne e pesce" },
  { slug: "zuivel-eieren", nameNl: "Zuivel & eieren", nameEn: "Dairy & eggs", nameIt: "Latticini e uova" },
  { slug: "brood-bakkerij", nameNl: "Brood & bakkerij", nameEn: "Bread & bakery", nameIt: "Pane e forno" },
  { slug: "voorraadkast", nameNl: "Voorraadkast", nameEn: "Pantry", nameIt: "Dispensa" },
  { slug: "koffie-thee", nameNl: "Koffie & thee", nameEn: "Coffee & tea", nameIt: "Caffè e tè" },
  { slug: "dranken", nameNl: "Dranken", nameEn: "Drinks", nameIt: "Bevande" },
  { slug: "diepvries", nameNl: "Diepvries", nameEn: "Frozen", nameIt: "Surgelati" },
  { slug: "snoep-snacks", nameNl: "Snoep & snacks", nameEn: "Sweets & snacks", nameIt: "Dolci e snack" },
  { slug: "huishouden", nameNl: "Huishouden", nameEn: "Household", nameIt: "Casa e pulizia" },
  { slug: "verzorging", nameNl: "Verzorging", nameEn: "Personal care", nameIt: "Cura della persona" },
  { slug: "baby", nameNl: "Baby", nameEn: "Baby", nameIt: "Bambini" },
] as const;

export type CategorySlug = (typeof CATEGORIES)[number]["slug"];
