import { useFormatter, useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { isoToDbDate } from "@/lib/dates";
import type { OfferView } from "@/server/offers";

function useMoney() {
  const format = useFormatter();
  return (cents: number) => format.number(cents / 100, { style: "currency", currency: "EUR" });
}

/** The mechanic in the interface language; the chain's own wording when it is not a recognised one. */
function usePromoLabel() {
  const t = useTranslations("offers");
  const money = useMoney();
  return (offer: OfferView): string | null => {
    const promotion = offer.promotion;
    switch (promotion.type) {
      case "X_PLUS_Y_FREE":
        return t("promoXPlusYFree", { buy: promotion.buy, free: promotion.free });
      case "NTH_HALF_PRICE":
        return t("promoNthHalf", { n: promotion.n });
      case "X_FOR_PRICE":
        return t("promoXForPrice", { quantity: promotion.quantity, price: money(promotion.totalCents) });
      case "PERCENT_OFF":
        return t("promoPercent", { percent: promotion.percent });
      case "UNKNOWN":
        return promotion.text || null;
      case "PRICE_CUT":
        return null;
    }
  };
}

/**
 * One offer. Facts (price, mechanic, validity, source) and estimates (discount,
 * price per item in a deal) are kept apart: every estimate says "ca.".
 */
export function OfferCard({ offer }: { offer: OfferView }) {
  const t = useTranslations("offers");
  const common = useTranslations("common");
  const format = useFormatter();
  const money = useMoney();
  const promoLabel = usePromoLabel()(offer);
  const { summary } = offer;

  const day = (iso: string) =>
    format.dateTime(isoToDbDate(iso), { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

  const state =
    summary.state === "ends-today"
      ? t("stateEndsToday")
      : summary.state === "upcoming" && offer.validFrom
        ? t("stateUpcoming", { date: day(offer.validFrom) })
        : summary.state === "unknown-validity"
          ? t("stateUnknown")
          : t("stateDaysLeft", { days: summary.daysLeft ?? 0 });
  const urgent = summary.state === "ends-today" || summary.state === "unknown-validity" || !offer.verified;

  const unitKey = { kg: "perKg", l: "perLitre", piece: "perPiece" } as const;
  const facts = [
    offer.regularPriceCents !== null && offer.regularPriceCents !== summary.shownPriceCents
      ? t("from", { price: money(offer.regularPriceCents) })
      : null,
    offer.unitPrice ? t(unitKey[offer.unitPrice.basis], { price: money(offer.unitPrice.cents) }) : null,
  ].filter(Boolean);
  const estimates = [
    summary.discountPercent !== null ? t("discount", { percent: summary.discountPercent }) : null,
    summary.dealQuantity !== null && summary.dealQuantity > 1 && summary.dealUnitCents !== null
      ? t("dealPerItem", { quantity: summary.dealQuantity, price: money(summary.dealUnitCents) })
      : null,
  ].filter(Boolean);

  const validity =
    offer.validUntil === null
      ? t("validUnknown")
      : offer.validFrom
        ? t("validRange", { from: day(offer.validFrom), until: day(offer.validUntil) })
        : t("validUntil", { until: day(offer.validUntil) });

  return (
    <Card
      tone={summary.state === "upcoming" ? "dashed" : "solid"}
      className="flex flex-col gap-2"
      data-testid="offer-card"
      data-state={summary.state}
    >
      <div className="flex justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className={cn("text-label font-semibold", urgent ? "text-warn" : "text-accent")}>
            {state} · {offer.retailer.name}
            {offer.kind === "DAILY" && ` · ${t("daily")}`}
          </span>
          <h3 className="text-body font-semibold">
            {offer.name}
            {offer.isOrganic && (
              <span className="ml-1.5 rounded-pill border border-line px-1.5 py-0.5 text-[11px] font-semibold text-muted">
                {t("organicBadge")}
              </span>
            )}
          </h3>
          {promoLabel && <span className="text-label font-semibold text-text">{promoLabel}</span>}
          {facts.length > 0 && <span className="text-label text-muted">{facts.join(" · ")}</span>}
          {estimates.length > 0 && <span className="text-label text-muted">{estimates.join(" · ")}</span>}
        </div>
        <span className="shrink-0 text-right font-display text-[18px] leading-6 font-semibold">
          {summary.shownPriceCents !== null ? (
            money(summary.shownPriceCents)
          ) : (
            <span className="font-sans text-label font-normal text-muted">{t("priceUnknown")}</span>
          )}
        </span>
      </div>

      {!offer.verified && (
        <span className="self-start rounded-pill border border-warn px-2 py-0.5 text-[11px] leading-4 font-semibold text-warn">
          {common("toVerify")}
        </span>
      )}

      <p className="text-[11px] leading-4 text-muted">
        {validity}
        {offer.validityApproximate && ` ${t("validApprox")}`}
        {offer.conditions && ` · ${offer.conditions}`}
        <br />
        {t("source")}:{" "}
        {offer.sourceUrl ? (
          <a href={offer.sourceUrl} rel="noopener noreferrer nofollow" target="_blank" className="underline">
            {new URL(offer.sourceUrl).hostname}
          </a>
        ) : (
          t("sourceDemo")
        )}
        {" · "}
        {t("updated", {
          date: format.dateTime(offer.collectedAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
        })}
      </p>
    </Card>
  );
}

export function OfferList({ offers, label }: { offers: OfferView[]; label?: string }) {
  return (
    <ul aria-label={label} className="m-0 flex list-none flex-col gap-2 p-0">
      {offers.map((offer) => (
        <li key={offer.id}>
          <OfferCard offer={offer} />
        </li>
      ))}
    </ul>
  );
}
