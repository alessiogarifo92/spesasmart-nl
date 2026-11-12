import type { Promotion, Quantity, UnitPrice } from "@/domain/pricing";

/** Identifier of a supermarket chain ("ah", "jumbo"). */
export type RetailerId = string;

/** How close a candidate is to what the shopper asked for. EXACT is the product they picked. */
export type MatchTier = "EXACT" | "SAME" | "SIMILAR" | "ALTERNATIVE";

export type CandidateOffer = {
  offerId: string;
  promotion: Promotion;
  /** Price of one item under the offer in cents, when the source states one. */
  offerPriceCents: number | null;
  /** False when the validity is unknown or doubtful: the offer is then never used for the price. */
  verified: boolean;
  /** Days until the offer ends, 0 = ends today; null when unknown. */
  daysLeft: number | null;
};

export type Candidate = {
  productId: string;
  retailerId: RetailerId;
  name: string;
  tier: MatchTier;
  /** Regular price of one item in cents; null when unknown. */
  regularPriceCents: number | null;
  /** An offer running today, if any. */
  offer: CandidateOffer | null;
  /** Package size; null when unknown. */
  quantity: Quantity | null;
  isOrganic: boolean;
};

export type ListItem = {
  id: string;
  label: string;
  /** Number of items wanted, a positive integer. */
  quantity: number;
  /** The shopper wants this item from this chain only. */
  pinnedRetailerId: RetailerId | null;
  candidates: Candidate[];
};

export type Mode = "max-savings" | "fewest-stores" | "offers-only" | "organic-only";

/**
 * Which candidates compete on price with the product the shopper picked. "exact": none,
 * the pick wins wherever a chosen chain sells it. "same": the same product at another chain.
 * "similar": also a very similar one (same size, another or no brand).
 */
export type Substitutes = "exact" | "same" | "similar";

export type Options = {
  maxStores: 1 | 2 | 3;
  mode: Mode;
  /** Defaults to "exact". */
  substitutes?: Substitutes;
  /** Budget in cents; null or absent for none. */
  budgetCents?: number | null;
};

/** The deal needs more items than the shopper asked for. The quantity is never changed. */
export type DealHint = { code: "buy-more-for-deal"; minimumQuantity: number };

/** Price of one candidate for a requested quantity. */
export type CandidatePrice = {
  /** What the line costs, in cents: the lower of the offer total and the regular total. */
  totalCents: number;
  /** totalCents / quantity, rounded half up. */
  unitCents: number;
  /** Regular price × quantity in cents; null when the regular price is unknown. */
  regularTotalCents: number | null;
  /** True only when the offer makes the line cheaper than the regular price (or no regular price is known). */
  usedOffer: boolean;
  /** True when an UNKNOWN promotion was priced as a plain price cut. */
  assumed: boolean;
  /** Price per kg, litre or piece of the line; null when the package size is unknown. */
  unitPrice: UnitPrice | null;
  hint: DealHint | null;
};

/** Why a line was chosen. The interface turns codes into sentences. */
export type LineReason =
  | { code: "pinned" }
  /** No other chain, among all of them, can supply the item. */
  | { code: "only-store" }
  /** Chosen with an offer; saving against its own regular total, null when that is unknown. */
  | { code: "offer"; savingCents: number | null; daysLeft: number | null }
  /** Compared with the next-best chain in the chosen set among candidates that compete on price; nulls when there is none. */
  | { code: "cheapest"; nextRetailerId: RetailerId | null; differenceCents: number | null }
  /** Chosen for its tier over a cheaper, less similar candidate in the chosen set that does not compete on price. */
  | { code: "closest-match" };

export type PlanLine = {
  itemId: string;
  label: string;
  quantity: number;
  candidate: Candidate;
  totalCents: number;
  /** totalCents / quantity, rounded half up. */
  unitCents: number;
  regularTotalCents: number | null;
  usedOffer: boolean;
  assumed: boolean;
  reason: LineReason;
  hint: DealHint | null;
};

export type Stop = { retailerId: RetailerId; lines: PlanLine[]; subtotalCents: number };

export type SingleStore = {
  retailerId: RetailerId;
  totalCents: number;
  coveredCount: number;
  missingItemIds: string[];
};

export type MissingReason = "not-found" | "pinned-unavailable" | "filtered" | "not-in-chosen-stores";

export type MissingItem = { itemId: string; label: string; reason: MissingReason };

export type Comparison = { retailerId: RetailerId; totalCents: number; savingCents: number };

export type Plan = {
  /** Ordered by subtotal descending, then retailerId. Never contains an empty stop. */
  stops: Stop[];
  totalCents: number;
  itemCount: number;
  coveredCount: number;
  missing: MissingItem[];
  /** Every chain on its own under the same mode filter and pin rules; best coverage, then cheapest first. */
  singleStores: SingleStore[];
  /** Best single chain covering every item the plan covers; null when none does or it is the plan itself. */
  comparison: Comparison | null;
  /** Sum over lines of regularTotalCents − totalCents, where the regular price is known. */
  offerSavingCents: number;
  /** totalCents − budget when a budget is given and exceeded; null otherwise. */
  overBudgetCents: number | null;
  /** The pinned chains alone are more than maxStores: the plan uses exactly those. */
  maxStoresExceeded: boolean;
};
