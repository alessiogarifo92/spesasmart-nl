import { describe, expect, it } from "vitest";
import {
  configuredToken,
  MIN_ADMIN_TOKEN_LENGTH,
  SESSION_TTL_MS,
  sessionIsValid,
  signSession,
  tokenMatches,
} from "./admin-session";

const TOKEN = "correct-horse-battery-staple-0123456789";
const NOW = 1_800_000_000_000;

describe("configuredToken", () => {
  it.each([undefined, "", "   ", "short", "x".repeat(MIN_ADMIN_TOKEN_LENGTH - 1)])("treats %j as no token", (value) => {
    expect(configuredToken(value)).toBeNull();
  });

  it("accepts a long enough token and trims it", () => {
    expect(configuredToken(`  ${TOKEN}\n`)).toBe(TOKEN);
    expect(configuredToken("x".repeat(MIN_ADMIN_TOKEN_LENGTH))).toHaveLength(MIN_ADMIN_TOKEN_LENGTH);
  });
});

describe("tokenMatches", () => {
  it("accepts only the exact token", () => {
    expect(tokenMatches(TOKEN, TOKEN)).toBe(true);
    for (const wrong of ["", TOKEN.slice(0, -1), `${TOKEN}x`, TOKEN.toUpperCase()]) {
      expect(tokenMatches(wrong, TOKEN)).toBe(false);
    }
  });
});

describe("session cookie", () => {
  const value = signSession(TOKEN, NOW + SESSION_TTL_MS);

  it("is valid until it expires", () => {
    expect(sessionIsValid(value, TOKEN, NOW)).toBe(true);
    expect(sessionIsValid(value, TOKEN, NOW + SESSION_TTL_MS - 1)).toBe(true);
    expect(sessionIsValid(value, TOKEN, NOW + SESSION_TTL_MS)).toBe(false);
  });

  it("does not contain the token", () => {
    expect(value).not.toContain(TOKEN);
  });

  it("stops working when the token changes", () => {
    expect(sessionIsValid(value, "another-token-entirely-0123456789abcdef", NOW)).toBe(false);
  });

  it("refuses a changed expiry or signature", () => {
    const [expiry, signature] = value.split(".") as [string, string];
    expect(sessionIsValid(`${Number(expiry) + 1}.${signature}`, TOKEN, NOW)).toBe(false);
    const flipped = (signature[0] === "0" ? "1" : "0") + signature.slice(1);
    expect(sessionIsValid(`${expiry}.${flipped}`, TOKEN, NOW)).toBe(false);
  });

  it("refuses an expiry further away than a session lasts, even when signed", () => {
    expect(sessionIsValid(signSession(TOKEN, NOW + SESSION_TTL_MS + 1), TOKEN, NOW)).toBe(false);
  });

  it.each([undefined, "", "abc", "123", "123.", ".abc", `${NOW}.zz`, `${NOW}.${"a".repeat(63)}`, `x${value}`])(
    "refuses the malformed value %j",
    (bad) => {
      expect(sessionIsValid(bad, TOKEN, NOW)).toBe(false);
    },
  );
});
