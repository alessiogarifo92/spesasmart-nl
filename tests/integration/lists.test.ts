import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  addItem,
  createList,
  deleteList,
  getList,
  isDeviceId,
  LIST_LIMITS,
  listsOf,
  removeItem,
  renameList,
  uncheckAll,
  updateItem,
} from "@/server/lists";
import { createScratchRetailer } from "./support";

const devices: string[] = [];
function device(): string {
  const id = randomUUID();
  devices.push(id);
  return id;
}
const defaults = { defaultListName: "Boodschappen" };

let retailer: Awaited<ReturnType<typeof createScratchRetailer>>;
let productId: string;
let otherProductId: string;

describe("shopping lists", () => {
  beforeAll(async () => {
    retailer = await createScratchRetailer("lists");
    const make = (name: string) =>
      db.product.create({
        data: { retailerId: retailer.id, externalId: name, name, normalizedName: name.toLowerCase() },
      });
    productId = (await make("Kipfilet 500 g")).id;
    otherProductId = (await make("Halfvolle melk 1 L")).id;
  });

  afterAll(async () => {
    await db.shoppingList.deleteMany({ where: { deviceId: { in: devices } } });
    await retailer.remove();
  });

  it("recognises a device id and nothing else", () => {
    expect(isDeviceId(randomUUID())).toBe(true);
    expect(isDeviceId("")).toBe(false);
    expect(isDeviceId("abc")).toBe(false);
    expect(isDeviceId(randomUUID().toUpperCase())).toBe(false);
    expect(isDeviceId(`${randomUUID()}'; DROP TABLE`)).toBe(false);
    expect(isDeviceId(undefined)).toBe(false);
  });

  it("creates the first list when the first item is added", async () => {
    const me = device();
    expect(await getList(db, me)).toBeNull();
    const added = await addItem(db, me, { ...defaults, label: "  tahin   pot " });
    expect(added).toMatchObject({ ok: true, value: { quantity: 1 } });
    const list = await getList(db, me);
    expect(list).toMatchObject({
      name: "Boodschappen",
      items: [{ label: "tahin pot", quantity: 1, checked: false, product: null, pinnedRetailer: null }],
    });
  });

  it("links an item to the product it was added from", async () => {
    const me = device();
    await addItem(db, me, { ...defaults, productId, quantity: 2 });
    const list = await getList(db, me);
    expect(list?.items).toMatchObject([
      { label: "Kipfilet 500 g", quantity: 2, product: { id: productId, name: "Kipfilet 500 g" } },
    ]);
  });

  it("raises the quantity instead of adding the same thing twice", async () => {
    const me = device();
    await addItem(db, me, { ...defaults, productId });
    const again = await addItem(db, me, { ...defaults, productId, quantity: 2 });
    expect(again).toMatchObject({ ok: true, value: { quantity: 3 } });
    await addItem(db, me, { ...defaults, label: "Tahin" });
    await addItem(db, me, { ...defaults, label: "  tahin " });
    await addItem(db, me, { ...defaults, productId: otherProductId });
    const list = await getList(db, me);
    expect(list?.items.map((item) => [item.label, item.quantity])).toEqual([
      ["Kipfilet 500 g", 3],
      ["Tahin", 2],
      ["Halfvolle melk 1 L", 1],
    ]);
  });

  it("unticks an item that is added again", async () => {
    const me = device();
    const first = await addItem(db, me, { ...defaults, label: "brood" });
    if (!first.ok) throw new Error("setup");
    await updateItem(db, me, first.value.itemId, { checked: true });
    await addItem(db, me, { ...defaults, label: "brood" });
    expect((await getList(db, me))?.items[0]).toMatchObject({ quantity: 2, checked: false });
  });

  it("caps the quantity", async () => {
    const me = device();
    await addItem(db, me, { ...defaults, label: "water", quantity: 98 });
    expect(await addItem(db, me, { ...defaults, label: "water", quantity: 5 })).toMatchObject({
      ok: true,
      value: { quantity: 99 },
    });
  });

  it("refuses invalid input", async () => {
    const me = device();
    expect(await addItem(db, me, { ...defaults, label: "   " })).toEqual({ ok: false, reason: "invalid" });
    expect(await addItem(db, me, { ...defaults, label: "x".repeat(LIST_LIMITS.labelLength + 1) })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await addItem(db, me, { ...defaults, label: "melk", quantity: 0 })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await addItem(db, me, { ...defaults, label: "melk", quantity: 100 })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await addItem(db, me, { ...defaults, label: "melk", quantity: 1.5 })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await addItem(db, me, { ...defaults })).toEqual({ ok: false, reason: "invalid" });
    expect(await addItem(db, me, { ...defaults, label: "melk", productId })).toEqual({ ok: false, reason: "invalid" });
    expect(await addItem(db, me, { ...defaults, productId: "does-not-exist" })).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(await createList(db, me, "")).toEqual({ ok: false, reason: "invalid" });
    expect(await createList(db, me, "x".repeat(LIST_LIMITS.nameLength + 1))).toEqual({ ok: false, reason: "invalid" });
    // Nothing was written by any of these.
    expect(await listsOf(db, me)).toEqual([]);
  });

  it("changes quantity, tick and pin of an item", async () => {
    const me = device();
    const added = await addItem(db, me, { ...defaults, productId });
    if (!added.ok) throw new Error("setup");
    const slug = (await db.retailer.findUniqueOrThrow({ where: { id: retailer.id } })).slug;

    expect(
      await updateItem(db, me, added.value.itemId, { quantity: 4, checked: true, pinnedRetailerSlug: slug }),
    ).toEqual({ ok: true, value: null });
    expect((await getList(db, me))?.items[0]).toMatchObject({ quantity: 4, checked: true, pinnedRetailer: { slug } });

    expect(await updateItem(db, me, added.value.itemId, { pinnedRetailerSlug: null })).toEqual({
      ok: true,
      value: null,
    });
    expect((await getList(db, me))?.items[0]).toMatchObject({ quantity: 4, pinnedRetailer: null });

    expect(await updateItem(db, me, added.value.itemId, { quantity: 0 })).toEqual({ ok: false, reason: "invalid" });
    expect(await updateItem(db, me, added.value.itemId, { pinnedRetailerSlug: "no-such-chain" })).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("removes an item and unticks a whole list", async () => {
    const me = device();
    const a = await addItem(db, me, { ...defaults, label: "a" });
    const b = await addItem(db, me, { ...defaults, label: "b" });
    if (!a.ok || !b.ok) throw new Error("setup");
    await updateItem(db, me, a.value.itemId, { checked: true });
    await updateItem(db, me, b.value.itemId, { checked: true });
    expect(await uncheckAll(db, me, a.value.listId)).toEqual({ ok: true, value: null });
    expect((await getList(db, me))?.items.map((item) => item.checked)).toEqual([false, false]);
    expect(await removeItem(db, me, a.value.itemId)).toEqual({ ok: true, value: null });
    expect((await getList(db, me))?.items.map((item) => item.label)).toEqual(["b"]);
    expect(await removeItem(db, me, a.value.itemId)).toEqual({ ok: false, reason: "not-found" });
  });

  it("keeps several named lists and opens the one used last", async () => {
    const me = device();
    const week = await createList(db, me, "Weekboodschappen");
    const party = await createList(db, me, "Feest");
    if (!week.ok || !party.ok) throw new Error("setup");
    await addItem(db, me, { ...defaults, listId: week.value.id, label: "melk" });
    expect((await getList(db, me))?.name).toBe("Weekboodschappen");
    expect((await getList(db, me, party.value.id))?.name).toBe("Feest");
    expect(await listsOf(db, me)).toEqual([
      { id: week.value.id, name: "Weekboodschappen", itemCount: 1 },
      { id: party.value.id, name: "Feest", itemCount: 0 },
    ]);

    expect(await renameList(db, me, party.value.id, "Verjaardag")).toEqual({ ok: true, value: null });
    expect(await deleteList(db, me, week.value.id)).toEqual({ ok: true, value: null });
    expect(await listsOf(db, me)).toEqual([{ id: party.value.id, name: "Verjaardag", itemCount: 0 }]);
    // Deleting a list takes its items with it.
    expect(await db.shoppingListItem.count({ where: { listId: week.value.id } })).toBe(0);
  });

  it("never lets one device read or change another device's list", async () => {
    const owner = device();
    const stranger = device();
    const added = await addItem(db, owner, { ...defaults, label: "geheim" });
    if (!added.ok) throw new Error("setup");
    const { listId, itemId } = added.value;

    expect(await getList(db, stranger, listId)).toBeNull();
    expect(await listsOf(db, stranger)).toEqual([]);
    expect(await addItem(db, stranger, { ...defaults, listId, label: "inbraak" })).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(await updateItem(db, stranger, itemId, { quantity: 9 })).toEqual({ ok: false, reason: "not-found" });
    expect(await removeItem(db, stranger, itemId)).toEqual({ ok: false, reason: "not-found" });
    expect(await renameList(db, stranger, listId, "van mij")).toEqual({ ok: false, reason: "not-found" });
    expect(await uncheckAll(db, stranger, listId)).toEqual({ ok: false, reason: "not-found" });
    expect(await deleteList(db, stranger, listId)).toEqual({ ok: false, reason: "not-found" });

    expect(await getList(db, owner)).toMatchObject({ name: "Boodschappen", items: [{ label: "geheim", quantity: 1 }] });
    // The failed attempt did not leave a list behind for the stranger either.
    expect(await listsOf(db, stranger)).toEqual([]);
  });

  it("stops at the list and item limits", async () => {
    const me = device();
    for (let index = 0; index < LIST_LIMITS.lists; index++) await createList(db, me, `Lijst ${index}`);
    expect(await createList(db, me, "Eén te veel")).toEqual({ ok: false, reason: "too-many-lists" });

    const full = device();
    const list = await createList(db, full, "Vol");
    if (!list.ok) throw new Error("setup");
    await db.shoppingListItem.createMany({
      data: Array.from({ length: LIST_LIMITS.items }, (_, index) => ({
        listId: list.value.id,
        label: `item ${index}`,
        position: index,
      })),
    });
    expect(await addItem(db, full, { ...defaults, label: "nog een" })).toEqual({ ok: false, reason: "too-many-items" });
    // Raising the quantity of something already on a full list still works.
    expect(await addItem(db, full, { ...defaults, label: "item 3" })).toMatchObject({
      ok: true,
      value: { quantity: 2 },
    });
  });

  it("keeps the item as free text when its product disappears", async () => {
    const me = device();
    const gone = await db.product.create({
      data: {
        retailerId: retailer.id,
        externalId: "tijdelijk",
        name: "Tijdelijk product",
        normalizedName: "tijdelijk product",
      },
    });
    await addItem(db, me, { ...defaults, productId: gone.id });
    await db.product.delete({ where: { id: gone.id } });
    expect((await getList(db, me))?.items).toMatchObject([{ label: "Tijdelijk product", product: null }]);
  });
});
