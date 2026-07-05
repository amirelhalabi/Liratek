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
  SUPPLIER_PAYMENT: "SUPPLIER_PAYMENT",
  SUPPLIER_SETTLEMENT: "SUPPLIER_SETTLEMENT",

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
  ]);

export const TRANSACTION_STATUS = {
  ACTIVE: "ACTIVE",
  VOIDED: "VOIDED",
} as const;

export type TransactionStatus =
  (typeof TRANSACTION_STATUS)[keyof typeof TRANSACTION_STATUS];
