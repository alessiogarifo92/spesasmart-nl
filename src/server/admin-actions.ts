"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { MATCH_DECISIONS, decideMatch, renameCategory, resolveFeedback, setRetailerSwitch } from "./admin";
import { adminToken, endAdminSession, isAdmin, startAdminSession } from "./admin-auth";
import { tokenMatches } from "./admin-session";

/** Why the sign-in form refused; null before a submit and after a good one. */
export type LoginState = { error: "wrong" } | null;

const id = z.string().regex(/^[a-z0-9]{8,40}$/);
const name = z.string().trim().min(1).max(60);
const changed = () => revalidatePath("/", "layout");

/**
 * Trades the admin token for a session cookie. Like every Server Function this is
 * a public POST endpoint: with no token configured it refuses everything. There is
 * no lockout on purpose: it would let anyone keep the owner out, and a token of
 * the required length cannot be guessed.
 */
export async function adminLoginAction(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const token = adminToken();
  if (token === null) return { error: "wrong" };
  const given = formData.get("token");
  if (typeof given !== "string" || given.length > 512 || !tokenMatches(given.trim(), token)) {
    return { error: "wrong" };
  }
  await startAdminSession(token);
  changed();
  return null;
}

export async function adminLogoutAction(): Promise<void> {
  if (!(await isAdmin())) return;
  await endAdminSession();
  changed();
}

const switchSchema = z.object({
  retailerId: id,
  field: z.enum(["active", "adapterEnabled"]),
  value: z.enum(["on", "off"]),
});

export async function retailerSwitchAction(formData: FormData): Promise<void> {
  if (!(await isAdmin())) return;
  const parsed = switchSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const { retailerId, field, value } = parsed.data;
  await setRetailerSwitch(db, { retailerId, field, value: value === "on" });
  changed();
}

const decisionSchema = z.object({ matchId: id, decision: z.enum(MATCH_DECISIONS) });

export async function decideMatchAction(formData: FormData): Promise<void> {
  if (!(await isAdmin())) return;
  const parsed = decisionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  await decideMatch(db, { ...parsed.data, now: new Date() });
  changed();
}

export async function resolveFeedbackAction(formData: FormData): Promise<void> {
  if (!(await isAdmin())) return;
  const parsed = id.safeParse(formData.get("feedbackId"));
  if (!parsed.success) return;
  await resolveFeedback(db, { feedbackId: parsed.data, now: new Date() });
  changed();
}

const categorySchema = z.object({ categoryId: id, nameNl: name, nameEn: name, nameIt: name });

export async function renameCategoryAction(formData: FormData): Promise<void> {
  if (!(await isAdmin())) return;
  const parsed = categorySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  await renameCategory(db, parsed.data);
  changed();
}
