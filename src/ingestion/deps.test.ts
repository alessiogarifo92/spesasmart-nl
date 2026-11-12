import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createRunnerDeps } from "./deps";

const db = {} as PrismaClient;

describe("createRunnerDeps", () => {
  it("reads the enabled adapters and builds an HTTP client from the user agent", () => {
    const deps = createRunnerDeps(db, {
      INGESTION_USER_AGENT: "SpesaSmartNL/0.1 (contact: test@example.test)",
      INGESTION_ENABLED_ADAPTERS: "jumbo, dirk",
    });
    expect(deps.db).toBe(db);
    expect(deps.enabledAdapters).toEqual(["jumbo", "dirk"]);
    expect(typeof deps.createHttp().get).toBe("function");
    expect(deps.now()).toBeInstanceOf(Date);
  });

  it("enables no real adapter and refuses a missing user agent when the variables are unset", () => {
    const deps = createRunnerDeps(db, {});
    expect(deps.enabledAdapters).toEqual([]);
    expect(() => deps.createHttp()).toThrow(/User-Agent/);
  });
});
