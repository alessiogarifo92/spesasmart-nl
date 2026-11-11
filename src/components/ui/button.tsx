import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";
import { Link } from "@/i18n/navigation";

type Variant = "primary" | "secondary" | "warn";

const base =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-card px-4 font-display text-body font-semibold " +
  "transition-transform duration-(--duration-press) ease-route active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-on-accent",
  secondary: "border border-line bg-surface text-text",
  warn: "border border-warn bg-transparent text-warn",
};

export function buttonClass(variant: Variant = "primary", className?: string): string {
  return cn(base, variants[variant], className);
}

type ButtonProps = ComponentProps<"button"> & { variant?: Variant };

export function Button({ variant, className, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={buttonClass(variant, className)} {...props} />;
}

type ButtonLinkProps = ComponentProps<typeof Link> & { variant?: Variant };

/** A navigation link that looks like a button. */
export function ButtonLink({ variant, className, ...props }: ButtonLinkProps) {
  return <Link className={buttonClass(variant, className)} {...props} />;
}
