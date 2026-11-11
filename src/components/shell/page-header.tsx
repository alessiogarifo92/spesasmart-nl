import type { ReactNode } from "react";

/** Top of every screen: optional eyebrow line, the page title, and a trailing slot. */
export function PageHeader({ title, eyebrow, trailing }: { title: string; eyebrow?: string; trailing?: ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-3 pt-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        {eyebrow && <span className="text-label text-muted">{eyebrow}</span>}
        <h1 className="font-display text-title font-semibold">{title}</h1>
      </div>
      {trailing}
    </header>
  );
}
