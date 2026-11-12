import { createMockAdapter } from "./mock-adapter";

/** Albert Heijn style: "3,49". */
export const mockAh = createMockAdapter({ retailerSlug: "ah", impliedCents: false });
/** Jumbo style: "3,49"; promotion weeks run Wednesday to Tuesday. */
export const mockJumbo = createMockAdapter({ retailerSlug: "jumbo", impliedCents: false });
/** Vomar style: cents as "349" and "geldig van" before the dates. */
export const mockVomar = createMockAdapter({ retailerSlug: "vomar", impliedCents: true, validityPrefix: "geldig van " });
/** Dirk style: cents as "349". */
export const mockDirk = createMockAdapter({ retailerSlug: "dirk", impliedCents: true });

export const MOCK_ADAPTERS = [mockAh, mockJumbo, mockVomar, mockDirk] as const;
