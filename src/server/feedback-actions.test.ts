import { beforeEach, describe, expect, it, vi } from "vitest";

// The report endpoint is a public POST: what it refuses, and what it never does.
const jar = new Map<string, string>();
const setCookie = vi.fn();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: setCookie,
  }),
  headers: async () => ({ get: () => null }),
}));
vi.mock("@/lib/db", () => ({ db: { marker: "db" } }));
vi.mock("./feedback", () => ({
  reportWrongMatch: vi.fn(async () => "sent"),
  reportWrongPrice: vi.fn(async () => "sent"),
}));

import { DEVICE_COOKIE } from "./device";
import * as feedback from "./feedback";
import { reportAction } from "./feedback-actions";

const DEVICE = "3f2b8c1e-5d4a-4b6f-9a7e-0c1d2e3f4a5b";
const PRODUCT = "cmabcdefgh0001xyz";
const MATCH = "cmabcdefgh0002xyz";

function form(values: Record<string, string | Blob>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) data.set(name, value);
  return data;
}

beforeEach(() => {
  jar.clear();
  vi.clearAllMocks();
});

describe("reportAction", () => {
  it("reports a wrong link when a link is named, without a device when the browser has none", async () => {
    expect(await reportAction(null, form({ productId: PRODUCT, matchId: MATCH }))).toBe("sent");
    expect(feedback.reportWrongMatch).toHaveBeenCalledWith(expect.anything(), {
      matchId: MATCH,
      productId: PRODUCT,
      deviceId: null,
    });
    expect(feedback.reportWrongPrice).not.toHaveBeenCalled();
    // Reporting never creates the device cookie.
    expect(setCookie).not.toHaveBeenCalled();
  });

  it("reports a wrong price when no link is named, and notes the device the browser already has", async () => {
    jar.set(DEVICE_COOKIE, DEVICE);
    expect(await reportAction(null, form({ productId: PRODUCT }))).toBe("sent");
    expect(feedback.reportWrongPrice).toHaveBeenCalledWith(expect.anything(), { productId: PRODUCT, deviceId: DEVICE });
    expect(feedback.reportWrongMatch).not.toHaveBeenCalled();
  });

  it("ignores a device cookie that is not a device id", async () => {
    jar.set(DEVICE_COOKIE, "<script>alert(1)</script>");
    await reportAction(null, form({ productId: PRODUCT }));
    expect(feedback.reportWrongPrice).toHaveBeenCalledWith(expect.anything(), { productId: PRODUCT, deviceId: null });
  });

  it("tells the visitor the same thing when the report was already known", async () => {
    vi.mocked(feedback.reportWrongMatch).mockResolvedValueOnce("known");
    expect(await reportAction(null, form({ productId: PRODUCT, matchId: MATCH }))).toBe("sent");
  });

  it("fails when the product or the link does not exist", async () => {
    vi.mocked(feedback.reportWrongMatch).mockResolvedValueOnce("not-found");
    expect(await reportAction(null, form({ productId: PRODUCT, matchId: MATCH }))).toBe("failed");
    vi.mocked(feedback.reportWrongPrice).mockResolvedValueOnce("not-found");
    expect(await reportAction(null, form({ productId: PRODUCT }))).toBe("failed");
  });

  it.each([
    ["no product", {}],
    ["a product id that is not an id", { productId: "1 OR 1=1" }],
    ["a link id that is not an id", { productId: PRODUCT, matchId: "../../x" }],
    ["a file as product", { productId: new Blob(["x"]) }],
    ["an empty link id", { productId: PRODUCT, matchId: "" }],
  ])("refuses %s without touching the database", async (_name, values) => {
    expect(await reportAction(null, form(values as Record<string, string | Blob>))).toBe("failed");
    expect(feedback.reportWrongMatch).not.toHaveBeenCalled();
    expect(feedback.reportWrongPrice).not.toHaveBeenCalled();
  });
});
