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
import { formatMoneyAmount } from "@liratek/core";
import {
  billsOnlyCommissionAmount,
  checkpointPhysicalTotals,
  displayAmountFields,
  formatAmount,
  getSplitGroupInfo,
  isProviderBalanceInflow,
  isSignedAmountType,
  isSupplierCredit,
} from "./transactionDisplay";
import type { TransactionRow } from "./hooks/useTransactionRows";

/** Row facts that several cells need. Derived once per row per render so the
 *  same `metadata_json` string isn't parsed by each cell in turn. */
export type RowDerived = {
  /** Cashless supplier credit (a receivable, not drawer cash). */
  credit: boolean;
  /** PARTNER_* and CARRIER_LINE_ADJUSTMENT rows carry a SIGNED amount; the
   *  sign is direction, not value (see `isSignedAmountType`). */
  partnerSigned: boolean;
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
    partnerSigned: isSignedAmountType(row.type),
    splitGroup: getSplitGroupInfo(row.metadata_json),
    commissionAmount: billsOnlyCommissionAmount(row),
    providerBalance: isProviderBalanceInflow(row),
    isGroupHeader,
  };
}

/**
 * The Amount column's text for a row — ONE definition shared by
 * `AmountCell` and the Details panel, so the two never show different
 * figures for the same transaction: a checkpoint's counted totals, a
 * bills-only commission, a credit / signed partner row as its magnitude
 * (the sign is direction), else the signed transaction amount (a
 * void/refund reads "−$4.25"; never the tender — production test
 * 2026-10-07, see `displayAmountFields`).
 */
export function amountCellText(
  row: TransactionRow,
  derived: RowDerived,
): string {
  if (row.type === "CHECKPOINT") {
    const totals = checkpointPhysicalTotals(row.metadata_json);
    return formatAmount(
      totals?.usd ?? row.amount_usd,
      totals?.lbp ?? row.amount_lbp,
      null,
    );
  }
  const special = forgivenAmountText(row) ?? exchangeAmountText(row);
  if (special) return special;
  const { credit, partnerSigned, commissionAmount } = derived;
  const value = displayAmountFields(row);
  return formatAmount(
    commissionAmount?.usd ??
      (credit || partnerSigned ? Math.abs(value.usd) : value.usd),
    commissionAmount?.lbp ??
      (credit || partnerSigned ? Math.abs(value.lbp) : value.lbp),
    row.metadata_json,
    row.type,
  );
}

function parseMeta(row: TransactionRow): Record<string, unknown> | null {
  if (!row.metadata_json) return null;
  try {
    const m: unknown = JSON.parse(row.metadata_json);
    return typeof m === "object" && m !== null && !Array.isArray(m)
      ? (m as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * A write-off / discount row (COUNTERPARTY_DISCOUNT) carries 0 / 0 — no
 * cash moves, the value is in profit (CQ-10) — so its Amount read "—". The
 * amount forgiven is saved on the row's counterparty (shop-day test
 * 2026-10-16): "$15 forgiven".
 */
function forgivenAmountText(row: TransactionRow): string | null {
  if (row.type !== "COUNTERPARTY_DISCOUNT") return null;
  if (row.amount_usd || row.amount_lbp) return null;
  const cp = parseMeta(row)?.counterparty as
    | { discount?: { amount_usd?: unknown; amount_lbp?: unknown } }
    | undefined;
  const usd = Number(cp?.discount?.amount_usd) || 0;
  const lbp = Number(cp?.discount?.amount_lbp) || 0;
  if (!usd && !lbp) return null;
  return `${formatAmount(usd, lbp)} forgiven`;
}

/**
 * An exchange shows what the customer gave and got — "50 EUR → 5,162,000
 * LBP" — like its summary. Its amount columns could not: a cross exchange
 * (EUR → LBP via USD) stores a $1 rounding residue and the LBP paid out,
 * which read "$1 + −5,162,000 LBP" (shop-day test 2026-10-16). Originals
 * only: a void/refund keeps the signed amount.
 */
function exchangeAmountText(row: TransactionRow): string | null {
  if (row.type !== "EXCHANGE" || row.reverses_id != null) return null;
  const m = parseMeta(row);
  const from = m?.from_currency;
  const to = m?.to_currency;
  const amountIn = m?.amount_in;
  const amountOut = m?.amount_out;
  if (
    typeof from !== "string" ||
    typeof to !== "string" ||
    typeof amountIn !== "number" ||
    typeof amountOut !== "number"
  ) {
    return null;
  }
  return `${formatMoneyAmount(amountIn, from)} → ${formatMoneyAmount(amountOut, to)}`;
}
