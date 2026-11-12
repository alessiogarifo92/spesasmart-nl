import { useLocale, useTranslations } from "next-intl";
import { addToListAction } from "@/server/list-actions";
import { ActionForm } from "./action-form";
import { PlusIcon } from "./icons";

export function useListErrors() {
  const t = useTranslations("list");
  return {
    invalid: t("errorInvalid"),
    "not-found": t("errorNotFound"),
    "too-many-items": t("errorTooManyItems"),
    "too-many-lists": t("errorTooManyLists"),
  };
}

/** The "add to list" button on a product or an offer; `quantity` is how many are on the list already. */
export function AddToList({ productId, name, quantity }: { productId: string; name: string; quantity: number }) {
  const t = useTranslations("list");
  const locale = useLocale();
  return (
    <ActionForm
      action={addToListAction}
      errors={useListErrors()}
      className="flex flex-wrap items-center gap-x-3 gap-y-1"
    >
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="locale" value={locale} />
      <button
        type="submit"
        aria-label={t("addNamed", { name })}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-pill border border-line px-3.5 text-[13px] leading-5 font-semibold text-text transition-transform duration-(--duration-press) ease-route active:scale-[0.97]"
      >
        <PlusIcon size={16} />
        {t("addToList")}
      </button>
      {quantity > 0 && (
        <span className="text-label font-semibold text-accent" data-testid="on-list">
          {t("onList", { quantity })}
        </span>
      )}
    </ActionForm>
  );
}
