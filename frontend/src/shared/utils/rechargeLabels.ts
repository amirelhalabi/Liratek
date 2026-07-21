/**
 * Recharge subtype → human label. Mirrors packages/core's own
 * RECHARGE_TYPE_LABELS/describeRechargeAmount/rechargeDetailLabel
 * (RechargeRepository.ts) — kept as a SEPARATE frontend copy since
 * frontend/src can never import from packages/core/repositories
 * (main-process only, pulls in better-sqlite3).
 */
export const RECHARGE_SUBTYPE_LABELS: Record<string, string> = {
  CREDIT_TRANSFER: "Credits",
  VOUCHER: "Voucher",
  DAYS: "Days",
  TOP_UP: "Top-up",
  ALFA_GIFT: "Gift",
};

/**
 * "what was actually recharged" detail, distinct from the price charged:
 * DAYS is denominated in days, TOP_UP has no separate face value, every
 * other subtype in the recharge's own dollar face value (e.g. "$6" MTC
 * credits).
 */
function describeRechargeAmount(type: string, amount: number): string {
  if (type === "DAYS") return `${amount} days`;
  if (type === "TOP_UP") return "";
  return `$${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

/** "<subtype label> <face value>", e.g. "Credits $6" — used on receipts. */
export function rechargeDetailLabel(type: string, amount: number): string {
  const label = RECHARGE_SUBTYPE_LABELS[type] ?? type;
  const amountDetail = describeRechargeAmount(type, amount);
  return amountDetail ? `${label} ${amountDetail}` : label;
}
