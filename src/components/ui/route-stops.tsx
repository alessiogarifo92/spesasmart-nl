import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * The signature element of the design: stops joined by a vertical line.
 * `RouteStops` is an ordered list; each `RouteStop` draws its marker and the
 * segment to the next stop.
 */
export function RouteStops({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <ol aria-label={label} className={cn("m-0 flex list-none flex-col p-0", className)}>
      {children}
    </ol>
  );
}

type RouteStopProps = {
  children: ReactNode;
  /** Number shown in the marker; omit for a plain dot. */
  index?: number;
  /** `missing` is an item no store carries: dashed amber marker, no segment. */
  state?: "stop" | "missing";
  /** False on the last stop: no segment below it. */
  connected?: boolean;
  /** A muted segment leads to something that is not a store (the missing row). */
  mutedSegment?: boolean;
};

export function RouteStop({ children, index, state = "stop", connected = true, mutedSegment = false }: RouteStopProps) {
  const numbered = index !== undefined || state === "missing";
  return (
    <li className="flex items-stretch gap-3">
      <div aria-hidden="true" className={cn("flex shrink-0 flex-col items-center", numbered ? "w-7" : "w-4")}>
        {state === "missing" ? (
          <span className="flex size-7 items-center justify-center rounded-pill border-2 border-dashed border-warn font-display text-body font-semibold text-warn">
            ?
          </span>
        ) : index !== undefined ? (
          <span className="flex size-7 items-center justify-center rounded-pill bg-accent font-display text-body font-semibold text-on-accent">
            {index}
          </span>
        ) : (
          <span className="mt-1 size-3 rounded-pill bg-accent" />
        )}
        {connected && state !== "missing" && (
          <span className={cn("w-0.5 grow", mutedSegment ? "bg-line" : "bg-accent")} />
        )}
      </div>
      <div className={cn("min-w-0 grow", connected && "pb-4")}>{children}</div>
    </li>
  );
}
