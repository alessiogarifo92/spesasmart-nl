import type { PrismaClient } from "@/generated/prisma/client";
import { fail, ok, type Result } from "@/domain/pricing";
import { normalizeName } from "@/domain/search";

/**
 * Shopping lists. A list belongs to a device (a random id in a cookie), not to an
 * account, so every function takes the device id and never reads or changes a row
 * of another device: an id that is not yours behaves exactly like one that does not exist.
 */

/**
 * Ceilings that keep one device from filling the database. A device is only a cookie, so
 * `totalLists` is the one ceiling that holds against a script that never sends it back:
 * past it nobody can start a new list until old ones are removed.
 */
export const LIST_LIMITS = {
  lists: 20,
  items: 100,
  nameLength: 40,
  labelLength: 80,
  quantity: 99,
  totalLists: 20_000,
} as const;

export type ListSummary = { id: string; name: string; itemCount: number };

export type ListItemView = {
  id: string;
  /** What the shopper typed, or the product's name when it was added from a result. */
  label: string;
  quantity: number;
  checked: boolean;
  /** The chain's listing this item points at; null for a free-text item. */
  product: { id: string; name: string; retailer: { slug: string; name: string } } | null;
  /** "Always buy this at this chain". */
  pinnedRetailer: { slug: string; name: string } | null;
};

export type ListView = { id: string; name: string; items: ListItemView[] };

export type ListError = "not-found" | "invalid" | "too-many-lists" | "too-many-items" | "full";

const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A device id is a lower-case UUID; anything else is treated as no device at all. */
export function isDeviceId(value: unknown): value is string {
  return typeof value === "string" && DEVICE_ID.test(value);
}

function cleanText(value: string, maxLength: number): string | null {
  const text = value.replace(/\s+/g, " ").trim();
  return text === "" || text.length > maxLength ? null : text;
}

function validQuantity(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= LIST_LIMITS.quantity;
}

const touch = (db: PrismaClient, listId: string) =>
  db.shoppingList.update({ where: { id: listId }, data: { updatedAt: new Date() } });

/** The device's lists, the one used last first. */
export async function listsOf(db: PrismaClient, deviceId: string): Promise<ListSummary[]> {
  const rows = await db.shoppingList.findMany({
    where: { deviceId },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    select: { id: true, name: true, _count: { select: { items: true } } },
  });
  return rows.map((row) => ({ id: row.id, name: row.name, itemCount: row._count.items }));
}

/** One list with its items in the order they were added. Without an id: the list used last. */
export async function getList(db: PrismaClient, deviceId: string, listId?: string): Promise<ListView | null> {
  const row = await db.shoppingList.findFirst({
    where: { deviceId, ...(listId ? { id: listId } : {}) },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      items: {
        orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          label: true,
          quantity: true,
          checked: true,
          product: { select: { id: true, name: true, retailer: { select: { slug: true, name: true } } } },
          pinnedRetailer: { select: { slug: true, name: true } },
        },
      },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    items: row.items.map((item) => ({
      id: item.id,
      label: item.label,
      quantity: item.quantity,
      checked: item.checked,
      product: item.product?.retailer
        ? { id: item.product.id, name: item.product.name, retailer: item.product.retailer }
        : null,
      pinnedRetailer: item.pinnedRetailer,
    })),
  };
}

export async function createList(
  db: PrismaClient,
  deviceId: string,
  name: string,
  totalLists: number = LIST_LIMITS.totalLists,
): Promise<Result<{ id: string }, ListError>> {
  const clean = cleanText(name, LIST_LIMITS.nameLength);
  if (clean === null) return fail("invalid");
  if ((await db.shoppingList.count({ where: { deviceId } })) >= LIST_LIMITS.lists) return fail("too-many-lists");
  if ((await db.shoppingList.count()) >= totalLists) return fail("full");
  const list = await db.shoppingList.create({ data: { deviceId, name: clean }, select: { id: true } });
  return ok(list);
}

export async function renameList(
  db: PrismaClient,
  deviceId: string,
  listId: string,
  name: string,
): Promise<Result<null, ListError>> {
  const clean = cleanText(name, LIST_LIMITS.nameLength);
  if (clean === null) return fail("invalid");
  const { count } = await db.shoppingList.updateMany({ where: { id: listId, deviceId }, data: { name: clean } });
  return count === 0 ? fail("not-found") : ok(null);
}

export async function deleteList(db: PrismaClient, deviceId: string, listId: string): Promise<Result<null, ListError>> {
  const { count } = await db.shoppingList.deleteMany({ where: { id: listId, deviceId } });
  return count === 0 ? fail("not-found") : ok(null);
}

export type NewItem = {
  /** The list to add to; without it the list used last, created with `defaultListName` when there is none. */
  listId?: string;
  defaultListName: string;
  /** A product picked from a result, or free text; exactly one of the two. */
  productId?: string;
  label?: string;
  quantity?: number;
};

/**
 * Adds an item. Adding what is already on the list (the same product, or the same
 * text) raises its quantity instead of writing a second line.
 */
export async function addItem(
  db: PrismaClient,
  deviceId: string,
  input: NewItem,
): Promise<Result<{ listId: string; itemId: string; quantity: number }, ListError>> {
  const quantity = input.quantity ?? 1;
  if (!validQuantity(quantity) || (input.productId === undefined) === (input.label === undefined))
    return fail("invalid");

  let label: string | null;
  if (input.productId !== undefined) {
    const product = await db.product.findFirst({
      where: { id: input.productId, retailer: { active: true } },
      select: { name: true },
    });
    if (!product) return fail("not-found");
    label = cleanText(product.name, 500);
  } else {
    label = cleanText(input.label!, LIST_LIMITS.labelLength);
  }
  if (label === null) return fail("invalid");

  let listId = input.listId;
  if (listId !== undefined) {
    if (!(await db.shoppingList.findFirst({ where: { id: listId, deviceId }, select: { id: true } })))
      return fail("not-found");
  } else {
    const latest = await db.shoppingList.findFirst({
      where: { deviceId },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      select: { id: true },
    });
    if (latest) listId = latest.id;
    else {
      const created = await createList(db, deviceId, input.defaultListName);
      if (!created.ok) return created;
      listId = created.value.id;
    }
  }

  const items = await db.shoppingListItem.findMany({
    where: { listId },
    select: { id: true, label: true, productId: true, quantity: true, position: true },
  });
  const same = items.find((item) =>
    input.productId !== undefined
      ? item.productId === input.productId
      : item.productId === null && normalizeName(item.label) === normalizeName(label),
  );
  if (same) {
    const raised = Math.min(same.quantity + quantity, LIST_LIMITS.quantity);
    await db.shoppingListItem.update({ where: { id: same.id }, data: { quantity: raised, checked: false } });
    await touch(db, listId);
    return ok({ listId, itemId: same.id, quantity: raised });
  }
  if (items.length >= LIST_LIMITS.items) return fail("too-many-items");

  const item = await db.shoppingListItem.create({
    data: {
      listId,
      label,
      productId: input.productId ?? null,
      quantity,
      position: Math.max(-1, ...items.map((existing) => existing.position)) + 1,
    },
    select: { id: true },
  });
  await touch(db, listId);
  return ok({ listId, itemId: item.id, quantity });
}

export type ItemChange = {
  quantity?: number;
  checked?: boolean;
  /** A chain's slug to pin the item to it; null to remove the pin. */
  pinnedRetailerSlug?: string | null;
};

export async function updateItem(
  db: PrismaClient,
  deviceId: string,
  itemId: string,
  change: ItemChange,
): Promise<Result<null, ListError>> {
  if (change.quantity !== undefined && !validQuantity(change.quantity)) return fail("invalid");
  const item = await db.shoppingListItem.findFirst({
    where: { id: itemId, list: { deviceId } },
    select: { id: true, listId: true },
  });
  if (!item) return fail("not-found");

  let pinnedRetailerId: string | null | undefined;
  if (change.pinnedRetailerSlug === null) pinnedRetailerId = null;
  else if (change.pinnedRetailerSlug !== undefined) {
    const retailer = await db.retailer.findFirst({
      where: { slug: change.pinnedRetailerSlug, active: true },
      select: { id: true },
    });
    if (!retailer) return fail("invalid");
    pinnedRetailerId = retailer.id;
  }

  await db.shoppingListItem.update({
    where: { id: item.id },
    data: {
      ...(change.quantity !== undefined ? { quantity: change.quantity } : {}),
      ...(change.checked !== undefined ? { checked: change.checked } : {}),
      ...(pinnedRetailerId !== undefined ? { pinnedRetailerId } : {}),
    },
  });
  await touch(db, item.listId);
  return ok(null);
}

export async function removeItem(db: PrismaClient, deviceId: string, itemId: string): Promise<Result<null, ListError>> {
  const item = await db.shoppingListItem.findFirst({
    where: { id: itemId, list: { deviceId } },
    select: { id: true, listId: true },
  });
  if (!item) return fail("not-found");
  await db.shoppingListItem.delete({ where: { id: item.id } });
  await touch(db, item.listId);
  return ok(null);
}

/** Unticks every item, so last week's list can be used again. */
export async function uncheckAll(db: PrismaClient, deviceId: string, listId: string): Promise<Result<null, ListError>> {
  if (!(await db.shoppingList.findFirst({ where: { id: listId, deviceId }, select: { id: true } })))
    return fail("not-found");
  await db.shoppingListItem.updateMany({ where: { listId }, data: { checked: false } });
  await touch(db, listId);
  return ok(null);
}

/** Chains an item can be pinned to. */
export function pinnableRetailers(db: PrismaClient): Promise<{ slug: string; name: string }[]> {
  return db.retailer.findMany({
    where: { active: true },
    select: { slug: true, name: true },
    orderBy: { name: "asc" },
  });
}

/** Makes a list the current one: "current" is simply the list used last. */
export async function selectList(db: PrismaClient, deviceId: string, listId: string): Promise<Result<null, ListError>> {
  const { count } = await db.shoppingList.updateMany({
    where: { id: listId, deviceId },
    data: { updatedAt: new Date() },
  });
  return count === 0 ? fail("not-found") : ok(null);
}

/** How many of each product are on the device's current list, for the "on your list" mark on a card. */
export async function listedQuantities(db: PrismaClient, deviceId: string | null): Promise<Map<string, number>> {
  if (deviceId === null) return new Map();
  const list = await db.shoppingList.findFirst({
    where: { deviceId },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    select: { items: { where: { productId: { not: null } }, select: { productId: true, quantity: true } } },
  });
  return new Map((list?.items ?? []).map((item) => [item.productId!, item.quantity]));
}

/** Deletes everything stored for a device: its lists with their items, and its favourites. Feedback loses the link to it. */
export async function forgetDevice(db: PrismaClient, deviceId: string): Promise<void> {
  await db.$transaction([
    db.shoppingList.deleteMany({ where: { deviceId } }),
    db.favorite.deleteMany({ where: { deviceId } }),
    db.feedback.updateMany({ where: { deviceId }, data: { deviceId: null } }),
  ]);
}
