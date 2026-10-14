/**
 * LIRA-312 — shared helpers for the wrong-number panels (kept out of the
 * component files so React Fast Refresh keeps working).
 */
import type { MobileServiceItemEntity } from "@liratek/ui";
import { formatCatalogItemName } from "@liratek/core";
import type { WrongNumberProviderCode } from "@/features/audit/actionGating";

export const PROVIDER_LABELS: Record<WrongNumberProviderCode, string> = {
  iPick: "iPick",
  Katsh: "Katsh",
  WHISH_APP: "Whish App",
};

/** An MTC/Alfa card of the provider, with a cost (the only cards a wrong
 *  number can be recorded for — the server checks the same). */
export function isWrongNumberCard(
  item: MobileServiceItemEntity,
  provider: WrongNumberProviderCode,
): boolean {
  const carrier = item.category.toLowerCase();
  return (
    item.provider === provider &&
    (carrier === "mtc" || carrier === "alfa") &&
    item.cost_lbp > 0
  );
}

/** The first card named in the sale's text (its summary lists the cart). */
export function defaultCardFor(
  cards: MobileServiceItemEntity[],
  saleText: string | null | undefined,
): MobileServiceItemEntity | null {
  const text = (saleText ?? "").toLowerCase();
  if (text) {
    const named = cards.find((c) =>
      text.includes(formatCatalogItemName(c).toLowerCase()),
    );
    if (named) return named;
  }
  return cards[0] ?? null;
}

export function carrierLabel(carrier: string): string {
  return carrier.toLowerCase() === "mtc" ? "MTC" : "Alfa";
}

export function lbp(n: number): string {
  return `${Math.round(n).toLocaleString()} LBP`;
}
