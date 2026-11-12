import { cookies, headers } from "next/headers";
import { configuredToken, sessionIsValid, signSession, SESSION_TTL_MS } from "./admin-session";

export const ADMIN_COOKIE = "ss_admin";

/** The admin token, or null when ADMIN_TOKEN is empty or too short: then there is no admin panel. */
export function adminToken(): string | null {
  return configuredToken(process.env.ADMIN_TOKEN);
}

/** True when this request carries a valid admin session. Every admin page and action asks this first. */
export async function isAdmin(now: number = Date.now()): Promise<boolean> {
  const token = adminToken();
  if (token === null) return false;
  return sessionIsValid((await cookies()).get(ADMIN_COOKIE)?.value, token, now);
}

/** Only inside a Server Function: it writes the cookie. */
export async function startAdminSession(token: string, now: number = Date.now()): Promise<void> {
  const https = (await headers()).get("x-forwarded-proto")?.split(",")[0]?.trim() === "https";
  (await cookies()).set(ADMIN_COOKIE, signSession(token, now + SESSION_TTL_MS), {
    httpOnly: true,
    sameSite: "strict",
    secure: https,
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function endAdminSession(): Promise<void> {
  (await cookies()).delete(ADMIN_COOKIE);
}
