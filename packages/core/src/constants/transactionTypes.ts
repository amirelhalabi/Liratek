/**
 * Unified Transaction Type Constants
 *
 * These map 1:1 to the `type` column in the `transactions` table.
 * Under the accounting journal pattern, deletions create a new transaction
 * with `reverses_id` pointing to the original and negated amounts — no
 * separate "DELETED" types needed.
 */

export const TRANSACTION_TYPES = {
  // Revenue modules
  SALE: "SALE",
  FINANCIAL_SERVICE: "FINANCIAL_SERVICE",
  EXCHANGE: "EXCHANGE",
  RECHARGE: "RECHARGE",
  RECHARGE_TOPUP: "RECHARGE_TOPUP",
  MTC_TOPUP: "MTC_TOPUP",
  ALFA_TOPUP: "ALFA_TOPUP",
  CUSTOM_SERVICE: "CUSTOM_SERVICE",
  MAINTENANCE: "MAINTENANCE",

  // Loto
  LOTO: "LOTO",
  LOTO_CASH_PRIZE: "LOTO_CASH_PRIZE",
  LOTO_SETTLEMENT: "LOTO_SETTLEMENT",
  LOTO_MONTHLY_FEE: "LOTO_MONTHLY_FEE",

  // Outflows
  EXPENSE: "EXPENSE",

  // Drawer adjustments
  DRAWER_TOPUP: "DRAWER_TOPUP",

  // Hold Money (cash held on behalf of a client, returned on collection)
  HOLD_MONEY: "HOLD_MONEY",
  HOLD_MONEY_COLLECT: "HOLD_MONEY_COLLECT",

  // Debt & supplier
  DEBT_REPAYMENT: "DEBT_REPAYMENT",
  CREDIT_CASH_OUT: "CREDIT_CASH_OUT",
  // Manual, till-moving account entries from the Accounts (Debts) page:
  // CREDIT_CASH_IN — customer hands the shop cash to hold as credit (drawer IN);
  // DEBT_CASH_OUT — shop gives the customer cash as an advance/loan (drawer OUT).
  CREDIT_CASH_IN: "CREDIT_CASH_IN",
  DEBT_CASH_OUT: "DEBT_CASH_OUT",
  /** T3 keep-change on a session basket: a standalone profit-only row
   *  (amount 0 — the tender is booked by the basket's payment legs). */
  KEPT_CHANGE: "KEPT_CHANGE",
  SUPPLIER_PAYMENT: "SUPPLIER_PAYMENT",
  SUPPLIER_SETTLEMENT: "SUPPLIER_SETTLEMENT",
  /** PFT-6b: a Partners-page settlement's money movement — the drawer leg
   *  (CASH→General etc.) that squares the partner's balance. */
  PARTNER_SETTLEMENT: "PARTNER_SETTLEMENT",

  // Closing / Checkpoint
  CHECKPOINT: "CHECKPOINT",

  // Reversal
  REFUND: "REFUND",

  // Non-financial entity events
  CLIENT_CREATED: "CLIENT_CREATED",
  CLIENT_UPDATED: "CLIENT_UPDATED",
  CLIENT_DELETED: "CLIENT_DELETED",
} as const;

export type TransactionType =
  (typeof TRANSACTION_TYPES)[keyof typeof TRANSACTION_TYPES];

/**
 * Types that voidTransaction/refundTransaction must REFUSE (enforced in the
 * repository so no IPC caller can bypass it). Each would leave side effects
 * the generic reversal cannot undo — blocking beats corrupting:
 * - LOTO / LOTO_CASH_PRIZE: their supplier_ledger rows (ticket TOP_UP carries
 *   no transaction link) and checkpoint totals are never reversed, so the
 *   loto settle-to-zero reconciliation would break.
 * - LOTO_SETTLEMENT / SUPPLIER_SETTLEMENT: settlement stamps
 *   (financial_services.settlement_id, checkpoint is_settled) stay in place,
 *   and the commission credit to General has no payments row to reverse.
 * - RECHARGE_TOPUP: the provider-drawer credit has no payments row either.
 * - REFUND: reversing a reversal double-moves the drawers.
 * - CREDIT_CASH_OUT: the generic reversal does not restore the CREDIT_USED
 *   debt_ledger row, so voiding would return the cash without restoring the
 *   client's credit.
 * - CREDIT_CASH_IN / DEBT_CASH_OUT: the generic reversal moves the drawer back
 *   but does NOT undo the debt_ledger row, so voiding would correct the till
 *   while leaving the client balance wrong. Reverse via the opposite manual
 *   entry (Add Debt cancels an Add Credit and vice versa) — which also corrects
 *   the till.
 */
export const NON_REVERSIBLE_TRANSACTION_TYPES: ReadonlySet<TransactionType> =
  new Set<TransactionType>([
    TRANSACTION_TYPES.LOTO,
    TRANSACTION_TYPES.LOTO_CASH_PRIZE,
    TRANSACTION_TYPES.LOTO_SETTLEMENT,
    TRANSACTION_TYPES.SUPPLIER_SETTLEMENT,
    TRANSACTION_TYPES.RECHARGE_TOPUP,
    TRANSACTION_TYPES.REFUND,
    TRANSACTION_TYPES.CREDIT_CASH_OUT,
    TRANSACTION_TYPES.CREDIT_CASH_IN,
    TRANSACTION_TYPES.DEBT_CASH_OUT,
    // KEPT_CHANGE (T3): profit-only row with no money movement of its own —
    // the tender lives in the basket's payment legs on the item rows, so a
    // standalone void would desync profit from money. Rule-20 reversal owner:
    // none needed (the kept cash physically stays in the drawer regardless).
    TRANSACTION_TYPES.KEPT_CHANGE,
    // PARTNER_SETTLEMENT (PFT-6b): the generic reversal would restore the
    // drawer + partner_ledger rows but NOT the FIFO covered_amount stamps the
    // settlement applied to FOR_% rows (profit recognition would stay
    // realized on a voided settlement). Rule-20 owner: correct a
    // mis-settlement with an opposite manual settlement/adjustment on the
    // Partners page.
    TRANSACTION_TYPES.PARTNER_SETTLEMENT,
  ]);

/**
 * debt_ledger.transaction_type values that book a MODULE CHARGE against a
 * client's account (CUSTOMER_ACCOUNT / partial-payment shortfall), linked to
 * the unified transaction via debt_ledger.transaction_id = transactions.id.
 *
 * This is the exact set the generic void/refund path must reverse
 * (TransactionRepository._cancelDebt) — and nothing else. It must stay a
 * whitelist: 'Repayment' rows also carry a transaction_id (back-linked to
 * their DEBT_REPAYMENT transaction) and negating one would un-pay a debt;
 * 'CREDIT_DEPOSIT'/'CREDIT_USED'/'Manual Debt' rows are manual-ledger entries
 * with no transaction linkage. 'Session Debt' is deliberately absent: it
 * links via session_id (transaction_id NULL) and is reversed by the session
 * flow, not the generic path.
 */
export const MODULE_DEBT_TRANSACTION_TYPES: readonly string[] = [
  "Sale Debt",
  "Recharge Debt",
  "Service Debt",
  "Custom Service Debt",
  "Loto Debt",
  "Maintenance Debt",
];

export const TRANSACTION_STATUS = {
  ACTIVE: "ACTIVE",
  VOIDED: "VOIDED",
} as const;

export type TransactionStatus =
  (typeof TRANSACTION_STATUS)[keyof typeof TRANSACTION_STATUS];
