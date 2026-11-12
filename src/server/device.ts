import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { isDeviceId } from "./lists";

/**
 * The only thing that ties a shopping list to a browser: a random id in a cookie.
 * It is not derived from anything about the device or the person, JavaScript
 * cannot read it, and it is written the first time something is saved, never on a
 * page view.
 */
export const DEVICE_COOKIE = "ss_device";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** The device id of this request, or null when the browser has not saved anything yet. */
export async function readDeviceId(): Promise<string | null> {
  const value = (await cookies()).get(DEVICE_COOKIE)?.value;
  return isDeviceId(value) ? value : null;
}

/** The device id, created when missing. Only inside a Server Function: it writes the cookie. */
export async function ensureDeviceId(): Promise<string> {
  const id = (await readDeviceId()) ?? randomUUID();
  // "Secure" follows the request, so the list also works on http://<lan address> during a local check.
  const https = (await headers()).get("x-forwarded-proto")?.split(",")[0]?.trim() === "https";
  (await cookies()).set(DEVICE_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: https,
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
  });
  return id;
}

export async function clearDeviceId(): Promise<void> {
  (await cookies()).delete(DEVICE_COOKIE);
}
