"use client";

import { useActionState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { ActionState } from "@/server/list-actions";

type Props = {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  /** The message for each reason the action can refuse with, already translated. */
  errors: Record<NonNullable<ActionState>["error"], string>;
  className?: string;
  children: ReactNode;
};

/** A form around a Server Function that says why a submit was refused. Works before JavaScript loads. */
export function ActionForm({ action, errors, className, children }: Props) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} aria-busy={pending || undefined} className={cn(className, pending && "opacity-60")}>
      {children}
      {state && (
        <p role="alert" className="w-full text-label text-warn">
          {errors[state.error]}
        </p>
      )}
    </form>
  );
}
