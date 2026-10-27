export { SettleCalendar } from "./SettleCalendar";
export type { SettleCalendarProps } from "./SettleCalendar";
export { SettleSelectionBar } from "./SettleSelectionBar";
export type { SettleSelectionBarProps } from "./SettleSelectionBar";
export { SettleLegend } from "./SettleLegend";
export { DayCircle } from "./DayCircle";
export type { DayCircleProps } from "./DayCircle";
export {
  DEFAULT_SETTLE_FORMATTERS,
  defaultFormatLbp,
  defaultFormatLbpShort,
  defaultFormatUsd,
  defaultFormatUsdShort,
  joinCurrencyAmounts,
} from "./format";
export type {
  SettleAccountMark,
  SettleCurrencyState,
  SettleDay,
  SettleDayState,
  SettleFormatters,
} from "./types";
/*
 * "See transactions" (owner mock 2026-10-26 §7) — reuse in any settle sheet:
 *
 *   SettleCalendar  `seeTransactions={{ count, expanded, controlsId, onToggle }}`
 *                   → the "See transactions (N)" pill under "… left this
 *                   month" (aria-expanded / aria-controls).
 *   countOpenSettleTransactions(rows, pickedDays) → N.
 *   SettleSheetLayout `{ open, panelId, panel, children, onMouseDown?, role?,
 *                   aria-modal?, aria-label?, mainClassName? }` → the sheet
 *                   box; widens to the right when open (≥ 900px), the panel
 *                   replaces the sheet below 900px; the sheet stays mounted.
 *   SettleTransactionsPanel `{ rows: SettleTransactionRow[], pickedDays,
 *                   dayLabel, onToggleRow?, onClose, scrollToDay?, loading?,
 *                   error?, title?, formatters? }` → the table.
 *   SettleTransactionRow `{ key, id, day, label, memberTag?, nameRef?,
 *                   amount_usd/lbp (signed), left_usd/lbp (signed),
 *                   status: open|paid|waiting, checked, waitingNote? }` —
 *                   `checked` must come from the sheet's payload builder.
 *
 * Pass `onOpenDay` a handler that bumps `scrollToDay` while the table is
 * open and does nothing while it is closed: a day tap only picks / unpicks
 * (owner 2026-10-27 — no inline day details).
 */
export { SettleTransactionsPanel } from "./SettleTransactionsPanel";
export type { SettleTransactionsPanelProps } from "./SettleTransactionsPanel";
export { countOpenSettleTransactions } from "./settleTransactions";
export type { SettleTransactionRow } from "./settleTransactions";
export { SettleSheetLayout } from "./SettleSheetLayout";
export type { SettleSheetLayoutProps } from "./SettleSheetLayout";
