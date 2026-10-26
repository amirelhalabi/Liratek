/**
 * LIRA-343 (research R4) — day rows vs account rows.
 *
 * Classification is by PROVENANCE, not sign. A row is an **account row**
 * (sits on no calendar day; shown in the "OMT credit" line) when:
 *   - it is a LEDGER row a settlement wrote (`transaction_id` points at a
 *     `SUPPLIER_SETTLEMENT` transaction): overpay rows of either sign and the
 *     amount-first commission credit; or
 *   - it is a LEDGER manual Pay / Receive: no `source_ref_table`, entry type
 *     `PAYMENT` or `SUPPLIER_PAYS_US`; or
 *   - it is a supplier `DISCOUNT` (LIRA-345): it always rides on a manual Pay
 *     (linked to the Pay's ledger row, `source_ref_table = 'supplier_ledger'`,
 *     or unlinked when written before that link existed), so it is
 *     account-level like the Pay. A settlement's waive DISCOUNT is
 *     self-stamped and never listed (`isSettlementOwnRow`).
 * Every other row is a **day row**: FINANCIAL_SERVICE rows (incl. RECEIVEs),
 * LEDGER rows with a source link (OMT App cash-out = `PAYMENT` with
 * `source_ref_table = 'recharges'`), and TOP_UP / SALE_COST / RECORDED_DEBT /
 * STOCK_INTAKE / ADJUSTMENT rows.
 *
 * `rowScopeOf` is the JS side of the ONE rule (rule 14). Its SQL twin is
 * `accountRowScopeSql` in `repositories/SupplierRepository.ts` (the only SQL
 * copy; it carries the schema guards the queue needs). Keep the two
 * branch-for-branch identical. Not imported here: this file must stay a
 * browser-safe leaf.
 *
 * Pure leaf (rule 29): reachable from `browser.ts`, so no imports at all.
 */

export type AccountRowScope = "DAY" | "ACCOUNT";

export interface RowScopeInput {
  kind: "FINANCIAL_SERVICE" | "LEDGER";
  source_ref_table: string | null;
  /** LEDGER rows only (null for FINANCIAL_SERVICE rows). */
  entry_type: string | null;
  /** True when the row's `transaction_id` points at a SUPPLIER_SETTLEMENT
   *  transaction. Absent = false. */
  settlement_created?: boolean;
}

/** Ledger entry types a manual Pay / Receive writes. */
export const MANUAL_CASHFLOW_ENTRY_TYPES = [
  "PAYMENT",
  "SUPPLIER_PAYS_US",
] as const;

export function rowScopeOf(row: RowScopeInput): AccountRowScope {
  if (row.kind === "FINANCIAL_SERVICE") return "DAY";
  // Checked before the source link: a settlement-created row is an account
  // row whatever else it carries (today `addLedgerEntry` refuses a
  // transaction_id together with a source_ref, so the order is defensive).
  if (row.settlement_created === true) return "ACCOUNT";
  // LIRA-345 — before the source link: a Pay's DISCOUNT is linked to it.
  if (row.entry_type === "DISCOUNT") return "ACCOUNT";
  if (row.source_ref_table) return "DAY";
  if (
    row.entry_type !== null &&
    (MANUAL_CASHFLOW_ENTRY_TYPES as readonly string[]).includes(row.entry_type)
  ) {
    return "ACCOUNT";
  }
  return "DAY";
}

/**
 * LIRA-344, rule 14 — THE "can this row be removed as an OMT credit" rule,
 * shared by the Settle Account sheet (which rows get a "Remove credit"
 * button) and `SupplierRepository.removeAccountCredit` (which refuses every
 * other row): an open LEDGER row on the account (`row_scope 'ACCOUNT'`,
 * on no day) whose remaining is a credit — negative in at least one
 * currency (OMT owes the shop) and positive in none. Amounts compared in
 * minor units (cents / whole LBP).
 */
export function isRemovableAccountCredit(row: {
  kind: string;
  row_scope: AccountRowScope;
  remaining_usd: number;
  remaining_lbp: number;
}): boolean {
  if (row.kind !== "LEDGER" || row.row_scope !== "ACCOUNT") return false;
  const usd = Math.round(row.remaining_usd * 100);
  const lbp = Math.round(row.remaining_lbp);
  return usd <= 0 && lbp <= 0 && (usd < 0 || lbp < 0);
}
