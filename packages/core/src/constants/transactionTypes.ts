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
  CUSTOM_SERVICE: "CUSTOM_SERVICE",
  MAINTENANCE: "MAINTENANCE",

  // Loto
  LOTO: "LOTO",
  LOTO_CASH_PRIZE: "LOTO_CASH_PRIZE",
  LOTO_SETTLEMENT: "LOTO_SETTLEMENT",
  LOTO_MONTHLY_FEE: "LOTO_MONTHLY_FEE",

  // Outflows
  EXPENSE: "EXPENSE",

  // Debt & supplier
  DEBT_REPAYMENT: "DEBT_REPAYMENT",
  SUPPLIER_PAYMENT: "SUPPLIER_PAYMENT",
  SUPPLIER_SETTLEMENT: "SUPPLIER_SETTLEMENT",

  // Closing / Opening
  CLOSING: "CLOSING",
  OPENING: "OPENING",

  // Reversal
  REFUND: "REFUND",

  // Non-financial entity events
  CLIENT_CREATED: "CLIENT_CREATED",
  CLIENT_UPDATED: "CLIENT_UPDATED",
  CLIENT_DELETED: "CLIENT_DELETED",
} as const;

export type TransactionType =
  (typeof TRANSACTION_TYPES)[keyof typeof TRANSACTION_TYPES];

export const TRANSACTION_STATUS = {
  ACTIVE: "ACTIVE",
  VOIDED: "VOIDED",
} as const;

export type TransactionStatus =
  (typeof TRANSACTION_STATUS)[keyof typeof TRANSACTION_STATUS];
