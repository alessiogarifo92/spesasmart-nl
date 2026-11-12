import { useFormatter } from "next-intl";
import type { Quantity } from "@/domain/pricing";

/** A package size as people write it: "500 g", "1,5 l", "6 × 330 ml", "10 st.". */
export function useQuantityLabel() {
  const format = useFormatter();
  return (quantity: Pick<Quantity, "amount" | "unit" | "count">, pieces: string): string => {
    const { amount, unit, count } = quantity;
    const one =
      unit === "piece"
        ? `${format.number(amount)} ${pieces}`
        : amount >= 1000
          ? `${format.number(amount / 1000, { maximumFractionDigits: 2 })} ${unit === "g" ? "kg" : "l"}`
          : `${format.number(amount)} ${unit}`;
    return count > 1 ? `${count} × ${one}` : one;
  };
}
