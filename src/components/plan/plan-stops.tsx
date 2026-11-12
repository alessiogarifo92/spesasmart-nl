import { useTranslations } from "next-intl";
import { useMoney } from "@/components/offers/offer-card";
import { Card } from "@/components/ui/card";
import { ChipLink } from "@/components/ui/chip";
import { RouteStop, RouteStops } from "@/components/ui/route-stops";
import type { MissingItem, Mode, PlanLine, PlanSettings } from "@/domain/optimizer";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import type { PlanView } from "@/server/plan";

/** Why a line is where it is, as one short sentence. */
function useReason(view: PlanView, { mode, similar }: PlanSettings) {
  const t = useTranslations("plan");
  const money = useMoney();
  const name = (slug: string) => view.retailers[slug] ?? slug;
  return (line: PlanLine): string => {
    const { reason } = line;
    const saving = line.regularTotalCents === null ? 0 : line.regularTotalCents - line.totalCents;
    const daysLeft = line.candidate.offer?.daysLeft ?? null;
    // An offer is named on every line it lowers, whatever else explains the line.
    const offer = line.usedOffer
      ? [
          saving > 0 ? t("reasonOfferSaving", { saving: money(saving) }) : t("reasonOffer"),
          daysLeft === null ? null : t("daysLeft", { days: daysLeft }),
        ]
      : [];
    const join = (...parts: (string | null)[]) => parts.filter(Boolean).join(" · ");
    switch (reason.code) {
      case "pinned":
        return join(t("reasonPinned"), ...offer);
      case "only-store":
        // Under a filter the other chains may sell it too, just not on offer or not organic.
        if (mode === "offers-only") return join(t("reasonOnlyOffer"), ...offer.slice(1));
        if (mode === "organic-only") return join(t("reasonOnlyOrganic"), ...offer);
        // With similar products ruled out, other chains may well sell one: the pick is the reason.
        if (!similar && view.picked[line.itemId] === line.candidate.productId)
          return join(t("reasonClosest"), ...offer);
        return join(t("reasonOnlyStore"), ...offer);
      case "offer":
        return join(...offer);
      case "cheapest":
        if (reason.nextRetailerId === null || reason.differenceCents === null)
          return join(t("reasonCheapest"), ...offer);
        return join(
          reason.differenceCents > 0
            ? t("reasonCheaperThan", {
                difference: money(reason.differenceCents),
                retailer: name(reason.nextRetailerId),
              })
            : t("reasonSamePrice", { retailer: name(reason.nextRetailerId) }),
          ...offer,
        );
      case "closest-match":
        return join(t("reasonClosest"), ...offer);
    }
  };
}

function Line({ line, view, settings }: { line: PlanLine; view: PlanView; settings: PlanSettings }) {
  const t = useTranslations("plan");
  const money = useMoney();
  const reason = useReason(view, settings)(line);
  const { candidate } = line;
  const pickedId = view.picked[line.itemId];
  // Say what is actually bought whenever it is not the listing the shopper picked.
  const boughtAs =
    pickedId === candidate.productId
      ? null
      : pickedId === undefined
        ? t("boughtAs", { name: candidate.name })
        : candidate.tier === "SAME"
          ? t("boughtAsSame", { name: candidate.name })
          : t("boughtAsSimilar", { name: candidate.name });

  return (
    <li data-testid="plan-line" className="flex justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <Link href={`/product/${candidate.productId}`} className="-my-3 inline-block py-3 text-body font-semibold">
          {line.quantity > 1 ? t("times", { label: line.label, quantity: line.quantity }) : line.label}
        </Link>
        {boughtAs && <span className="text-label text-text">{boughtAs}</span>}
        <span className={cn("text-label", line.usedOffer ? "text-accent" : "text-muted")}>{reason}</span>
        {line.hint && (
          <span className="text-label text-muted">{t("hintBuyMore", { quantity: line.hint.minimumQuantity })}</span>
        )}
        {line.assumed && <span className="text-label text-muted">{t("assumed")}</span>}
      </div>
      <div className="flex shrink-0 flex-col items-end">
        <span className="font-display text-body font-semibold">{money(line.totalCents)}</span>
        {line.quantity > 1 && (
          <span className="text-[11px] leading-4 text-muted">{t("each", { price: money(line.unitCents) })}</span>
        )}
      </div>
    </li>
  );
}

function useMissingReason(view: PlanView, mode: Mode) {
  const t = useTranslations("plan");
  return (item: MissingItem, pinnedSlug: string | null): string => {
    switch (item.reason) {
      case "not-found":
        return t("missingNotFound");
      case "pinned-unavailable":
        return pinnedSlug && view.retailers[pinnedSlug]
          ? t("missingPinned", { retailer: view.retailers[pinnedSlug] })
          : t("missingPinnedUnknown");
      case "filtered":
        return mode === "organic-only" ? t("missingFilteredOrganic") : t("missingFilteredOffers");
      case "not-in-chosen-stores":
        return t("missingNotInStores");
    }
  };
}

/** The route: one numbered stop per chain with what to buy there, then what no stop has. */
export function PlanStops({ view, settings }: { view: PlanView; settings: PlanSettings }) {
  const t = useTranslations("plan");
  const money = useMoney();
  const missingReason = useMissingReason(view, settings.mode);
  const { stops, missing } = view.plan;

  return (
    <RouteStops label={t("stopsLabel")}>
      {stops.map((stop, index) => {
        const last = index === stops.length - 1;
        return (
          <RouteStop
            key={stop.retailerId}
            index={index + 1}
            connected={!last || missing.length > 0}
            mutedSegment={last && missing.length > 0}
          >
            <div data-testid="plan-stop" data-retailer={stop.retailerId} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-display text-[18px] leading-7 font-semibold">
                  {view.retailers[stop.retailerId] ?? stop.retailerId}
                  <span className="font-sans text-label font-normal text-muted">
                    {" · "}
                    {t("stopCount", { count: stop.lines.length })}
                  </span>
                </h2>
                <span className="shrink-0 font-display text-[16px] leading-7 font-semibold">
                  {money(stop.subtotalCents)}
                </span>
              </div>
              <Card className="px-3.5 py-3">
                <ul className="m-0 flex list-none flex-col gap-3 p-0">
                  {stop.lines.map((line) => (
                    <Line key={line.itemId} line={line} view={view} settings={settings} />
                  ))}
                </ul>
              </Card>
            </div>
          </RouteStop>
        );
      })}
      {missing.map((item, index) => (
        <RouteStop key={item.itemId} state="missing" connected={index < missing.length - 1}>
          <div data-testid="plan-missing" className="flex items-center justify-between gap-3">
            <p className="min-w-0 text-body">
              <strong className="font-semibold text-warn">{item.label}</strong>
              <span className="block text-label text-muted">{missingReason(item, view.pins[item.itemId] ?? null)}</span>
            </p>
            <ChipLink
              href={{ pathname: "/search", query: { q: item.label } }}
              aria-label={t("missingSearchNamed", { item: item.label })}
              className="shrink-0 border-warn text-warn"
            >
              {t("missingSearch")}
            </ChipLink>
          </div>
        </RouteStop>
      ))}
    </RouteStops>
  );
}
