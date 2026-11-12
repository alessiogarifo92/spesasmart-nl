"use client";

import { useActionState } from "react";
import { buttonClass } from "@/components/ui/button";
import { adminLoginAction } from "@/server/admin-actions";

type Props = { labels: { token: string; submit: string; wrong: string } };

/** Asks for the admin token. Works before JavaScript loads; the token is never kept in the page. */
export function AdminLoginForm({ labels }: Props) {
  const [state, action, pending] = useActionState(adminLoginAction, null);
  return (
    <form action={action} aria-busy={pending || undefined} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-label text-muted">{labels.token}</span>
        <input
          name="token"
          type="password"
          required
          maxLength={512}
          autoComplete="current-password"
          className="h-12 rounded-card border border-line bg-surface px-4 text-body text-text"
        />
      </label>
      {state && (
        <p role="alert" className="text-label text-warn">
          {labels.wrong}
        </p>
      )}
      <button type="submit" disabled={pending} className={buttonClass("primary")}>
        {labels.submit}
      </button>
    </form>
  );
}
