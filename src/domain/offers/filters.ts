/** Filters of the offers page, as carried in the URL. */
export type OfferFilters = {
  /** Retailer slugs; empty means every chain. */
  retailers: string[];
  category: string | null;
  brand: string | null;
  /** Only running offers that end within this many days. */
  within: 1 | 3 | 7 | null;
  /** Only offers that have not started yet. */
  upcoming: boolean;
  organic: boolean;
};

export const NO_FILTERS: OfferFilters = {
  retailers: [],
  category: null,
  brand: null,
  within: null,
  upcoming: false,
  organic: false,
};

type RawParams = Record<string, string | string[] | undefined>;

function all(value: string | string[] | undefined): string[] {
  const values = value === undefined ? [] : Array.isArray(value) ? value : [value];
  return values.flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
}

function first(value: string | string[] | undefined): string | null {
  return all(value)[0] ?? null;
}

const SLUG = /^[a-z0-9-]{1,40}$/;

/** Reads filters from search parameters; anything unrecognised is ignored, never an error. */
export function parseOfferFilters(params: RawParams): OfferFilters {
  const within = Number(first(params.within));
  const upcoming = first(params.when) === "upcoming";
  const brand = first(params.brand);
  const category = first(params.category);
  return {
    retailers: [...new Set(all(params.retailer).filter((slug) => SLUG.test(slug)))].sort(),
    category: category !== null && SLUG.test(category) ? category : null,
    brand: brand !== null && brand.length <= 60 ? brand : null,
    // "Ends within" and "not started yet" exclude each other; upcoming wins.
    within: !upcoming && (within === 1 || within === 3 || within === 7) ? within : null,
    upcoming,
    organic: first(params.organic) === "1",
  };
}

/** The query string for a set of filters ("" when none), with a stable parameter order. */
export function offerFiltersQuery(filters: OfferFilters): string {
  const query = new URLSearchParams();
  for (const slug of [...filters.retailers].sort()) query.append("retailer", slug);
  if (filters.category) query.set("category", filters.category);
  if (filters.brand) query.set("brand", filters.brand);
  if (filters.upcoming) query.set("when", "upcoming");
  else if (filters.within) query.set("within", String(filters.within));
  if (filters.organic) query.set("organic", "1");
  const text = query.toString();
  return text ? `?${text}` : "";
}

/** The same filters with one chain switched on or off. */
export function toggleRetailer(filters: OfferFilters, slug: string): OfferFilters {
  const retailers = filters.retailers.includes(slug)
    ? filters.retailers.filter((s) => s !== slug)
    : [...filters.retailers, slug];
  return { ...filters, retailers };
}

export function hasFilters(filters: OfferFilters): boolean {
  return offerFiltersQuery(filters) !== "";
}
