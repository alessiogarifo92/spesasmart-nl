import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * A shorter ADMIN_TOKEN is treated as not set: the panel stays switched off. The
 * length is the whole defence against guessing, online and against a copied
 * session cookie, so sign-in has no lockout an outsider could use to keep the owner out.
 */
export const MIN_ADMIN_TOKEN_LENGTH = 32;
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

/** The admin token from the environment, or null when the panel is switched off. */
export function configuredToken(value: string | undefined): string | null {
  const token = (value ?? "").trim();
  return token.length >= MIN_ADMIN_TOKEN_LENGTH ? token : null;
}

const digest = (text: string) => createHash("sha256").update(text).digest();

/** Compares in constant time; hashing first makes both sides the same length. */
export function tokenMatches(given: string, token: string): boolean {
  return timingSafeEqual(digest(given), digest(token));
}

const sign = (token: string, expiresAt: number) =>
  createHmac("sha256", token).update(`spesasmart-admin:${expiresAt}`).digest("hex");

/**
 * The session cookie's value: when it ends and a signature made with the admin
 * token. Nothing is stored on the server, the token itself never leaves it, and
 * changing the token ends every session.
 */
export function signSession(token: string, expiresAt: number): string {
  return `${expiresAt}.${sign(token, expiresAt)}`;
}

export function sessionIsValid(value: string | undefined, token: string, now: number): boolean {
  const match = /^(\d{1,15})\.([0-9a-f]{64})$/.exec(value ?? "");
  if (!match) return false;
  const expiresAt = Number(match[1]);
  if (expiresAt <= now || expiresAt > now + SESSION_TTL_MS) return false;
  return timingSafeEqual(Buffer.from(match[2]!, "hex"), Buffer.from(sign(token, expiresAt), "hex"));
}
