import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The admin actions are public POST endpoints like any other Server Function:
// these tests pin down that nothing happens without a valid session.
const jar = new Map<string, string>();
const cookieOptions = new Map<string, Record<string, unknown>>();
const requestHeaders = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string, options: Record<string, unknown>) => {
      jar.set(name, value);
      cookieOptions.set(name, options);
    },
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => ({ get: (name: string) => requestHeaders.get(name) ?? null }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { marker: "db" } }));
vi.mock("./admin", async (original) => {
  const actual = await original<typeof import("./admin")>();
  return {
    ...actual,
    setRetailerSwitch: vi.fn(async () => true),
    decideMatch: vi.fn(async () => true),
    resolveFeedback: vi.fn(async () => true),
    renameCategory: vi.fn(async () => true),
  };
});

import { revalidatePath } from "next/cache";
import { decideMatch, renameCategory, resolveFeedback, setRetailerSwitch } from "./admin";
import { ADMIN_COOKIE, adminToken, isAdmin } from "./admin-auth";
import { SESSION_TTL_MS, signSession } from "./admin-session";

const TOKEN = "correct-horse-battery-staple-0123456789";
const ID = "cabcdefgh12345678";
const NOW = new Date("2026-11-12T10:00:00Z");

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

/** A fresh copy of the actions, so each test starts with an empty lockout counter. */
async function actions() {
  vi.resetModules();
  return import("./admin-actions");
}

const signIn = () => void jar.set(ADMIN_COOKIE, signSession(TOKEN, Date.now() + SESSION_TTL_MS));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("ADMIN_TOKEN", TOKEN);
  jar.clear();
  cookieOptions.clear();
  requestHeaders.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("admin panel switched off", () => {
  it.each(["", "too-short", "sixteen-chars-ok!", "x".repeat(31)])(
    "has no token and no session with ADMIN_TOKEN=%j",
    async (value) => {
      vi.stubEnv("ADMIN_TOKEN", value);
      expect(adminToken()).toBeNull();
      // Even a cookie signed with that value is worthless.
      jar.set(ADMIN_COOKIE, signSession(value, Date.now() + SESSION_TTL_MS));
      expect(await isAdmin()).toBe(false);
    },
  );

  it("refuses every sign-in, the empty token included", async () => {
    vi.stubEnv("ADMIN_TOKEN", "");
    const { adminLoginAction } = await actions();
    expect(await adminLoginAction(null, form({ token: "" }))).toEqual({ error: "wrong" });
    expect(jar.has(ADMIN_COOKIE)).toBe(false);
  });
});

describe("adminLoginAction", () => {
  it("sets a session cookie for the right token", async () => {
    const { adminLoginAction } = await actions();
    expect(await adminLoginAction(null, form({ token: ` ${TOKEN} ` }))).toBeNull();
    expect(await isAdmin()).toBe(true);
    expect(jar.get(ADMIN_COOKIE)).not.toContain(TOKEN);
    expect(cookieOptions.get(ADMIN_COOKIE)).toEqual({
      httpOnly: true,
      sameSite: "strict",
      secure: false,
      path: "/",
      maxAge: SESSION_TTL_MS / 1000,
    });
  });

  it("marks the cookie secure behind https", async () => {
    requestHeaders.set("x-forwarded-proto", "https");
    const { adminLoginAction } = await actions();
    await adminLoginAction(null, form({ token: TOKEN }));
    expect(cookieOptions.get(ADMIN_COOKIE)).toMatchObject({ secure: true });
  });

  it("the session ends after eight hours", async () => {
    const { adminLoginAction } = await actions();
    await adminLoginAction(null, form({ token: TOKEN }));
    vi.setSystemTime(NOW.getTime() + SESSION_TTL_MS - 1000);
    expect(await isAdmin()).toBe(true);
    vi.setSystemTime(NOW.getTime() + SESSION_TTL_MS);
    expect(await isAdmin()).toBe(false);
  });

  it.each([{}, { token: "" }, { token: "wrong-token-wrong-token" }, { token: "x".repeat(600) }])(
    "refuses %j without a cookie",
    async (fields) => {
      const { adminLoginAction } = await actions();
      expect(await adminLoginAction(null, form(fields as Record<string, string>))).toEqual({ error: "wrong" });
      expect(jar.has(ADMIN_COOKIE)).toBe(false);
    },
  );

  it("never locks: after many wrong tokens the right one still signs in", async () => {
    const { adminLoginAction } = await actions();
    for (let attempt = 0; attempt < 50; attempt++) {
      expect(await adminLoginAction(null, form({ token: "nope" }))).toEqual({ error: "wrong" });
    }
    expect(jar.has(ADMIN_COOKIE)).toBe(false);
    expect(await adminLoginAction(null, form({ token: TOKEN }))).toBeNull();
    expect(await isAdmin()).toBe(true);
  });
});

const VALID = {
  retailerSwitchAction: { retailerId: ID, field: "adapterEnabled", value: "off" },
  decideMatchAction: { matchId: ID, decision: "REJECT" },
  resolveFeedbackAction: { feedbackId: ID },
  renameCategoryAction: { categoryId: ID, nameNl: "Zuivel", nameEn: "Dairy", nameIt: "Latticini" },
} as const;
const mutations = [setRetailerSwitch, decideMatch, resolveFeedback, renameCategory];
type ActionName = keyof typeof VALID;

describe("admin mutations", () => {
  it.each(Object.keys(VALID) as ActionName[])("%s does nothing without a session", async (name) => {
    const all = await actions();
    await all[name](form(VALID[name]));
    jar.set(ADMIN_COOKIE, "1.deadbeef");
    await all[name](form(VALID[name]));
    jar.set(ADMIN_COOKIE, signSession("some-other-admin-token-0123456789abcdef", Date.now() + SESSION_TTL_MS));
    await all[name](form(VALID[name]));
    for (const mutation of mutations) expect(mutation).not.toHaveBeenCalled();
  });

  it("does nothing with a session when the panel is switched off afterwards", async () => {
    signIn();
    vi.stubEnv("ADMIN_TOKEN", "");
    const { retailerSwitchAction } = await actions();
    await retailerSwitchAction(form(VALID.retailerSwitchAction));
    expect(setRetailerSwitch).not.toHaveBeenCalled();
  });

  it("passes valid input through with a session", async () => {
    signIn();
    const all = await actions();
    await all.retailerSwitchAction(form(VALID.retailerSwitchAction));
    expect(setRetailerSwitch).toHaveBeenCalledWith(expect.anything(), {
      retailerId: ID,
      field: "adapterEnabled",
      value: false,
    });
    await all.retailerSwitchAction(form({ retailerId: ID, field: "active", value: "on" }));
    expect(setRetailerSwitch).toHaveBeenLastCalledWith(expect.anything(), {
      retailerId: ID,
      field: "active",
      value: true,
    });
    await all.decideMatchAction(form({ matchId: ID, decision: "SIMILAR" }));
    expect(decideMatch).toHaveBeenCalledWith(expect.anything(), { matchId: ID, decision: "SIMILAR", now: NOW });
    await all.resolveFeedbackAction(form(VALID.resolveFeedbackAction));
    expect(resolveFeedback).toHaveBeenCalledWith(expect.anything(), { feedbackId: ID, now: NOW });
    await all.renameCategoryAction(form({ ...VALID.renameCategoryAction, nameNl: "  Zuivel  " }));
    expect(renameCategory).toHaveBeenCalledWith(expect.anything(), VALID.renameCategoryAction);
  });

  it.each<[ActionName, Record<string, string>]>([
    ["retailerSwitchAction", { retailerId: "x'; drop table", field: "adapterEnabled", value: "off" }],
    ["retailerSwitchAction", { retailerId: ID, field: "slug", value: "off" }],
    ["retailerSwitchAction", { retailerId: ID, field: "active", value: "true" }],
    ["retailerSwitchAction", { retailerId: ID, field: "active" }],
    ["decideMatchAction", { matchId: ID, decision: "CONFIRMED" }],
    ["decideMatchAction", { decision: "SAME" }],
    ["resolveFeedbackAction", {}],
    ["resolveFeedbackAction", { feedbackId: "../etc" }],
    ["renameCategoryAction", { categoryId: ID, nameNl: "  ", nameEn: "Dairy", nameIt: "Latticini" }],
    ["renameCategoryAction", { categoryId: ID, nameNl: "x".repeat(61), nameEn: "Dairy", nameIt: "Latticini" }],
    ["renameCategoryAction", { categoryId: ID, nameNl: "Zuivel", nameEn: "Dairy" }],
  ])("%s refuses %j even with a session", async (name, fields) => {
    signIn();
    const all = await actions();
    await all[name](form(fields));
    for (const mutation of mutations) expect(mutation).not.toHaveBeenCalled();
  });

  it("sign-out removes the session", async () => {
    signIn();
    const { adminLogoutAction } = await actions();
    await adminLogoutAction();
    expect(await isAdmin()).toBe(false);
    expect(revalidatePath).toHaveBeenCalledTimes(1);
    // Without a session it changes nothing, so an outsider cannot make pages re-render.
    await adminLogoutAction();
    expect(revalidatePath).toHaveBeenCalledTimes(1);
  });
});
