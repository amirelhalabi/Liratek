/**
 * Shared "who owes whom" colour rule — owner's rule, verbatim (2026-08-10):
 * "Positive account should be green, means shop owes the second party."
 *
 * This is a MEANING rule, not a sign rule: the raw field sign that means "the
 * shop owes the counterparty" is different on every balance page —
 *   - Debts:     NEGATIVE `netUsd`/`netLbp` (debt_ledger, signed amount).
 *   - Suppliers: POSITIVE `total_usd`/`total_lbp` (supplier_ledger, signed amount).
 *   - Partners:  NEGATIVE `usd`/`lbp` i.e. CREDIT-heavy (partner_ledger,
 *     unsigned `amount` + `direction` enum, plus a third USDT currency).
 *
 * Each page owns the (legitimately different) job of turning its own field(s)
 * into ONE normalized number where POSITIVE ALWAYS means "the shop owes the
 * counterparty" — that mapping stays local to the page, next to the ledger
 * comment that documents it. This module owns only the last, page-agnostic
 * step: normalized number -> bucket -> colour. Never call these with a raw
 * page field directly unless that page's positive sign already IS "shop owes"
 * (true for Suppliers only) — Debts and Partners must negate first.
 */

/** Default zero-tolerance for a signed money value that should read as
 *  "settled" once floating-point/partial-settlement residue is this small.
 *  Matches the threshold Suppliers' `signBucket` introduced (LIRA-129). */
export const BALANCE_EPS = 0.005;

export type BalanceBucket = "SHOP_OWES" | "COUNTERPARTY_OWES" | "SETTLED";

/**
 * Bucket a normalized signed amount (positive = shop owes the counterparty).
 * `|amount| <= eps` is treated as settled — a fully-paid/zero balance must
 * never render as a false debt (the exact-zero-renders-red bug this task
 * exists to close on Debts' detail chip and Suppliers' summary cards).
 */
export function balanceBucket(
  shopOwesAmount: number,
  eps: number = BALANCE_EPS,
): BalanceBucket {
  if (shopOwesAmount > eps) return "SHOP_OWES";
  if (shopOwesAmount < -eps) return "COUNTERPARTY_OWES";
  return "SETTLED";
}

/**
 * Combine two INDEPENDENT currencies' normalized amounts into one bucket for
 * a single shared visual (one icon, one border) — e.g. Partners' PartnerCard,
 * which shows a USD amount and an LBP amount side by side under one border
 * and one trend icon. Deliberately NOT "whichever is nonzero" (that is what
 * produced the OR-across-currency bug: a partner owed +$5 USD but owing
 * 100,000 LBP rendered an all-green card off the USD alone). When the two
 * currencies genuinely disagree (one says shop-owes, the other
 * counterparty-owes), there is no single correct colour for one shared icon —
 * returning SETTLED (neutral) is the non-lying choice, not a guess at which
 * currency "wins". Matches the tri-state shape Debts' own detail-balance
 * border already used (mixed => neutral), just epsilon'd and shared.
 */
export function combinedBalanceBucket(
  shopOwesAmountA: number,
  shopOwesAmountB: number,
  eps: number = BALANCE_EPS,
): BalanceBucket {
  const a = balanceBucket(shopOwesAmountA, eps);
  const b = balanceBucket(shopOwesAmountB, eps);
  if (a === b) return a;
  if (a === "SETTLED") return b;
  if (b === "SETTLED") return a;
  return "SETTLED"; // genuinely mixed — don't collapse to either side's colour
}

/** `text-*` class per bucket. One shade of green (`emerald-400`) — retires
 *  Suppliers' `green-400`, which was pure drift from Debts/Partners. */
export const BALANCE_TEXT_COLOR: Record<BalanceBucket, string> = {
  SHOP_OWES: "text-emerald-400",
  COUNTERPARTY_OWES: "text-red-400",
  SETTLED: "text-slate-400",
};

/** `border`+`bg` class per bucket, for card/chip containers (Partners'
 *  `balanceBorderColor`, Debts' detail-balance chip wrapper). */
export const BALANCE_BORDER_COLOR: Record<BalanceBucket, string> = {
  SHOP_OWES: "border-emerald-500/30 bg-emerald-900/10",
  COUNTERPARTY_OWES: "border-red-500/30 bg-red-900/10",
  SETTLED: "border-slate-700/50 bg-slate-800",
};

/** Convenience: normalized amount -> `text-*` class in one call. */
export function balanceTextColor(
  shopOwesAmount: number,
  eps: number = BALANCE_EPS,
): string {
  return BALANCE_TEXT_COLOR[balanceBucket(shopOwesAmount, eps)];
}

/** Convenience: normalized amount -> `border`+`bg` class in one call. */
export function balanceBorderColorClass(
  shopOwesAmount: number,
  eps: number = BALANCE_EPS,
): string {
  return BALANCE_BORDER_COLOR[balanceBucket(shopOwesAmount, eps)];
}
