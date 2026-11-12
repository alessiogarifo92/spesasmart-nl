import type { PrismaClient } from "@/generated/prisma/client";

/** "sent": a new report was stored. "known": an open report on the same thing already exists. */
export type ReportOutcome = "sent" | "known" | "not-found";

/**
 * Stores "these two are not the same product" for a link the product is part of.
 * One open report per link is enough to put it in front of a person, so a second
 * one is acknowledged and not stored: the table cannot be flooded by tapping.
 */
export async function reportWrongMatch(
  db: PrismaClient,
  input: { matchId: string; productId: string; deviceId: string | null },
): Promise<ReportOutcome> {
  const match = await db.productMatch.findFirst({
    where: {
      id: input.matchId,
      OR: [{ canonicalProductId: input.productId }, { candidateProductId: input.productId }],
    },
    select: { id: true },
  });
  if (!match) return "not-found";
  const open = await db.feedback.findFirst({
    where: { kind: "WRONG_MATCH", productMatchId: match.id, resolvedAt: null },
    select: { id: true },
  });
  if (open) return "known";
  await db.feedback.create({
    data: { kind: "WRONG_MATCH", productMatchId: match.id, productId: input.productId, deviceId: input.deviceId },
  });
  return "sent";
}

/** Stores "this price is wrong" for a product; one open report per product. */
export async function reportWrongPrice(
  db: PrismaClient,
  input: { productId: string; deviceId: string | null },
): Promise<ReportOutcome> {
  const product = await db.product.findUnique({ where: { id: input.productId }, select: { id: true } });
  if (!product) return "not-found";
  const open = await db.feedback.findFirst({
    where: { kind: "WRONG_PRICE", productId: product.id, resolvedAt: null },
    select: { id: true },
  });
  if (open) return "known";
  await db.feedback.create({ data: { kind: "WRONG_PRICE", productId: product.id, deviceId: input.deviceId } });
  return "sent";
}
