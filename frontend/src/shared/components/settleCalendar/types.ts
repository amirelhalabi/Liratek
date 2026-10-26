/**
 * LIRA-343: prop types for the generic settle calendar.
 *
 * Structurally identical to the core `SettleDay` from
 * `packages/core/src/utils/settleDays.ts` (data-model.md "Day"), declared
 * locally so this folder imports no supplier / OMT code. Once core exports
 * them, the sheet can pass core values straight in (same shape).
 */

export type SettleDayState = "NONE" | "SETTLED" | "UNPAID" | "PARTIAL";

export type SettleCurrencyState = "OWED" | "PART" | "PAID";

export interface SettleAccountMark {
  origin: "UNDO" | "VOID";
  ref: string;
  currency: "USD" | "LBP";
  amount: number;
}

export interface SettleDay {
  /** `YYYY-MM-DD`, the shop's calendar day. */
  day: string;
  state: SettleDayState;
  left_usd: number;
  left_lbp: number;
  owed_usd: number;
  owed_lbp: number;
  /** Paid share as a FRACTION 0..1, or null when that currency owes nothing that day. */
  paid_pct_usd: number | null;
  paid_pct_lbp: number | null;
  currency_state_usd: SettleCurrencyState | null;
  currency_state_lbp: SettleCurrencyState | null;
  selectable: boolean;
  waiting_count: number;
  account_marks: SettleAccountMark[];
}

/** Money formatters the caller may override (defaults in `format.ts`). */
export interface SettleFormatters {
  /** Month line / selection bar: `$482.00`. */
  formatUsd: (amount: number) => string;
  /** Month line / selection bar: `1,890,000 LBP`. */
  formatLbp: (amount: number) => string;
  /** Under a circle: `$47`, `$47.50`. */
  formatUsdShort: (amount: number) => string;
  /** Under a circle, number part only (the LBP label is added): `990k`, `1.2m`. */
  formatLbpShort: (amount: number) => string;
}
