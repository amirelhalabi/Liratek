/**
 * Facts about a row that more than one cell needs, derived ONCE per row.
 *
 * Kept out of `components/TransactionCells.tsx` because a module may export
 * components or plain functions, not both. The point of deriving here rather
 * than inside each cell is that all five of these parse the SAME
 * `metadata_json` string — the old buildTr computed them once and its cells
 * shared them; splitting the cells up must not quietly turn that into five
 * parses per row per render.
 */
import { saleTenderTotals } from "./cashFlow";
import {
  billsOnlyCommissionAmount,
  getSplitGroupInfo,
  isProviderBalanceInflow,
  isSignedPartnerType,
  isSupplierCredit,
} from "./transactionDisplay";
import type { TransactionRow } from "./hooks/useTransactionRows";

/** Row facts that several cells need. Derived once per row per render so the
 *  same `metadata_json` string isn't parsed by each cell in turn. */
export type RowDerived = {
  /** Cashless supplier credit (a receivable, not drawer cash). */
  credit: boolean;
  /** PARTNER_* rows carry a SIGNED amount; the sign is direction, not value. */
  partnerSigned: boolean;
  /** For a SALE: what the customer actually handed over. */
  tender: { usd: number; lbp: number } | null;
  /** Set when the row is one unit of a multi-unit split checkout. */
  splitGroup: { groupId: string; units: number | null } | null;
  /** Bills-only settlement commission, unreachable via `row.payments`. */
  commissionAmount: { usd: number; lbp: number } | null;
  /** LIRA-140: the row's money landed in a provider balance, not a till. */
  providerBalance: boolean;
  /**
   * LIRA-201b (owner note #11-B) — true when this row is the ONE row of its
   * session currently chosen to carry the pooled in/out + payment detail
   * (`../sessionGroupHeaders.ts` picks it from whichever members are
   * actually visible, so the choice survives sorting/filtering/the fetch
   * window). Always false for a non-session row.
   *
   * Unlike every other `RowDerived` field, this is NOT derived from `row`
   * alone — the choice depends on the whole visible set, so the caller
   * (`TransactionsViewer`) computes it and passes it in via `deriveRow`'s
   * second argument. It is bundled onto `RowDerived` anyway so
   * `SummaryCell`/`MethodCell` need only the one `derived` prop they
   * already receive, not a second prop threaded through separately.
   */
  isGroupHeader: boolean;
};

export function deriveRow(
  row: TransactionRow,
  isGroupHeader = false,
): RowDerived {
  return {
    credit: isSupplierCredit(row.type, row.metadata_json),
    partnerSigned: isSignedPartnerType(row.type),
    tender: saleTenderTotals(row.type, row.payments),
    splitGroup: getSplitGroupInfo(row.metadata_json),
    commissionAmount: billsOnlyCommissionAmount(row),
    providerBalance: isProviderBalanceInflow(row),
    isGroupHeader,
  };
}
