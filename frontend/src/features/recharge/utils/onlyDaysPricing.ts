/**
 * Only Days pricing for MTC / Alfa catalog cards — shared by the Katsh / iPick
 * grid (KatshForm) and the Whish App grid (FinancialForm), LIRA-406.
 *
 * Moved verbatim from KatshForm.tsx (where it was module-private) so both
 * grids price an Only Days line with ONE definition (rule 14). The money
 * rules themselves live in `@liratek/core` (`utils/telecomCredit.ts`); this
 * module only applies them to a cart line.
 */
import {
  maxReturnableCredits,
  resolveMaxReturnedCredits,
  isTelecomSplitComplete,
  resolveCreditSellPriceLbp,
} from "@liratek/core";
import type { ServiceItem } from "../hooks/useMobileServiceItems";

/** The fields of a cart line Only Days pricing reads. Both `CatalogCartLine`
 *  (Katsh / iPick) and `WhishCartLine` (Whish App) satisfy it. */
export interface OnlyDaysLine {
  item: ServiceItem;
  onlyDays?: boolean | undefined;
  returnedCreditsUsd?: number | undefined;
  sellDaysLbpOverride?: number | undefined;
  creditPriceLbpOverride?: number | undefined;
}

export function isTelecomVoucher(item: ServiceItem): boolean {
  return (
    item.category === "alfa" ||
    item.category === "mtc" ||
    item.subcategory === "alfa" ||
    item.subcategory === "mtc"
  );
}

/** Tenant setting key for the credit-price 3-level fallback's 2nd level (LBP
 *  per $1 of resold credit). Mirrors the constant of the same name/value in
 *  `MobileServicesManager.tsx`'s resale table — same setting, read here for
 *  the Only-Days sale price instead of the decision aid. */
export const TELECOM_CREDIT_SELL_PRICE_SETTING_KEY =
  "telecom_credit_sell_price_lbp";

/** The pricing-only columns of a catalog item, fetched separately from the
 *  ServiceItem context (`sell_days_lbp`/`sell_credit_lbp` live on
 *  `mobile_service_items` but the shared `ServiceItem` type doesn't map them
 *  through — out of scope to widen for this ticket). Keyed by the item's DB
 *  id in the `catalogPricing` map (`useOnlyDaysPricingData`). */
export interface CatalogPricingRow {
  sell_days_lbp: number | null;
  sell_credit_lbp: number | null;
  /**
   * v160: the per-card returnable override. Lives here rather than on
   * `ServiceItem` for the same reason the two prices do — it is a
   * `mobile_service_items` column the shared context type does not map
   * through.
   */
  max_returned_credits_usd: number | null;
}

/** Result of {@link resolveOnlyDaysPricing}. */
export interface OnlyDaysPricingResult {
  /** False when the catalog item has no `sell_days_lbp` (a day count outside
   *  the seeded table, or a non-candidate item) — callers MUST fall back to
   *  the legacy formula (`sellPrice - returnedCredits * sellRate`) rather
   *  than treat `total` as chargeable. */
  hasSellDaysPrice: boolean;
  sellDaysLbp: number | null;
  creditPriceLbp: number;
  /** LIRA-260: the saved (pre-override) days price, for the price-change warning. */
  catalogSellDaysLbp: number | null;
  /** LIRA-260: the saved (pre-override) credit price, for the price-change warning. */
  catalogCreditPriceLbp: number;
  keptCredits: number;
  /** `sellDaysLbp + keptCredits * creditPriceLbp`, or `null` when
   *  `hasSellDaysPrice` is false. */
  total: number | null;
}

/**
 * Owner pricing model (TELECOM_CREDIT_RATE_PLAN.md §Q4, owner-confirmed
 * 2026-08-05): an Only-Days sale charges
 *
 *   total = sell_days_lbp + kept_credits * credit_price
 *
 * BOTH components are editable per sale; each defaults from data:
 *   - `sellDaysLbp` <- the item's own `sell_days_lbp` (seeded from the
 *     day-count table, migration v147), overridable per line.
 *   - `creditPriceLbp` <- per-item `sell_credit_lbp`, else the tenant
 *     setting `telecom_credit_sell_price_lbp`, else
 *     `DEFAULT_TELECOM_CREDIT_SELL_PRICE_LBP` (rule 14 — imported from
 *     `@liratek/core`, never re-encoded) — same 3-level fallback
 *     `MobileServicesManager.tsx`'s resale table uses.
 *
 * `keptCredits = max(0, maxReturnableCredits(face credits) - returnedCredits)`
 * — the gap between the card's face value and what SMS transfer can ever
 * recover is burned by fees, not left usable on the customer's line, so it
 * is NEVER counted as kept or charged (owner note, TELECOM_DAYS_COST_PLAN
 * ticket brief). When the operator returns the full recoverable amount
 * (the default), `keptCredits` is exactly 0 and `total` is just the days
 * price.
 *
 * Returns `hasSellDaysPrice: false` (and `total: null`) whenever the catalog
 * item has no `sell_days_lbp` — the caller (`calcPrice`) MUST fall back to
 * today's pricing exactly in that case. A missing days price must never
 * silently become 0 and hand the customer a free sale.
 */
export function resolveOnlyDaysPricing(
  line: Pick<
    OnlyDaysLine,
    | "item"
    | "returnedCreditsUsd"
    | "sellDaysLbpOverride"
    | "creditPriceLbpOverride"
  >,
  catalogPricing: Map<number, CatalogPricingRow>,
  tenantCreditSellPriceLbp: number | null,
): OnlyDaysPricingResult {
  const entity =
    line.item.id != null ? catalogPricing.get(line.item.id) : undefined;
  const catalogSellDaysLbp = entity?.sell_days_lbp ?? null;
  const sellDaysLbp = line.sellDaysLbpOverride ?? catalogSellDaysLbp;
  const catalogCreditPriceLbp = resolveCreditSellPriceLbp(
    entity?.sell_credit_lbp,
    tenantCreditSellPriceLbp,
  );
  const creditPriceLbp = line.creditPriceLbpOverride ?? catalogCreditPriceLbp;

  // The face credit MUST be known before this model can price kept credit.
  // Guarding on it is not defensive noise — `maxReturnableCredits(0)` is 0, so
  // a null `credits` would clamp `keptCredits` to 0 and bill the customer the
  // bare days price no matter how much credit they walked away with. That
  // state is reachable: Settings can now save `sell_days_lbp` on an item whose
  // `credits` was left blank, and nothing enforces the pair. Found by
  // adversarial review 2026-08-05 and reproduced (operator kept 4 credits,
  // charge came out at exactly the days price).
  const faceCredits = line.item.credits ?? null;
  const hasFaceCredits = typeof faceCredits === "number" && faceCredits > 0;
  // v160: the base is the card's OVERRIDE when set, else the computed bare-card
  // maximum (rule 14 — `resolveMaxReturnedCredits` owns `override ?? computed`).
  // This is the line that decides what the customer pays: owner decision
  // 2026-09-07 is that a short transfer IS billed, so returning 73 against a
  // 73.5 base bills the 0.5 difference rather than the shop absorbing it.
  const keptCredits = hasFaceCredits
    ? Math.max(
        0,
        resolveMaxReturnedCredits(
          faceCredits,
          entity?.max_returned_credits_usd,
        ) - (line.returnedCreditsUsd ?? 0),
      )
    : 0;

  // `applies` gates the MODEL, not the input. It reads the CATALOG value, never
  // the editable override: gating on the live override let a mid-edit empty
  // field (DecimalInput emits 0 for "") flip this false and unmount the very
  // input being typed into, silently dropping the sale back to legacy pricing.
  // Also found by that review, and also reproduced.
  const applies =
    typeof catalogSellDaysLbp === "number" &&
    catalogSellDaysLbp > 0 &&
    hasFaceCredits;

  // A cleared days-price field means "0 for the days", which is a legitimate
  // thing to charge (a free-days promotion on a kept-credit sale) — it must NOT
  // fall through to the legacy formula, or clearing the field would silently
  // change which formula is in force. Only a MISSING catalog price does that.
  const effectiveSellDays = typeof sellDaysLbp === "number" ? sellDaysLbp : 0;
  const total = applies
    ? effectiveSellDays + keptCredits * creditPriceLbp
    : null;

  return {
    hasSellDaysPrice: applies,
    sellDaysLbp,
    creditPriceLbp,
    catalogSellDaysLbp,
    catalogCreditPriceLbp,
    keptCredits,
    total,
  };
}

export function calcPrice(
  item: ServiceItem,
  onlyDays: boolean,
  returnedCredits: number,
  sellRate: number,
  onlyDaysTotal: number | null,
): number {
  const sellPrice = item.catalogSellPrice ?? 0;
  if (!onlyDays) return sellPrice;
  // Owner pricing model (2026-08-05, resolveOnlyDaysPricing above):
  // `onlyDaysTotal` is `sell_days_lbp + kept_credits * credit_price` when the
  // item has a computed days price. FALLBACK: an item with no `sell_days_lbp`
  // (a day count outside the seeded table, or a non-candidate) keeps TODAY'S
  // pricing exactly — never let a missing days price become 0.
  return onlyDaysTotal ?? sellPrice - returnedCredits * sellRate;
}

/** The price ONE unit of a cart line is charged at (the Only Days price for an
 *  Only Days line). Shared by the totals, the payment window's item list and
 *  the published basket lines, so they always agree. */
export function lineUnitPriceOf(
  line: OnlyDaysLine,
  catalogPricing: Map<number, CatalogPricingRow>,
  tenantCreditSellPriceLbp: number | null,
  alfaCreditSellRate: number,
): number {
  return calcPrice(
    line.item,
    line.onlyDays === true,
    line.returnedCreditsUsd ?? 0,
    alfaCreditSellRate,
    resolveOnlyDaysPricing(line, catalogPricing, tenantCreditSellPriceLbp)
      .total,
  );
}

/**
 * The returned credit an Only Days line starts at when the cashier ticks
 * "Only Days" (moved from KatshForm's toggle handler).
 *
 * Split-complete item: its own face credits through the v160 resolver, so a
 * configured per-card override autofills (the 77.28 card prefills 73.5, not
 * 73). Split-incomplete item: the legacy fallback — the label read as the
 * denomination ("77" → 77) through the SMS-cap formula; there is no catalog
 * row to apply an override from. Anything else: 0.
 */
export function onlyDaysDefaultReturnedCredits(
  item: ServiceItem,
  catalogPricing: Map<number, CatalogPricingRow>,
): number {
  if (
    isTelecomSplitComplete({
      cost_lbp: item.catalogCost,
      days_cost_lbp: item.days_cost_lbp,
      credits: item.credits,
    })
  ) {
    return resolveMaxReturnedCredits(
      item.credits as number,
      item.id != null
        ? catalogPricing.get(item.id)?.max_returned_credits_usd
        : undefined,
    );
  }
  const denomination = parseFloat(item.label);
  return isNaN(denomination) ? 0 : maxReturnableCredits(denomination);
}
