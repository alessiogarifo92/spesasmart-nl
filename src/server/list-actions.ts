"use server";

import { revalidatePath } from "next/cache";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { routing } from "@/i18n/routing";
import { db } from "@/lib/db";
import { clearDeviceId, ensureDeviceId, readDeviceId } from "./device";
import {
  addItem,
  createList,
  deleteList,
  forgetDevice,
  LIST_LIMITS,
  removeItem,
  renameList,
  selectList,
  uncheckAll,
  updateItem,
  type ListError,
} from "./lists";

/**
 * Server Functions behind the list forms. Each one is a public POST endpoint, so
 * each validates its own input and acts only on rows of the device in the cookie.
 */

/** What a form shows after a failed submit; null when there is nothing to say. */
export type ActionState = { error: ListError } | null;

const id = z.string().regex(/^[a-z0-9]{8,40}$/);
const text = (max: number) => z.string().trim().min(1).max(max);
const quantity = z.coerce.number().int().min(1).max(LIST_LIMITS.quantity);
const locale = z.string().refine((value) => hasLocale(routing.locales, value));

/** Named form fields as a plain object; a missing field is undefined, a file never passes as text. */
function fields(formData: FormData, names: string[]): Record<string, unknown> {
  return Object.fromEntries(names.map((name) => [name, formData.get(name) ?? undefined]));
}

/** Every page shows list state (the list itself, the "on your list" marks), so all of them are refreshed. */
const changed = () => revalidatePath("/", "layout");

const addSchema = z
  .object({ productId: id.optional(), label: text(LIST_LIMITS.labelLength).optional(), locale })
  .refine((value) => (value.productId === undefined) !== (value.label === undefined));

/** Adds a product (from a result or an offer) or a free-text item to the current list. */
export async function addToListAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = addSchema.safeParse(fields(formData, ["productId", "label", "locale"]));
  if (!parsed.success) return { error: "invalid" };
  const t = await getTranslations({ locale: parsed.data.locale, namespace: "list" });
  const result = await addItem(db, await ensureDeviceId(), {
    defaultListName: t("defaultName"),
    productId: parsed.data.productId,
    label: parsed.data.label,
  });
  if (!result.ok) return { error: result.reason };
  changed();
  return null;
}

const updateSchema = z.object({
  itemId: id,
  quantity: quantity.optional(),
  checked: z.enum(["true", "false"]).optional(),
  /** A chain's slug, or the empty string for "any store". */
  pin: z
    .string()
    .regex(/^[a-z0-9-]{0,80}$/)
    .optional(),
});

export async function updateItemAction(formData: FormData): Promise<void> {
  const parsed = updateSchema.safeParse(fields(formData, ["itemId", "quantity", "checked", "pin"]));
  const deviceId = await readDeviceId();
  if (!parsed.success || deviceId === null) return;
  const { itemId, checked, pin } = parsed.data;
  await updateItem(db, deviceId, itemId, {
    quantity: parsed.data.quantity,
    checked: checked === undefined ? undefined : checked === "true",
    pinnedRetailerSlug: pin === undefined ? undefined : pin === "" ? null : pin,
  });
  changed();
}

export async function removeItemAction(formData: FormData): Promise<void> {
  const parsed = z.object({ itemId: id }).safeParse(fields(formData, ["itemId"]));
  const deviceId = await readDeviceId();
  if (!parsed.success || deviceId === null) return;
  await removeItem(db, deviceId, parsed.data.itemId);
  changed();
}

export async function createListAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ name: text(LIST_LIMITS.nameLength) }).safeParse(fields(formData, ["name"]));
  if (!parsed.success) return { error: "invalid" };
  const result = await createList(db, await ensureDeviceId(), parsed.data.name);
  if (!result.ok) return { error: result.reason };
  changed();
  return null;
}

export async function renameListAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({ listId: id, name: text(LIST_LIMITS.nameLength) })
    .safeParse(fields(formData, ["listId", "name"]));
  const deviceId = await readDeviceId();
  if (!parsed.success || deviceId === null) return { error: "invalid" };
  const result = await renameList(db, deviceId, parsed.data.listId, parsed.data.name);
  if (!result.ok) return { error: result.reason };
  changed();
  return null;
}

/** The three list-wide buttons: open another list, untick everything, delete the list. */
async function onList(formData: FormData, run: (deviceId: string, listId: string) => Promise<unknown>): Promise<void> {
  const parsed = z.object({ listId: id }).safeParse(fields(formData, ["listId"]));
  const deviceId = await readDeviceId();
  if (!parsed.success || deviceId === null) return;
  await run(deviceId, parsed.data.listId);
  changed();
}

export async function selectListAction(formData: FormData): Promise<void> {
  await onList(formData, (deviceId, listId) => selectList(db, deviceId, listId));
}

export async function uncheckAllAction(formData: FormData): Promise<void> {
  await onList(formData, (deviceId, listId) => uncheckAll(db, deviceId, listId));
}

export async function deleteListAction(formData: FormData): Promise<void> {
  await onList(formData, (deviceId, listId) => deleteList(db, deviceId, listId));
}

/** "Delete my data": removes everything stored for this device and the cookie that pointed at it. */
export async function forgetDeviceAction(): Promise<void> {
  const deviceId = await readDeviceId();
  if (deviceId !== null) await forgetDevice(db, deviceId);
  await clearDeviceId();
  changed();
}
