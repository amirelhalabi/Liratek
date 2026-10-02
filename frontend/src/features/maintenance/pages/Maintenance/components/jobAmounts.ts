/**
 * List price vs amount actually charged for a maintenance job (LIRA-185 D6,
 * owner decision 2026-10-02).
 *
 * The reports book a discounted job at its FINAL amount; the page used to show
 * only the list price. This is the ONE place that decides which labour figure
 * each side is, so the jobs list and the History window cannot disagree.
 *
 * Stored shape (MaintenanceService.saveJob):
 *   - USD job: `price_usd` is labour-only; `final_amount_usd` is labour final
 *     PLUS `parts_price_usd` (the service folds parts in).
 *   - LBP job: `price_lbp` / `final_amount_lbp` are both labour-only; parts
 *     ride separately in USD and are never discounted.
 *   - A discount only exists once a job is checked out, so only a
 *     Delivered/Delivered_Paid job is compared. Drafts/unpaid jobs carry
 *     final = price (or a stale 0) and always show the list price alone.
 */
export interface JobPriceFields {
  status?: string;
  currency?: string;
  price_usd?: number;
  price_lbp?: number;
  final_amount_usd?: number;
  final_amount_lbp?: number;
  parts_price_usd?: number;
}

export interface LabourAmounts {
  currency: "USD" | "LBP";
  /** Labour list price, in the job currency. */
  list: number;
  /** Labour amount actually charged, in the job currency. */
  charged: number;
  /** True only when the two genuinely differ. */
  discounted: boolean;
}

const PAID_STATUSES: ReadonlySet<string> = new Set([
  "Delivered",
  "Delivered_Paid",
]);

/** Below this, two amounts are the same number (float noise / LBP rounding). */
const EPSILON: Record<"USD" | "LBP", number> = { USD: 0.005, LBP: 0.5 };

export function getLabourAmounts(job: JobPriceFields): LabourAmounts {
  const currency: "USD" | "LBP" = job.currency === "LBP" ? "LBP" : "USD";
  const list = currency === "LBP" ? (job.price_lbp ?? 0) : (job.price_usd ?? 0);
  const rawFinal =
    currency === "LBP" ? job.final_amount_lbp : job.final_amount_usd;

  const isPaid = PAID_STATUSES.has(job.status ?? "");
  if (!isPaid || rawFinal == null) {
    return { currency, list, charged: list, discounted: false };
  }

  const charged =
    currency === "LBP"
      ? rawFinal
      : Math.max(0, rawFinal - (job.parts_price_usd ?? 0));
  return {
    currency,
    list,
    charged,
    discounted: Math.abs(list - charged) >= EPSILON[currency],
  };
}
