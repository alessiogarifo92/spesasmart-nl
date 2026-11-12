import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { removeItemAction, updateItemAction } from "@/server/list-actions";
import type { ListItemView } from "@/server/lists";
import { CheckIcon, ChevronIcon, MinusIcon, PlusIcon } from "./icons";

type Retailer = { slug: string; name: string };

const stepClass =
  "flex size-11 items-center justify-center rounded-card text-text transition-transform duration-(--duration-press) ease-route " +
  "active:scale-[0.97] disabled:text-line disabled:active:scale-100";

const pinClass = (selected: boolean) =>
  cn(
    "inline-flex min-h-11 items-center justify-center rounded-pill border px-3.5 text-[13px] leading-5 font-semibold",
    selected ? "border-accent text-accent" : "border-line text-text",
  );

/** One line of the list: tick, name, quantity; the chain it is pinned to and "remove" sit behind the second line. */
function ListItemRow({ item, retailers }: { item: ListItemView; retailers: Retailer[] }) {
  const t = useTranslations("list");
  const pinned = item.pinnedRetailer;
  return (
    <li className="flex flex-col px-1.5 py-1" data-testid="list-item" data-checked={item.checked || undefined}>
      <div className="flex items-center gap-1">
        <form action={updateItemAction}>
          <input type="hidden" name="itemId" value={item.id} />
          <input type="hidden" name="checked" value={String(!item.checked)} />
          <button
            type="submit"
            aria-pressed={item.checked}
            aria-label={t("check", { item: item.label })}
            className="flex size-11 items-center justify-center"
          >
            <span
              className={cn(
                "flex size-6 items-center justify-center rounded-md border-2",
                item.checked ? "border-accent bg-accent text-on-accent" : "border-muted text-transparent",
              )}
            >
              <CheckIcon size={16} />
            </span>
          </button>
        </form>

        <span
          className={cn(
            "min-w-0 grow text-body font-semibold wrap-break-word",
            item.checked && "text-muted line-through",
          )}
        >
          {item.label}
        </span>

        <form action={updateItemAction} className="flex shrink-0 items-center">
          <input type="hidden" name="itemId" value={item.id} />
          <button
            type="submit"
            name="quantity"
            value={item.quantity - 1}
            disabled={item.quantity <= 1}
            aria-label={t("decrease", { item: item.label })}
            className={stepClass}
          >
            <MinusIcon />
          </button>
          <span
            aria-label={t("quantity", { quantity: item.quantity })}
            className="min-w-6 text-center font-display text-[16px] leading-6 font-semibold"
            data-testid="item-quantity"
          >
            {item.quantity}
          </span>
          <button
            type="submit"
            name="quantity"
            value={item.quantity + 1}
            disabled={item.quantity >= 99}
            aria-label={t("increase", { item: item.label })}
            className={stepClass}
          >
            <PlusIcon />
          </button>
        </form>
      </div>

      <details className="group -mt-2 pl-12">
        <summary
          className={cn(
            "flex min-h-11 cursor-pointer list-none items-center gap-1 text-label [&::-webkit-details-marker]:hidden",
            pinned ? "font-semibold text-accent" : "text-muted",
          )}
        >
          {pinned ? t("pinnedTo", { retailer: pinned.name }) : t("anyStore")}
          <ChevronIcon size={14} className="transition-transform duration-(--duration-press) group-open:rotate-180" />
        </summary>
        <div className="flex flex-col items-start gap-2 pb-2">
          <span className="text-label text-muted" id={`pin-${item.id}`}>
            {t("pinTitle")}
          </span>
          <form
            action={updateItemAction}
            role="group"
            aria-labelledby={`pin-${item.id}`}
            className="flex flex-wrap gap-2"
          >
            <input type="hidden" name="itemId" value={item.id} />
            <button type="submit" name="pin" value="" aria-pressed={!pinned} className={pinClass(!pinned)}>
              {t("anyStore")}
            </button>
            {retailers.map((retailer) => (
              <button
                key={retailer.slug}
                type="submit"
                name="pin"
                value={retailer.slug}
                aria-pressed={pinned?.slug === retailer.slug}
                className={pinClass(pinned?.slug === retailer.slug)}
              >
                {retailer.name}
              </button>
            ))}
          </form>
          <form action={removeItemAction}>
            <input type="hidden" name="itemId" value={item.id} />
            <button
              type="submit"
              aria-label={t("removeNamed", { item: item.label })}
              className="inline-flex min-h-11 items-center text-[13px] leading-5 font-semibold text-warn underline"
            >
              {t("remove")}
            </button>
          </form>
        </div>
      </details>
    </li>
  );
}

export function ListItems({ items, retailers }: { items: ListItemView[]; retailers: Retailer[] }) {
  const t = useTranslations("list");
  return (
    <ul
      aria-label={t("itemsLabel")}
      className="m-0 flex list-none flex-col divide-y divide-line rounded-card bg-surface p-0"
    >
      {items.map((item) => (
        <ListItemRow key={item.id} item={item} retailers={retailers} />
      ))}
    </ul>
  );
}
