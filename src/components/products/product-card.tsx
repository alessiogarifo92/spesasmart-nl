import { useFormatter, useTranslations } from "next-intl";
import { AddToList } from "@/components/list/add-to-list";
import { useMoney, usePromoLabel } from "@/components/offers/offer-card";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import type { CatalogProduct } from "@/server/catalog";

type Props = {
  product: CatalogProduct;
  lowestPrice?: boolean;
  bestUnitPrice?: boolean;
  /** How many of this product are on the shopping list already. */
  listed?: number;
};

/**
 * One chain's listing of a product with today's price. The price is a fact
 * (shelf price, or a verified running offer); an offer that needs several items
 * or cannot be verified is described next to it and never changes it.
 */
export function ProductCard({ product, lowestPrice = false, bestUnitPrice = false, listed = 0 }: Props) {
  const t = useTranslations("product");
  const offers = useTranslations("offers");
  const common = useTranslations("common");
  const format = useFormatter();
  const money = useMoney();
  const promoLabel = usePromoLabel();
  const { offer, price } = product;

  const offerState = offer
    ? offer.summary.state === "ends-today"
      ? offers("stateEndsToday")
      : offer.summary.daysLeft !== null
        ? offers("stateDaysLeft", { days: offer.summary.daysLeft })
        : null
    : null;
  const unitKey = { kg: "perKg", l: "perLitre", piece: "perPiece" } as const;
  const bestKey = { kg: "bestUnitKg", l: "bestUnitLitre", piece: "bestUnitPiece" } as const;
  const facts = [
    price?.usedOffer && price.regularTotalCents !== null ? offers("from", { price: money(price.regularTotalCents) }) : null,
    price?.unitPrice ? offers(unitKey[price.unitPrice.basis], { price: money(price.unitPrice.cents) }) : null,
  ].filter(Boolean);
  // A mechanic that is not in the price shown: it needs more items, or it could not be verified.
  const mechanic = offer && !price?.usedOffer ? promoLabel(offer) : null;
  const source = price?.usedOffer && offer ? { url: offer.sourceUrl, at: offer.collectedAt } : product.priceSource
    ? { url: product.priceSource.url, at: product.priceSource.recordedAt }
    : null;

  return (
    <Card
      className="flex flex-col gap-2"
      data-testid="product-card"
      data-lowest={lowestPrice || undefined}
      data-best-unit={bestUnitPrice || undefined}
    >
      <div className="flex justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className={cn("text-label font-semibold", price?.usedOffer ? "text-accent" : "text-muted")}>
            {product.retailer.name}
            {price?.usedOffer && ` · ${t("onOffer")}`}
            {price?.usedOffer && offerState && ` · ${offerState}`}
          </span>
          <h3 className="text-body font-semibold">
            {product.name}
            {product.isOrganic && (
              <span className="ml-1.5 rounded-pill border border-line px-1.5 py-0.5 text-[11px] font-semibold text-muted">
                {offers("organicBadge")}
              </span>
            )}
          </h3>
          {facts.length > 0 && <span className="text-label text-muted">{facts.join(" · ")}</span>}
          {mechanic && offer?.verified && price?.hint && (
            <span className="text-label text-text">
              <span className="font-semibold">{mechanic}</span> · {t("dealFrom", { quantity: price.hint.minimumQuantity })}
            </span>
          )}
        </div>
        <span className="shrink-0 text-right font-display text-[18px] leading-6 font-semibold">
          {price ? money(price.totalCents) : <span className="font-sans text-label font-normal text-muted">{t("priceUnknown")}</span>}
        </span>
      </div>

      {(lowestPrice || bestUnitPrice) && (
        <div className="flex flex-wrap gap-1.5">
          {lowestPrice && (
            <span className="rounded-pill bg-accent px-2 py-0.5 text-[11px] leading-4 font-semibold text-on-accent">{t("lowestPrice")}</span>
          )}
          {bestUnitPrice && price?.unitPrice && (
            <span className="rounded-pill border border-accent px-2 py-0.5 text-[11px] leading-4 font-semibold text-accent">
              {t(bestKey[price.unitPrice.basis])}
            </span>
          )}
        </div>
      )}

      {offer && !offer.verified && (
        <p className="flex flex-wrap items-center gap-1.5 text-[11px] leading-4 text-muted">
          <span className="rounded-pill border border-warn px-2 py-0.5 font-semibold text-warn">{common("toVerify")}</span>
          {t("unverifiedOffer")}
        </p>
      )}

      {source && (
        <p className="text-[11px] leading-4 text-muted">
          {offers("source")}:{" "}
          {source.url ? (
            <a href={source.url} rel="noopener noreferrer nofollow" target="_blank" className="underline">
              {new URL(source.url).hostname}
            </a>
          ) : (
            offers("sourceDemo")
          )}
          {" · "}
          {offers("updated", { date: format.dateTime(source.at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) })}
        </p>
      )}

      <AddToList productId={product.id} name={product.name} quantity={listed} />
    </Card>
  );
}

type ListProps = {
  items: Omit<Props, "listed">[];
  label?: string;
  /** Quantity on the shopping list per product id. */
  listed?: ReadonlyMap<string, number>;
};

export function ProductList({ items, label, listed }: ListProps) {
  return (
    <ul aria-label={label} className="m-0 flex list-none flex-col gap-2 p-0">
      {items.map((item) => (
        <li key={item.product.id}>
          <ProductCard {...item} listed={listed?.get(item.product.id)} />
        </li>
      ))}
    </ul>
  );
}
