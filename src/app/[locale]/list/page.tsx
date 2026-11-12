import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActionForm } from "@/components/list/action-form";
import { useListErrors } from "@/components/list/add-to-list";
import { PlusIcon } from "@/components/list/icons";
import { ListItems } from "@/components/list/list-items";
import { ListManager } from "@/components/list/list-manager";
import { PageHeader } from "@/components/shell/page-header";
import { buttonClass, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { db } from "@/lib/db";
import { readDeviceId } from "@/server/device";
import { addToListAction, uncheckAllAction } from "@/server/list-actions";
import { getList, LIST_LIMITS, listsOf, pinnableRetailers } from "@/server/lists";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "list" });
  return { title: t("title") };
}

/** Free text: something to buy that was not picked from a result ("tahin"). */
function AddItemForm({
  locale,
  label,
  placeholder,
  submit,
}: {
  locale: string;
  label: string;
  placeholder: string;
  submit: string;
}) {
  return (
    <ActionForm action={addToListAction} errors={useListErrors()} className="flex flex-col gap-1.5">
      <label htmlFor="new-item" className="text-label text-muted">
        {label}
      </label>
      <input type="hidden" name="locale" value={locale} />
      <div className="flex gap-2">
        <input
          id="new-item"
          name="label"
          required
          maxLength={LIST_LIMITS.labelLength}
          autoComplete="off"
          enterKeyHint="done"
          placeholder={placeholder}
          className="h-12 min-w-0 grow rounded-card border border-line bg-surface px-4 text-input text-text placeholder:text-muted"
        />
        <button
          type="submit"
          aria-label={submit}
          className="flex size-12 shrink-0 items-center justify-center rounded-card bg-accent text-on-accent transition-transform duration-(--duration-press) ease-route active:scale-[0.97]"
        >
          <PlusIcon size={20} />
        </button>
      </div>
    </ActionForm>
  );
}

export default async function ListPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("list");
  const deviceId = await readDeviceId();
  const [list, lists, retailers] = deviceId
    ? await Promise.all([getList(db, deviceId), listsOf(db, deviceId), pinnableRetailers(db)])
    : [null, [], []];
  const items = list?.items ?? [];
  const checked = items.filter((item) => item.checked).length;

  return (
    <>
      <PageHeader
        title={t("title")}
        eyebrow={
          list
            ? [
                list.name,
                t("count", { count: items.length }),
                checked > 0 ? t("checkedCount", { count: checked }) : null,
              ]
                .filter(Boolean)
                .join(" · ")
            : undefined
        }
      />
      <AddItemForm locale={locale} label={t("addLabel")} placeholder={t("addPlaceholder")} submit={t("addSubmit")} />

      {items.length === 0 ? (
        <EmptyState
          title={t("emptyTitle")}
          body={t("emptyBody")}
          action={
            <div className="flex flex-wrap gap-2">
              <ButtonLink href="/search" variant="secondary">
                {t("toSearch")}
              </ButtonLink>
              <ButtonLink href="/offers" variant="secondary">
                {t("toOffers")}
              </ButtonLink>
            </div>
          }
        />
      ) : (
        <ListItems items={items} retailers={retailers} />
      )}

      {items.length > checked && <ButtonLink href="/plan">{t("toPlan")}</ButtonLink>}

      {list && checked > 0 && (
        <form action={uncheckAllAction}>
          <input type="hidden" name="listId" value={list.id} />
          <button type="submit" className={buttonClass("secondary", "w-full")}>
            {t("uncheckAll")}
          </button>
        </form>
      )}

      {lists.length > 0 && <ListManager current={list} lists={lists} />}
    </>
  );
}
