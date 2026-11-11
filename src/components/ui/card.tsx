import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

type CardProps = ComponentProps<"div"> & {
  /** `dashed` marks something that is not in force yet (an upcoming offer). */
  tone?: "solid" | "outlined" | "dashed";
};

const tones = {
  solid: "bg-surface",
  outlined: "border border-line bg-surface",
  dashed: "border border-dashed border-line",
};

export function Card({ tone = "solid", className, ...props }: CardProps) {
  return <div className={cn("rounded-card p-4", tones[tone], className)} {...props} />;
}
