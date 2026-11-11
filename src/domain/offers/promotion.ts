import { z } from "zod";
import type { Promotion } from "@/domain/pricing";

const positiveInt = z.number().int().positive();

const shapes = {
  X_PLUS_Y_FREE: z.object({ buy: positiveInt, free: positiveInt }),
  NTH_HALF_PRICE: z.object({ n: z.number().int().min(2) }),
  X_FOR_PRICE: z.object({ quantity: positiveInt, totalCents: z.number().int().nonnegative() }),
  PERCENT_OFF: z.object({ percent: z.number().gt(0).lt(100) }),
};

/**
 * Rebuilds a `Promotion` from the stored `promoType` and `promoParams`.
 * Parameters that do not fit the type give `UNKNOWN` (with the stored wording),
 * so a corrupt row can never be priced as a deal.
 */
export function promotionFromStored(type: string, params: unknown, description: string | null): Promotion {
  if (type === "PRICE_CUT") return { type };
  if (type in shapes) {
    const key = type as keyof typeof shapes;
    const parsed = shapes[key].safeParse(params);
    if (parsed.success) return { type: key, ...parsed.data } as Promotion;
  }
  return { type: "UNKNOWN", text: description ?? "" };
}
