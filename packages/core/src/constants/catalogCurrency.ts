/**
 * LIRA-324 — which mobile-service catalog items can be sold in which currency.
 *
 * One definition for the Whish App Bills grid, Settings and tests (rule 14).
 * Pure, no imports: it is exported from `browser.ts` (rule 29).
 *
 * - USD: the item needs a USD cost and a USD selling price above zero. MTC /
 *   Alfa Prepaid cards never sell in USD in this release — their "only days"
 *   / credits-back handling is LBP-only (owner decision 2026-10-15,
 *   docs/plans/todo_plans/WHISH_USD_PREPAID_CARDS.md).
 * - LBP: everything that showed before USD prices existed stays visible; only
 *   USD-only items (no LBP price at all, a USD price set) are hidden.
 */

export type CatalogCurrency = "LBP" | "USD";

export interface CatalogPrices {
  category: string;
  subcategory: string;
  cost_lbp: number;
  sell_lbp: number;
  cost_usd?: number | null;
  sell_usd?: number | null;
}

function isPrepaidCard(item: Pick<CatalogPrices, "category" | "subcategory">) {
  const category = item.category.trim().toLowerCase();
  return (
    (category === "mtc" || category === "alfa") &&
    item.subcategory.trim().toLowerCase() === "prepaid"
  );
}

export function isUsdSellable(item: CatalogPrices): boolean {
  return (
    (item.cost_usd ?? 0) > 0 && (item.sell_usd ?? 0) > 0 && !isPrepaidCard(item)
  );
}

export function isLbpSellable(item: CatalogPrices): boolean {
  const usdOnly =
    item.cost_lbp === 0 && item.sell_lbp === 0 && (item.cost_usd ?? 0) > 0;
  return !usdOnly;
}
