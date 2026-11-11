import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";
import { Link } from "@/i18n/navigation";

type ChipLinkProps = ComponentProps<typeof Link> & { selected?: boolean };

/** A filter choice that is a link: the page works without JavaScript and filters are shareable. */
export function ChipLink({ selected = false, className, ...props }: ChipLinkProps) {
  return (
    <Link
      aria-current={selected ? "true" : undefined}
      className={cn(
        "inline-flex min-h-11 items-center justify-center rounded-pill border bg-surface px-3.5 text-[13px] leading-5 font-semibold",
        selected ? "border-accent text-accent" : "border-line text-text",
        className,
      )}
      {...props}
    />
  );
}
