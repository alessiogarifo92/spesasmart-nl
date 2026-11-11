import { useLocale } from "next-intl";
import { getPathname } from "@/i18n/navigation";

type Props = { label: string; placeholder: string; submitLabel: string; defaultValue?: string };

/** A plain GET form to the search page: works without JavaScript. */
export function SearchField({ label, placeholder, submitLabel, defaultValue }: Props) {
  const locale = useLocale();
  return (
    <form action={getPathname({ href: "/search", locale })} role="search" className="flex flex-col gap-1.5">
      <label htmlFor="q" className="text-label text-muted">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id="q"
          name="q"
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          defaultValue={defaultValue}
          placeholder={placeholder}
          className="h-12 min-w-0 grow rounded-card border border-line bg-surface px-4 text-input text-text placeholder:text-muted"
        />
        <button
          type="submit"
          aria-label={submitLabel}
          className="flex size-12 shrink-0 items-center justify-center rounded-card bg-accent text-on-accent transition-transform duration-(--duration-press) ease-route active:scale-[0.97]"
        >
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4 4" />
          </svg>
        </button>
      </div>
    </form>
  );
}
