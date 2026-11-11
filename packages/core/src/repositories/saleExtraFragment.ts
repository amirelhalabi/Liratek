/**
 * LIRA-319 — the extra-charge value fragments, in a LEAF module (no
 * repository imports) so both `ProfitRepository` (the Extra charges line,
 * the sale fully-paid gate) and `DebtRepository` (what a sale on the
 * account still owes, for repayment allocation) read ONE definition
 * (rule 14). `ProfitRepository` re-exports `extraChargeProfit` for its
 * existing importers.
 */

/**
 * The ONE definition of "an extra counts as profit": a sale/service row's
 * `amount_*` INCLUDES the extra the cashier added on top; its `profit_*`
 * EXCLUDES it, so every module margin (and the SALE row's derived kept
 * change) is unchanged. The extra is profit of its own, read from
 * `transactions.extra_usd` / `extra_lbp`, per currency, never converted.
 * REFUND / REFUND_UNDO rows carry the negated share, so a sum nets a refund
 * to 0; a VOIDED original is dropped by the `status` check like every other
 * profit row. `supported` = the v212 columns exist (a hand-rolled jest
 * schema without them reads 0). No bind params.
 */
export function extraChargeProfit(
  alias: string,
  currency: "usd" | "lbp",
  supported: boolean,
): string {
  if (!supported) return "0";
  return `(CASE WHEN ${alias}.status = 'ACTIVE' THEN COALESCE(${alias}.extra_${currency}, 0) ELSE 0 END)`;
}

/**
 * A sale's NET extra (its SALE row's extra plus any REFUND / REFUND_UNDO
 * share, via {@link extraChargeProfit}), in USD at the sale's snapshot rate.
 * `alias` is the `sales` row. `sales.final_amount_usd` EXCLUDES the extra
 * while the customer owes and pays `final_amount + extra`, so:
 *
 *  - the profit gate (`ProfitRepository.saleTotalPaidUsdEquiv`) takes it
 *    off the paid side — a $6 + $1 sale paid $6 reads $5 paid toward its
 *    $6, still owing $1 (core agent finding, 2026-10-14);
 *  - the repayment allocation (`DebtRepository._loadAllocationItems`) adds
 *    it to what the sale owes — a $6 + $1 sale on the account is open for
 *    $7, so repaying $7 marks it paid in full. Before this (2026-11-11) the
 *    allocation stopped at $6: `sales.paid_usd` never reached $7, the $1
 *    fell to the client's balance line, and the sale's margin and its extra
 *    stayed held forever.
 *
 * The unary `+` on the correlated `tenant_id` is REQUIRED (see
 * `ProfitRepository.saleExtraUsdEquiv`). No bind params.
 */
export function saleNetExtraUsdEquiv(
  alias: string,
  supported: boolean,
): string {
  if (!supported) return "0";
  return `COALESCE((SELECT SUM(${extraChargeProfit("sxt", "usd", true)}
                              + ${extraChargeProfit("sxt", "lbp", true)} / COALESCE(NULLIF(${alias}.exchange_rate_snapshot, 0), 1))
                     FROM transactions sxt
                     WHERE sxt.source_table = 'sales' AND sxt.source_id = ${alias}.id
                       AND +sxt.tenant_id = ${alias}.tenant_id), 0)`;
}
