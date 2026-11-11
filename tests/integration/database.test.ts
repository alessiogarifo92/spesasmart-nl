import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";

describe("database", () => {
  afterAll(async () => {
    await db.$disconnect();
  });

  it("connects to the test database", async () => {
    const rows = await db.$queryRaw<{ name: string }[]>`select current_database() as name`;
    expect(rows[0]?.name).toBe("spesasmart_test");
  });
});
