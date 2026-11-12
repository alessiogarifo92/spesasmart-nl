import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";

/** True for an EAN-13 in the GS1 in-store range (prefix 20) with a valid check digit. */
export function isValidDemoEan(ean: string): boolean {
  if (!/^20\d{11}$/.test(ean)) return false;
  const sum = [...ean.slice(0, 12)].reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10 === Number(ean[12]);
}

/**
 * A retailer that exists only for one test file. Everything a test hangs off it
 * is removed by `remove()` through cascading deletes, so tests never touch rows
 * they did not create.
 */
export async function createScratchRetailer(label: string) {
  const retailer = await db.retailer.create({
    data: { slug: `test-${label}-${randomUUID()}`, name: `Test ${label}` },
  });
  return {
    id: retailer.id,
    slug: retailer.slug,
    remove: () => db.retailer.delete({ where: { id: retailer.id } }),
  };
}
