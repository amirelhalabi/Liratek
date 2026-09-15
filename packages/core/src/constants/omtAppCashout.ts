/**
 * OMT App wallet cashout commission ("Cash Out to OMT")
 *
 * OMT_OPEN_CREDIT_ACCOUNT_PLAN.md §8 (LIRA-192, D10-D15). The mirror of the
 * OMT App wallet's credit top-up (`RechargeRepository.topUpFromSupplier`):
 * cashing out moves value OUT of the `OMT_App` drawer and credits the OMT
 * open-credit account with the principal PLUS a 0.1% commission — no
 * physical cash moves in either direction (D2), and no currency conversion
 * is ever involved: a USD cashout credits USD, an LBP cashout credits LBP,
 * at the SAME percentage (D13).
 */

import { roundMoneyForCurrency } from "../utils/omtFees.js";

/**
 * The OMT App cashout's own commission rate — a SEPARATE, independently
 * changeable constant from `OMT_COMMISSION_RATES.OMT_WALLET`
 * (`utils/omtFees.ts`), which is the OMT COUNTER's wallet-service commission
 * rate. Both happen to be 0.1% today; that is a coincidence of the current
 * business rules, not a shared one — changing the counter's rate must NOT
 * silently change this one, and vice versa (D13). Not yet a per-tenant
 * setting; a small follow-up if OMT ever changes the percentage (plan
 * §8.3).
 */
export const OMT_APP_CASHOUT_COMMISSION_RATE = 0.001;

/**
 * The shop's earning on an OMT App cashout: `amount × 0.1%`, rounded with
 * the shared currency-aware money-rounding helper (`roundMoneyForCurrency`)
 * — never a fresh `.toFixed(n)` and never the magic number re-spelled at a
 * call site (rule 14). Always non-negative; `amount`'s sign is ignored (a
 * cashout amount is always a positive magnitude by the time it reaches
 * here — see `RechargeRepository.cashoutToSupplier`'s own `Math.abs`).
 *
 * Per D14 (plan §8.3a): this commission is KNOWN and stored at cashout
 * time, but its PROFIT is recognised later, at OMT account settlement
 * (LIRA-189, wave 2) — this function only computes the figure; it stamps
 * nothing.
 */
export function omtAppCashoutCommission(
  amount: number,
  currency: string,
): number {
  return roundMoneyForCurrency(
    Math.abs(amount) * OMT_APP_CASHOUT_COMMISSION_RATE,
    currency,
  );
}
