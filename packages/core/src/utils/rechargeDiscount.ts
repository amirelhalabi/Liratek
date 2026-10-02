/**
 * LIRA-185 owner decision #1 (2026-10-02) — the MTC/Alfa payment-sheet
 * discount policy, in ONE place (rule 14). Pure: no DB, no Node built-ins
 * (safe for `browser.ts` to reach, rule 29), so the page's `maxDiscount`
 * and the repository's server-side cap can share it.
 *
 * The discount lowers the price ACTUALLY charged. It is capped at the
 * margin (`listPrice − cost`) so a discount can bring the profit to zero
 * but never below — the repository re-checks this, because the REST route
 * is directly callable and a client-side clamp alone is not a guarantee.
 *
 * Shape mirrors POS (`sales.discount` + `final_amount`): the caller sends
 * the LIST price plus the discount; every money figure downstream (the
 * recharges row, the transaction amount, leg reconciliation, the debt
 * remainder, the profit stamp) uses the charged price.
 *
 * Follow-up (2026-10-02, owner decision #1 continued): a CREDIT_TRANSFER
 * sale ALSO books its own `SMS_Transfer_Fee` expense
 * (`RechargeRepository.processRecharge`, `utils/telecomCredit.ts`'s
 * `planSmsTransfer`) on top of `cost`. A discount at the plain margin nets a
 * LOSS equal to that fee, so the cap must subtract it too — `extraFee`,
 * already converted to the sale's own currency by the caller (the LBP
 * figure the sheet/repository actually works in; this function does no
 * currency conversion itself, rule 14 keeps that one conversion where the
 * sale's own rate lives). Types with no such fee (DAYS, VOUCHER, ALFA_GIFT,
 * SHOP_LINE_USE, …) pass `extraFee` as 0 (the default) and keep the plain
 * margin, unchanged.
 */

/**
 * Largest discount allowed on a sale: its margin minus any extra fee the
 * sale itself burns (e.g. the CREDIT_TRANSFER SMS cost), never negative.
 */
export function maxRechargeDiscount(
  listPrice: number,
  cost: number,
  extraFee: number = 0,
): number {
  return Math.max(0, listPrice - cost - extraFee);
}

export type RechargeDiscountResult =
  | { ok: true; chargedPrice: number; discount: number }
  | { ok: false; error: string };

/**
 * Validates a requested discount and returns the price to charge.
 * `discount` absent or 0 → the list price unchanged. `extraFee` — see
 * {@link maxRechargeDiscount} — shrinks the cap for sale types that burn an
 * extra fee on top of `cost` (CREDIT_TRANSFER's SMS cost); 0 for every other
 * type, unchanged behavior.
 */
export function applyRechargeDiscount(
  listPrice: number,
  cost: number,
  discount: number | undefined,
  extraFee: number = 0,
): RechargeDiscountResult {
  const d = discount ?? 0;
  if (!(d > 0)) return { ok: true, chargedPrice: listPrice, discount: 0 };
  const max = maxRechargeDiscount(listPrice, cost, extraFee);
  // Tiny tolerance for float noise only — the sheet clamps to exactly `max`.
  if (d > max + 1e-6) {
    return {
      ok: false,
      error: `Discount ${d.toLocaleString()} is larger than this sale's margin${extraFee > 0 ? " after its SMS transfer fee" : ""} (${max.toLocaleString()}) — a discount cannot make the sale a loss`,
    };
  }
  return { ok: true, chargedPrice: listPrice - d, discount: d };
}
