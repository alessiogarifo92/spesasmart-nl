import { useTranslations } from "next-intl";
import { buttonClass } from "@/components/ui/button";
import { createListAction, deleteListAction, renameListAction, selectListAction } from "@/server/list-actions";
import { LIST_LIMITS, type ListSummary } from "@/server/lists";
import { ActionForm } from "./action-form";
import { useListErrors } from "./add-to-list";
import { ChevronIcon } from "./icons";

const fieldClass =
  "h-12 min-w-0 grow rounded-card border border-line bg-bg px-4 text-input text-text placeholder:text-muted";

/** Saved lists: open another one, start a new one, rename or delete the current one. */
export function ListManager({
  current,
  lists,
}: {
  current: { id: string; name: string } | null;
  lists: ListSummary[];
}) {
  const t = useTranslations("list");
  const errors = useListErrors();
  const others = lists.filter((list) => list.id !== current?.id);
  return (
    <details className="group rounded-card border border-line bg-surface" data-testid="list-manager">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 font-display text-body font-semibold [&::-webkit-details-marker]:hidden">
        {t("manage", { count: lists.length })}
        <ChevronIcon className="transition-transform duration-(--duration-press) group-open:rotate-180" />
      </summary>
      <div className="flex flex-col gap-4 px-4 pb-4">
        {others.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-label text-muted">{t("otherLists")}</span>
            {others.map((list) => (
              <form key={list.id} action={selectListAction}>
                <input type="hidden" name="listId" value={list.id} />
                <button
                  type="submit"
                  className="flex min-h-11 w-full items-center justify-between gap-3 rounded-card border border-line bg-bg px-4 text-left text-body font-semibold text-text"
                >
                  <span className="min-w-0 truncate">{list.name}</span>
                  <span className="shrink-0 text-label font-normal text-muted">
                    {t("count", { count: list.itemCount })}
                  </span>
                </button>
              </form>
            ))}
          </div>
        )}

        <ActionForm action={createListAction} errors={errors} className="flex flex-col gap-1.5">
          <label htmlFor="new-list" className="text-label text-muted">
            {t("newListLabel")}
          </label>
          <div className="flex gap-2">
            <input
              id="new-list"
              name="name"
              required
              maxLength={LIST_LIMITS.nameLength}
              autoComplete="off"
              placeholder={t("newListPlaceholder")}
              className={fieldClass}
            />
            <button type="submit" className={buttonClass("secondary", "min-h-12 shrink-0 bg-bg")}>
              {t("create")}
            </button>
          </div>
        </ActionForm>

        {current && (
          <>
            <ActionForm action={renameListAction} errors={errors} className="flex flex-col gap-1.5">
              <input type="hidden" name="listId" value={current.id} />
              <label htmlFor="rename-list" className="text-label text-muted">
                {t("renameLabel")}
              </label>
              <div className="flex gap-2">
                <input
                  key={current.name}
                  id="rename-list"
                  name="name"
                  required
                  maxLength={LIST_LIMITS.nameLength}
                  autoComplete="off"
                  defaultValue={current.name}
                  className={fieldClass}
                />
                <button type="submit" className={buttonClass("secondary", "min-h-12 shrink-0 bg-bg")}>
                  {t("rename")}
                </button>
              </div>
            </ActionForm>

            <details>
              <summary className="flex min-h-11 cursor-pointer list-none items-center text-[13px] leading-5 font-semibold text-warn underline [&::-webkit-details-marker]:hidden">
                {t("deleteList")}
              </summary>
              <form action={deleteListAction} className="pt-1">
                <input type="hidden" name="listId" value={current.id} />
                <button type="submit" className={buttonClass("warn", "w-full")}>
                  {t("deleteConfirm", { name: current.name })}
                </button>
              </form>
            </details>
          </>
        )}
      </div>
    </details>
  );
}
