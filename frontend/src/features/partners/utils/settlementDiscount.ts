/**
 * Partner settle discount — LIRA-372 (owner 2026-11-05): thin wrappers over
 * the ONE core helper (`settleDiscountRoom` / `clampSettleDiscount` /
 * `settleDiscountOverpaid`, rule 14), shared by Partners "Settle by amount"
 * and the by-day sheet.
 *
 * The room is measured BEFORE the payment (research R2): min($5 / 450,000
 * LBP, what is owed in this currency). The payment line follows the
 * discount (payment = owed − discount), so a room measured after the
 * payment would shrink as the discount grows and lock itself at 0 — the
 * pre-LIRA-372 "room left after the settlement" meaning is gone. Confirm is
 * blocked instead when the cashier edits the payment AFTER the discount so
 * that payment + discount exceeds what is owed (`partnerDiscountOverpaid`).
 */
import {
  clampSettleDiscount,
  settleDiscountOverpaid,
  settleDiscountRoom,
} from "@liratek/core";

export type PartnerSettleCurrency = "USD" | "LBP";

/** Most the Discount line accepts: min(cap, owed), ≥ 0. */
export function partnerDiscountRoom(
  currency: PartnerSettleCurrency,
  owedInCurrency: number,
): number {
  return settleDiscountRoom(currency, owedInCurrency);
}

/** The discount actually applied for a typed amount (rounded, ≤ room). */
export function capPartnerDiscount(
  currency: PartnerSettleCurrency,
  owedInCurrency: number,
  typed: number,
): number {
  return clampSettleDiscount(currency, typed, owedInCurrency).applied;
}

/** True when payment + discount exceeds what is owed (blocks Confirm). */
export function partnerDiscountOverpaid(
  currency: PartnerSettleCurrency,
  owedInCurrency: number,
  paid: number,
  discount: number,
): boolean {
  return (
    discount > 0 &&
    settleDiscountOverpaid(currency, owedInCurrency, paid, discount)
  );
}
