/**
 * The ONE "which SALE row does this sale-item refund belong to" SQL
 * expression (rule 14). A sale item refund (POS "Refund item", a warranty
 * refund, a session-basket item refund) and its undo carry NO `reverses_id`
 * — `reverses_id` means "this whole transaction was reversed" to every void/
 * refund guard and to `reversed_by_id` — so the link to the sale goes
 * through `source_table = 'sales'` / `source_id` instead: the OLDEST `SALE`
 * row of that sale (`MIN(o.id)`; see `ProfitRepository`'s
 * `refundOriginalJoin` doc for why the oldest).
 *
 * Shared by `ProfitRepository`'s refund-original join and
 * `TransactionRepository.getRecent`'s `item_refund_of_id`. A leaf module
 * with no repository import, so both can use it without a require cycle
 * (same reason as `reportingTimeFragments.ts`). No bind params — the
 * subquery reads the outer row's own `tenant_id`.
 *
 * `typesSql` is the quoted, comma-separated list of row types the link
 * applies to (e.g. `'REFUND'`); NULL for any other row.
 */
export function saleItemRefundOriginalIdSql(
  alias: string,
  typesSql: string,
): string {
  return `CASE WHEN ${alias}.type IN (${typesSql}) AND ${alias}.source_table = 'sales' THEN (
            SELECT MIN(o.id) FROM transactions o
            WHERE o.tenant_id = ${alias}.tenant_id
              AND o.source_table = 'sales'
              AND o.source_id = ${alias}.source_id
              AND o.type = 'SALE'
          ) END`;
}
