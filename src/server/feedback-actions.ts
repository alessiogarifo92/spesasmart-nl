"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { readDeviceId } from "./device";
import { reportWrongMatch, reportWrongPrice } from "./feedback";

/** What the report button shows after a tap; null before one. */
export type ReportState = "sent" | "failed" | null;

const id = z.string().regex(/^[a-z0-9]{8,40}$/);
const schema = z.object({ productId: id, matchId: id.optional() });

/**
 * "This is not the same product" (with a link) or "this price is wrong" (without).
 * A public POST endpoint: it validates its input, stores no text from the visitor,
 * and never creates the device cookie; a browser that has one is noted on the report.
 */
export async function reportAction(_previous: ReportState, formData: FormData): Promise<ReportState> {
  const parsed = schema.safeParse({
    productId: formData.get("productId") ?? undefined,
    matchId: formData.get("matchId") ?? undefined,
  });
  if (!parsed.success) return "failed";
  const { productId, matchId } = parsed.data;
  const deviceId = await readDeviceId();
  const outcome = matchId
    ? await reportWrongMatch(db, { matchId, productId, deviceId })
    : await reportWrongPrice(db, { productId, deviceId });
  // An open report already exists: for the visitor that is the same good news.
  return outcome === "not-found" ? "failed" : "sent";
}
