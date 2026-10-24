import type { TransactionType } from "@liratek/core/constants/transactionTypes";

/**
 * Dot colour per transaction type on the Activity list. Same hue families as
 * the web Transactions page (frontend/src/features/audit/transactionPresentation.ts),
 * one mid shade per family so the dot reads on both the light and dark theme.
 * Typed against core's union: a new transaction type is a compile error here
 * until it gets a colour.
 */
const GREEN = "#22c55e";
const BLUE = "#3b82f6";
const YELLOW = "#eab308";
const SLATE = "#64748b";
const PURPLE = "#a855f7";
const VIOLET = "#8b5cf6";
const ROSE = "#f43f5e";
const CYAN = "#06b6d4";
const AMBER = "#f59e0b";
const LIME = "#84cc16";
const RED = "#ef4444";
const ORANGE = "#f97316";
const EMERALD = "#10b981";
const INDIGO = "#6366f1";
const SKY = "#0ea5e9";
const FUCHSIA = "#d946ef";
const TEAL = "#14b8a6";

const TYPE_COLORS: Record<TransactionType, string> = {
  SALE: GREEN,
  FINANCIAL_SERVICE: BLUE,
  EXCHANGE: YELLOW,
  WALLET_EXCHANGE: YELLOW,
  TELECOM_SELF_CHARGE: SLATE,
  TELECOM_CREDIT_BUYBACK: SLATE,
  // LIRA-312 — credits sent back for a wrong-number card.
  WRONG_NUMBER_CREDITS: VIOLET,
  DRAWER_TRANSFER: SLATE,
  RECHARGE: PURPLE,
  CARRIER_LINE_ADJUSTMENT: VIOLET,
  LINE_RECHARGE: VIOLET,
  // LIRA-337 — credit given back from a line for sale to a shop line.
  LINE_CREDIT_GIVE_BACK: VIOLET,
  RECHARGE_TOPUP: PURPLE,
  WALLET_CASHOUT: ROSE,
  MTC_TOPUP: VIOLET,
  ALFA_TOPUP: VIOLET,
  CUSTOM_SERVICE: CYAN,
  MAINTENANCE: AMBER,
  LOTO: LIME,
  LOTO_CASH_PRIZE: LIME,
  LOTO_SETTLEMENT: LIME,
  LOTO_MONTHLY_FEE: LIME,
  EXPENSE: RED,
  EXPENSE_INVENTORY: RED,
  EXPENSE_KATSH: RED,
  EXPENSE_IPICK: RED,
  EXPENSE_WHISH_APP: RED,
  DRAWER_TOPUP: SLATE,
  DRAWER_CASHOUT: ROSE,
  HOLD_MONEY: ORANGE,
  HOLD_MONEY_COLLECT: ORANGE,
  HOLD_MONEY_COLLECT_VOID: ORANGE,
  // LIRA-339: gift-card sales and cancels share the Hold Money colour (money held for a customer).
  VOUCHER_SALE: ORANGE,
  VOUCHER_CANCEL: ORANGE,
  DEBT_REPAYMENT: EMERALD,
  CREDIT_CASH_OUT: SLATE,
  CREDIT_CASH_IN: EMERALD,
  DEBT_CASH_OUT: ROSE,
  KEPT_CHANGE: SLATE,
  EXTRA_CHARGE: SLATE,
  WAIVED_SHORTFALL: SLATE,
  WARRANTY_COST: AMBER,
  SUPPLIER_PAYMENT: INDIGO,
  SUPPLIER_SETTLEMENT: INDIGO,
  PARTNER_SETTLEMENT: SKY,
  PARTNER_PAYMENT: SKY,
  PARTNER_ADJUSTMENT: SKY,
  ACCOUNT_ADJUSTMENT: EMERALD,
  SUPPLIER_ADJUSTMENT: INDIGO,
  SUPPLIER_STOCK_INTAKE: INDIGO,
  SUPPLIER_RECORDED_DEBT: INDIGO,
  COUNTERPARTY_DISCOUNT: FUCHSIA,
  CHECKPOINT: SLATE,
  REFUND: ROSE,
  REFUND_UNDO: AMBER,
  CLIENT_CREATED: TEAL,
  CLIENT_UPDATED: TEAL,
  CLIENT_DELETED: TEAL,
};

/** Unknown (legacy or hand-written) type: neutral slate. */
export function typeColor(type: string): string {
  return (TYPE_COLORS as Record<string, string>)[type] ?? SLATE;
}
