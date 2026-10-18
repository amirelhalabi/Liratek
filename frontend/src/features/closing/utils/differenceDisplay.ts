/**
 * LIRA-335 — the few display helpers every screen that shows a checkpoint
 * difference shares (timeline row, details window, Close window, the hint
 * under Transaction time). Status, direction and open amount are NOT worked
 * out here: they come from the server's `CheckpointDifferenceView` (core
 * `describeCheckpointDifference`, rule 14). This only words them.
 */
import {
  fallbackMethodLabel,
  type CheckpointDifferenceResolutionView,
  type CheckpointDifferenceView,
} from "@liratek/core";
import { parseDbDate } from "@/shared/utils/parseDbDate";
import { formatCurrencyAmount } from "./variance";

/** Money written the shop's way: `$8.00`, `50,000 LBP`, `10.00 USDT`. */
export function formatShopMoney(amount: number, code: string): string {
  const value = formatCurrencyAmount(amount, code);
  return code === "USD" ? `$${value}` : `${value} ${code}`;
}

/** The `timeline.short` / `timeline.over` key for a difference's direction. */
export function directionKey(
  d: Pick<CheckpointDifferenceView, "direction">,
): "timeline.short" | "timeline.over" {
  return d.direction === "SHORT" ? "timeline.short" : "timeline.over";
}

/** The formatters `useFormat()` returns (only what is needed here). */
interface DayTimeFormatter {
  formatDate: (v: Date, o?: Intl.DateTimeFormatOptions) => string;
  formatTime: (v: Date, o?: Intl.DateTimeFormatOptions) => string;
}

/** A stored UTC timestamp as the shop reads it: `Mon 06:00 PM`. */
export function formatWeekdayTime(fmt: DayTimeFormatter, iso: string): string {
  const d = parseDbDate(iso);
  return `${fmt.formatDate(d, { weekday: "short" })} ${fmt.formatTime(d, {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

/** "Sale #4821" — the resolving transaction, named by its type and id.
 *  `translateType` turns the English type words into the shown language
 *  (the audit namespace's `translateTitle`, see `useResolutionLabel`);
 *  without it the label is English. */
export function resolutionLabel(
  r: Pick<
    CheckpointDifferenceResolutionView,
    "transaction_type" | "transaction_id"
  >,
  translateType: (english: string) => string = (english) => english,
): string {
  return `${translateType(fallbackMethodLabel(r.transaction_type))} #${r.transaction_id}`;
}
