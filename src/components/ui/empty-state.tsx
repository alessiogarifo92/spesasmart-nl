import type { ReactNode } from "react";
import { Card } from "./card";

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <Card tone="outlined" className="flex flex-col items-start gap-3 p-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-[18px] leading-6 font-semibold">{title}</h2>
        <p className="text-muted">{body}</p>
      </div>
      {action}
    </Card>
  );
}
