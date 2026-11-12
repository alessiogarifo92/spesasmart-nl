import { beforeEach, describe, expect, it, vi } from "vitest";

// The actions are public POST endpoints: these tests pin down what they refuse
// before anything reaches the database, with the database layer replaced.
const jar = new Map<string, string>();
const setCookie = vi.fn((name: string, value: string) => void jar.set(name, value));
const requestHeaders = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: setCookie,
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => ({ get: (name: string) => requestHeaders.get(name) ?? null }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getTranslations: async ({ locale }: { locale: string }) => (key: string) => `${key}:${locale}`,
}));
vi.mock("@/lib/db", () => ({ db: { marker: "db" } }));
vi.mock("./lists", async (original) => {
  const actual = await original<typeof import("./lists")>();
  const done = async () => ({ ok: true as const, value: null });
  return {
    ...actual,
    addItem: vi.fn(async () => ({ ok: true as const, value: { listId: "l", itemId: "i", quantity: 1 } })),
    createList: vi.fn(async () => ({ ok: true as const, value: { id: "l" } })),
    updateItem: vi.fn(done),
    removeItem: vi.fn(done),
    renameList: vi.fn(done),
    selectList: vi.fn(done),
    uncheckAll: vi.fn(done),
    deleteList: vi.fn(done),
    forgetDevice: vi.fn(async () => undefined),
  };
});

import { revalidatePath } from "next/cache";
import { DEVICE_COOKIE } from "./device";
import {
  addToListAction,
  createListAction,
  deleteListAction,
  forgetDeviceAction,
  removeItemAction,
  renameListAction,
  selectListAction,
  uncheckAllAction,
  updateItemAction,
} from "./list-actions";
import * as lists from "./lists";

const DEVICE = "3f2b8c1e-5d4a-4b6f-9a7e-0c1d2e3f4a5b";
const ITEM = "cmabcdefgh0001xyz";

function form(values: Record<string, string | Blob>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) data.set(name, value);
  return data;
}

beforeEach(() => {
  jar.clear();
  requestHeaders.clear();
  vi.clearAllMocks();
});

describe("addToListAction", () => {
  it("adds a product for a new device and gives it a cookie scripts cannot read", async () => {
    expect(await addToListAction(null, form({ productId: ITEM, locale: "it" }))).toBeNull();
    const deviceId = jar.get(DEVICE_COOKIE)!;
    expect(lists.isDeviceId(deviceId)).toBe(true);
    expect(setCookie).toHaveBeenCalledWith(
      DEVICE_COOKIE,
      deviceId,
      expect.objectContaining({ httpOnly: true, sameSite: "lax", secure: false, path: "/" }),
    );
    expect(lists.addItem).toHaveBeenCalledWith(expect.anything(), deviceId, {
      defaultListName: "defaultName:it",
      productId: ITEM,
      label: undefined,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("keeps the device it already has, and marks the cookie secure over https", async () => {
    jar.set(DEVICE_COOKIE, DEVICE);
    requestHeaders.set("x-forwarded-proto", "https");
    await addToListAction(null, form({ label: "  tahin ", locale: "nl" }));
    expect(lists.addItem).toHaveBeenCalledWith(expect.anything(), DEVICE, {
      defaultListName: "defaultName:nl",
      productId: undefined,
      label: "tahin",
    });
    expect(setCookie).toHaveBeenCalledWith(DEVICE_COOKIE, DEVICE, expect.objectContaining({ secure: true }));
  });

  it("replaces a cookie that is not a device id instead of using it", async () => {
    jar.set(DEVICE_COOKIE, "'; DROP TABLE shopping_lists; --");
    await addToListAction(null, form({ label: "melk", locale: "nl" }));
    expect(lists.isDeviceId(jar.get(DEVICE_COOKIE))).toBe(true);
  });

  it.each([
    ["nothing to add", { locale: "nl" }],
    ["both a product and a text", { productId: ITEM, label: "melk", locale: "nl" }],
    ["an empty text", { label: "   ", locale: "nl" }],
    ["a text that is too long", { label: "x".repeat(81), locale: "nl" }],
    ["a product id that is not an id", { productId: "../../etc/passwd", locale: "nl" }],
    ["an unknown language", { label: "melk", locale: "xx" }],
    ["no language", { label: "melk" }],
    ["a file where text is expected", { label: new Blob(["melk"]), locale: "nl" }],
  ])("refuses %s without writing anything", async (_name, values) => {
    expect(await addToListAction(null, form(values as Record<string, string | Blob>))).toEqual({ error: "invalid" });
    expect(lists.addItem).not.toHaveBeenCalled();
    expect(setCookie).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("reports why the list refused", async () => {
    vi.mocked(lists.addItem).mockResolvedValueOnce({ ok: false, reason: "too-many-items" });
    expect(await addToListAction(null, form({ label: "melk", locale: "nl" }))).toEqual({ error: "too-many-items" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("updateItemAction", () => {
  beforeEach(() => void jar.set(DEVICE_COOKIE, DEVICE));

  it("passes on only the field that was sent", async () => {
    await updateItemAction(form({ itemId: ITEM, quantity: "3" }));
    expect(lists.updateItem).toHaveBeenLastCalledWith(expect.anything(), DEVICE, ITEM, {
      quantity: 3,
      checked: undefined,
      pinnedRetailerSlug: undefined,
    });
    await updateItemAction(form({ itemId: ITEM, checked: "true" }));
    expect(lists.updateItem).toHaveBeenLastCalledWith(expect.anything(), DEVICE, ITEM, {
      quantity: undefined,
      checked: true,
      pinnedRetailerSlug: undefined,
    });
    await updateItemAction(form({ itemId: ITEM, checked: "false" }));
    expect(lists.updateItem).toHaveBeenLastCalledWith(
      expect.anything(),
      DEVICE,
      ITEM,
      expect.objectContaining({ checked: false }),
    );
  });

  it("reads an empty pin as 'any store' and a slug as that chain", async () => {
    await updateItemAction(form({ itemId: ITEM, pin: "" }));
    expect(lists.updateItem).toHaveBeenLastCalledWith(
      expect.anything(),
      DEVICE,
      ITEM,
      expect.objectContaining({ pinnedRetailerSlug: null }),
    );
    await updateItemAction(form({ itemId: ITEM, pin: "albert-heijn" }));
    expect(lists.updateItem).toHaveBeenLastCalledWith(
      expect.anything(),
      DEVICE,
      ITEM,
      expect.objectContaining({ pinnedRetailerSlug: "albert-heijn" }),
    );
  });

  it.each([
    ["quantity 0", { itemId: ITEM, quantity: "0" }],
    ["quantity 100", { itemId: ITEM, quantity: "100" }],
    ["a fractional quantity", { itemId: ITEM, quantity: "1.5" }],
    ["a quantity that is not a number", { itemId: ITEM, quantity: "veel" }],
    ["a tick that is not true or false", { itemId: ITEM, checked: "yes" }],
    ["a pin that is not a slug", { itemId: ITEM, pin: "Jumbo; --" }],
    ["no item", { quantity: "2" }],
  ])("ignores %s", async (_name, values) => {
    await updateItemAction(form(values as Record<string, string>));
    expect(lists.updateItem).not.toHaveBeenCalled();
  });
});

describe("a browser without a device cookie", () => {
  it("cannot change, remove, rename, open, untick or delete anything, and gets no cookie for trying", async () => {
    await updateItemAction(form({ itemId: ITEM, quantity: "2" }));
    await removeItemAction(form({ itemId: ITEM }));
    await selectListAction(form({ listId: ITEM }));
    await uncheckAllAction(form({ listId: ITEM }));
    await deleteListAction(form({ listId: ITEM }));
    expect(await renameListAction(null, form({ listId: ITEM, name: "Nieuw" }))).toEqual({ error: "invalid" });
    for (const call of [
      lists.updateItem,
      lists.removeItem,
      lists.selectList,
      lists.uncheckAll,
      lists.deleteList,
      lists.renameList,
    ]) {
      expect(call).not.toHaveBeenCalled();
    }
    expect(setCookie).not.toHaveBeenCalled();
  });
});

describe("list actions", () => {
  beforeEach(() => void jar.set(DEVICE_COOKIE, DEVICE));

  it("act on the list of the device in the cookie", async () => {
    await removeItemAction(form({ itemId: ITEM }));
    expect(lists.removeItem).toHaveBeenCalledWith(expect.anything(), DEVICE, ITEM);
    await selectListAction(form({ listId: ITEM }));
    expect(lists.selectList).toHaveBeenCalledWith(expect.anything(), DEVICE, ITEM);
    await uncheckAllAction(form({ listId: ITEM }));
    expect(lists.uncheckAll).toHaveBeenCalledWith(expect.anything(), DEVICE, ITEM);
    await deleteListAction(form({ listId: ITEM }));
    expect(lists.deleteList).toHaveBeenCalledWith(expect.anything(), DEVICE, ITEM);
    expect(await renameListAction(null, form({ listId: ITEM, name: " Week 46 " }))).toBeNull();
    expect(lists.renameList).toHaveBeenCalledWith(expect.anything(), DEVICE, ITEM, "Week 46");
    expect(await createListAction(null, form({ name: "Verjaardag" }))).toBeNull();
    expect(lists.createList).toHaveBeenCalledWith(expect.anything(), DEVICE, "Verjaardag");
  });

  it("refuse a name that is empty or too long, and an id that is not an id", async () => {
    expect(await createListAction(null, form({ name: " " }))).toEqual({ error: "invalid" });
    expect(await createListAction(null, form({ name: "x".repeat(41) }))).toEqual({ error: "invalid" });
    expect(await renameListAction(null, form({ listId: ITEM, name: "" }))).toEqual({ error: "invalid" });
    await deleteListAction(form({ listId: "1 OR 1=1" }));
    await removeItemAction(form({}));
    expect(lists.createList).not.toHaveBeenCalled();
    expect(lists.renameList).not.toHaveBeenCalled();
    expect(lists.deleteList).not.toHaveBeenCalled();
    expect(lists.removeItem).not.toHaveBeenCalled();
  });

  it("report a refused create or rename", async () => {
    vi.mocked(lists.createList).mockResolvedValueOnce({ ok: false, reason: "too-many-lists" });
    expect(await createListAction(null, form({ name: "Nog een" }))).toEqual({ error: "too-many-lists" });
    vi.mocked(lists.renameList).mockResolvedValueOnce({ ok: false, reason: "not-found" });
    expect(await renameListAction(null, form({ listId: ITEM, name: "Naam" }))).toEqual({ error: "not-found" });
  });
});

describe("forgetDeviceAction", () => {
  it("deletes what is stored for the device and drops the cookie", async () => {
    jar.set(DEVICE_COOKIE, DEVICE);
    await forgetDeviceAction();
    expect(lists.forgetDevice).toHaveBeenCalledWith(expect.anything(), DEVICE);
    expect(jar.has(DEVICE_COOKIE)).toBe(false);
  });

  it("does nothing to the database when there is no device", async () => {
    await forgetDeviceAction();
    expect(lists.forgetDevice).not.toHaveBeenCalled();
  });
});
