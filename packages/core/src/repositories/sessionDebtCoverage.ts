/**
 * LIRA-258 / G17 (owner decision 2026-10-06: "wait until the customer pays")
 * — the ONE definition (rule 14) of "how much of a debt_ledger charge row is
 * still waiting for the customer's repayment", shared by:
 *
 *   - `DebtRepository._coverServiceDebtsFIFO` — the repayment FIFO sweep
 *     (which rows are open, and how much each can absorb), and
 *   - `ProfitRepository.notDebtPending` — the profit debt hold (a session
 *     basket member's profit waits while its basket's 'Session Debt' row is
 *     open).
 *
 * For a module charge ('Recharge Debt', …) the outstanding amount is simply
 * `amount − covered` per currency. A 'Session Debt' row additionally nets:
 *
 *   - the basket's LIRA-232 item-refund credits ('Session Item Refund' rows,
 *     stored negative) of NON-SALE members only: refunding one basket item
 *     reduces what the customer owes on the basket without touching the
 *     charge row itself. A SALE member's refund credit is NOT netted — the
 *     sale's share of the row is already pre-covered at checkout (sales
 *     first, tracked by `sales.paid_usd`), so netting it too would count
 *     the sale's share twice and release the other items early (pinned by
 *     the "sale refund in a mixed basket" test). A non-SALE item refund's
 *     REFUND row sets `reverses_id` to the member it refunds (see
 *     `ProfitRepository.notReversedByRefund`'s finding-#8 note), which is
 *     how the member's type is read. (`undoSessionBasketItemRefund`'s
 *     re-charge rows only ever offset SALE credits — undo supports SALE
 *     members only — so they need no netting here either.)
 *
 * Only the ORIGINAL basket charge (`transaction_id IS NULL`) of a basket
 * that has not been wholly voided/refunded is coverable — a reversed
 * basket's charge must never sink a later repayment meant for the client's
 * other debts. "Wholly reversed" is the debt-side half of
 * `TransactionRepository.sessionBasketNotReversedSql` (LPAY-V1): a
 * 'Refund Reversal' row on the same session. For a basket that HAS a
 * 'Session Debt' row that half alone is exact — `_cancelSessionDebt` writes
 * one reversal row per Session Debt row on every whole-basket void/refund
 * (even at a 0 net) — and it keeps the fragment on `debt_ledger` only, so
 * it never joins `payments` from the ~40 profit queries that read it.
 *
 * Known approximations: an item-refund credit booked in the other currency
 * than the charge is netted in its own currency column only (that can only
 * DEFER profit). The item-refund netting assumes ONE original 'Session
 * Debt' row per basket (one checkout per session); were a session ever to
 * carry two, each would net the full credit — an early release.
 *
 * Every argument is a trusted SQL alias written by the caller, never user
 * input; the only literals interpolated are exported constants.
 */

import {
  REPAYMENT_COVERABLE_DEBT_TYPES,
  SESSION_DEBT_TYPE,
  SESSION_ITEM_REFUND_CREDIT_TYPE,
} from "../constants/transactionTypes.js";

/** USD / LBP "still open" epsilons — the same ones DBT-1 always used. */
export const COVERAGE_EPSILON_USD = 0.005;
export const COVERAGE_EPSILON_LBP = 1;

type CoverageCurrency = "usd" | "lbp";

/** `'A', 'B', …` for an IN list built from an exported constant. */
function sqlStringList(values: readonly string[]): string {
  return values.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ");
}

/** `IN (…)` list of every repayment-coverable debt type. */
export function repaymentCoverableTypesSqlList(): string {
  return sqlStringList(REPAYMENT_COVERABLE_DEBT_TYPES);
}

/**
 * Net item-refund credit of the row's basket in one currency column
 * (positive = owed less). 0 for a non-session row.
 */
function sessionItemRefundNetCreditSql(
  alias: string,
  currency: CoverageCurrency,
): string {
  return `CASE WHEN ${alias}.transaction_type = '${SESSION_DEBT_TYPE}' THEN COALESCE((
      SELECT -SUM(COALESCE(sir.amount_${currency}, 0)) FROM debt_ledger sir
      JOIN transactions sirt ON sirt.id = sir.transaction_id
      JOIN transactions sirm ON sirm.id = sirt.reverses_id
      WHERE sir.session_id = ${alias}.session_id
        AND sir.tenant_id = ${alias}.tenant_id
        AND sir.transaction_type = '${SESSION_ITEM_REFUND_CREDIT_TYPE}'
        AND sirm.type <> 'SALE'
    ), 0) ELSE 0 END`;
}

/** Amount of the row still waiting for repayment, in one currency column. */
export function coverageOutstandingSql(
  alias: string,
  currency: CoverageCurrency,
): string {
  return `(COALESCE(${alias}.amount_${currency}, 0) - COALESCE(${alias}.covered_${currency}, 0) - ${sessionItemRefundNetCreditSql(alias, currency)})`;
}

/**
 * The row is a repayment-coverable charge (its type is in
 * REPAYMENT_COVERABLE_DEBT_TYPES, not refunded, and — for 'Session Debt' —
 * the original charge of a basket that has not been wholly reversed).
 * Says nothing about whether it is still open; see {@link coverageOpenSql}.
 */
export function coverableChargeSql(alias: string): string {
  return `${alias}.transaction_type IN (${repaymentCoverableTypesSqlList()})
    AND COALESCE(${alias}.is_refunded, 0) = 0
    AND (${alias}.transaction_type <> '${SESSION_DEBT_TYPE}'
         OR (${alias}.transaction_id IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM debt_ledger srr
               WHERE srr.session_id = ${alias}.session_id
                 AND srr.transaction_type = 'Refund Reversal'
                 AND srr.tenant_id = ${alias}.tenant_id
             )))`;
}

/** The row still has an uncovered remainder in either currency. */
export function coverageOpenSql(alias: string): string {
  return `(${coverageOutstandingSql(alias, "usd")} > ${COVERAGE_EPSILON_USD}
       OR ${coverageOutstandingSql(alias, "lbp")} > ${COVERAGE_EPSILON_LBP})`;
}
