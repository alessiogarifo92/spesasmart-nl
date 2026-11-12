"use client";

import { useActionState } from "react";
import type { ReportState } from "@/server/feedback-actions";

type Props = {
  action: (state: ReportState, formData: FormData) => Promise<ReportState>;
  productId: string;
  /** With a link: "not the same product". Without: "wrong price". */
  matchId?: string;
  label: string;
  /** What a screen reader hears: the label alone does not say which product. */
  description: string;
  sent: string;
  failed: string;
};

/** One tap to report a wrong link or a wrong price; the button gives way to a thank-you. */
export function ReportForm({ action, productId, matchId, label, description, sent, failed }: Props) {
  const [state, formAction, pending] = useActionState(action, null);
  if (state === "sent") {
    return (
      <p role="status" className="flex min-h-11 items-center text-label text-muted">
        {sent}
      </p>
    );
  }
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-x-2">
      <input type="hidden" name="productId" value={productId} />
      {matchId && <input type="hidden" name="matchId" value={matchId} />}
      <button
        type="submit"
        disabled={pending}
        aria-label={description}
        className="inline-flex min-h-11 items-center text-label text-muted underline disabled:opacity-60"
      >
        {label}
      </button>
      {state === "failed" && (
        <span role="alert" className="text-label text-warn">
          {failed}
        </span>
      )}
    </form>
  );
}
