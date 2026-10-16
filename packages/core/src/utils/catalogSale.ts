/**
 * LIRA-302 — a Katsh / iPick catalog cart (vouchers, cards) booked as ONE sale.
 *
 * The single definition of the walk-in cart payload (rule 22 / spec FR-007):
 * the web's KatshForm builds its plain cart with it and adds its own extras
 * (discount, Only-Days, split checkout, kept change) on top; the phone app
 * sends it as is. Both post it to `POST /api/services/transactions`
 * (`createFinancialServiceSchema`), so a phone sale books exactly like the
 * same cart at the counter.
 *
 * Pure and dependency-free apart from a type import (rule 29).
 */
import type { CreateFinancialServicePayload } from "../validators/financial.js";

/** The catalog fields a cart line needs (`mobile_service_items`). */
export interface CatalogItem {
  /** LIRA-329: the catalog item's key (`ServiceItem.key`), kept on the
   *  sale's details. Optional — a caller without one sends none. */
  key?: string | undefined;
  category: string;
  label: string;
  subcategory?: string | null | undefined;
  /** What the item costs the shop, in LBP. */
  cost_lbp: number;
  /** What the customer pays, in LBP. */
  sell_lbp: number;
}

export interface CatalogCartLine {
  item: CatalogItem;
  quantity: number;
  /** Appended to this line in the note (the web's " [Only Days]"). */
  noteSuffix?: string | undefined;
  /** LIRA-329: sold as Only Days, and the credits returned (USD) as shown. */
  onlyDays?: boolean | undefined;
  returnedCreditsUsd?: number | undefined;
}

/**
 * LIRA-329 — the cart as the structured item list the transaction keeps in
 * its details (`catalogItems`): one entry per line, as picked. Informational
 * only; the server's money steps never read it.
 */
export function catalogCartItems(
  lines: readonly CatalogCartLine[],
): NonNullable<CreateFinancialServicePayload["catalogItems"]> {
  return lines.map((l) => ({
    ...(l.item.key ? { key: l.item.key } : {}),
    ...(l.item.category ? { category: l.item.category } : {}),
    ...(l.item.label ? { label: l.item.label } : {}),
    quantity: l.quantity,
    unitPrice: l.item.sell_lbp,
    ...(l.onlyDays
      ? {
          onlyDays: true,
          ...(l.returnedCreditsUsd !== undefined
            ? { returnedCreditsUsd: l.returnedCreditsUsd }
            : {}),
        }
      : {}),
  }));
}

/** "category: label (subcategory)" — the name shown and written into the sale's note. */
export function formatCatalogItemName(item: Pick<CatalogItem, "category" | "label" | "subcategory">): string {
  const sub = item.subcategory?.trim();
  return `${item.category}: ${item.label}${sub ? ` (${sub})` : ""}`;
}

/**
 * The sale's note: one entry per line, " xN" when more than one, an optional
 * per-line suffix (the web's " [Only Days]"), joined by ", ".
 */
export function catalogCartNote(
  lines: readonly { item: Pick<CatalogItem, "category" | "label" | "subcategory">; quantity: number; suffix?: string | undefined }[],
): string {
  return lines
    .map((l) => `${formatCatalogItemName(l.item)}${l.quantity > 1 ? ` x${l.quantity}` : ""}${l.suffix ?? ""}`)
    .join(", ");
}

/** The suffix the web adds to an Only-Days line in the note. */
const ONLY_DAYS_NOTE_SUFFIX = " [Only Days]";

/**
 * LIRA-325 — the inverse of `catalogCartNote` (kept next to it so the format
 * is defined in one place, rule 14): each entry's item name
 * (`formatCatalogItemName`) and quantity, with the " [Only Days]" suffix
 * dropped. A walk-in cart writes no item key, so its note is the only record
 * of what was sold. A name that itself contains ", " splits wrongly and then
 * simply matches no catalog item — callers treat that as "unknown".
 */
export function parseCatalogCartNote(
  note: string | null | undefined,
): { name: string; quantity: number }[] {
  if (!note || !note.trim()) return [];
  return note
    .split(", ")
    .map((raw) => {
      let entry = raw.trim();
      if (entry.endsWith(ONLY_DAYS_NOTE_SUFFIX.trim())) {
        entry = entry.slice(0, -ONLY_DAYS_NOTE_SUFFIX.trim().length).trim();
      }
      const qty = / x(\d+)$/.exec(entry);
      return qty
        ? { name: entry.slice(0, qty.index).trim(), quantity: Number(qty[1]) }
        : { name: entry, quantity: 1 };
    })
    .filter((e) => e.name.length > 0);
}

/**
 * USD to ask for an LBP amount at `rate` LBP per USD, rounded to the cent —
 * the same arithmetic as the web's payment sheet (`lbp × (1 / rate)`, then
 * `Math.round(x × 100) / 100`; packages/ui money/convert + roundForCurrency),
 * so the two never differ by a cent.
 */
export function usdForLbp(lbp: number, rate: number): number {
  if (!(rate > 0)) throw new Error("A positive exchange rate is required.");
  return Math.round(lbp * (1 / rate) * 100) / 100;
}

export interface CatalogSaleInput {
  provider: "Katsh" | "iPick";
  lines: readonly CatalogCartLine[];
  /** The single method, or "MULTI" for several legs (web). */
  paidByMethod: string;
  /** Payment legs (IN). Omit for a call that books no payment (the web's deferred units). */
  payments?: CreateFinancialServicePayload["payments"] | undefined;
  /** The LBP-per-USD rate a USD leg was computed at (sent only with legs). */
  tenderExchangeRate?: number | undefined;
  client?: { id?: number | null | undefined; name?: string | null | undefined } | undefined;
}

/** Totals of a cart in LBP: what the customer pays and what it costs the shop. */
export function catalogCartTotals(lines: readonly CatalogCartLine[]): { price: number; cost: number } {
  return lines.reduce(
    (t, l) => ({ price: t.price + l.item.sell_lbp * l.quantity, cost: t.cost + l.item.cost_lbp * l.quantity }),
    { price: 0, cost: 0 },
  );
}

/**
 * The walk-in cart as one `SEND` (KatshForm's aggregation): amount = Σ sell ×
 * qty, cost = Σ cost × qty (gross), commission = max(0, amount − cost) (the
 * server recomputes it), LBP, the item list as the note.
 */
export function buildCatalogSalePayload(input: CatalogSaleInput): CreateFinancialServicePayload {
  if (input.lines.length === 0) throw new Error("The cart is empty.");
  for (const l of input.lines) {
    if (!Number.isInteger(l.quantity) || l.quantity < 1) {
      throw new Error(`Quantity must be a whole number of at least 1 (${formatCatalogItemName(l.item)}).`);
    }
  }
  const { price, cost } = catalogCartTotals(input.lines);
  const hasLegs = !!input.payments && input.payments.length > 0;
  const clientId = input.client?.id ?? undefined;
  const clientName = input.client?.name || undefined;
  return {
    provider: input.provider,
    serviceType: "SEND",
    amount: price,
    cost,
    currency: "LBP",
    commission: Math.max(0, price - cost),
    paidByMethod: input.paidByMethod,
    ...(hasLegs ? { payments: input.payments, checkoutTotal: { usd: 0, lbp: price } } : {}),
    ...(hasLegs && input.tenderExchangeRate !== undefined ? { tender_exchange_rate: input.tenderExchangeRate } : {}),
    ...(clientId ? { clientId } : {}),
    ...(clientName ? { clientName } : {}),
    note: catalogCartNote(input.lines.map((l) => ({ ...l, suffix: l.noteSuffix }))),
    catalogItems: catalogCartItems(input.lines),
  };
}
