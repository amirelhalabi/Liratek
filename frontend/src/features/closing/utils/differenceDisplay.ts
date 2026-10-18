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

/** The resolving transaction, named the way the Transactions page's Summary
 *  names it (e.g. "Sale #7: 1× Phone charger") so the owner can find it there.
 *  Never by the internal transaction id: the Transactions page shows no such
 *  number, and it differs from the sale's or expense's own number. Without a
 *  summary, just its type ("Sale"), in the shown language via `translateType`
 *  (the audit namespace's `translateTitle`, see `useResolutionLabel`). */
export function resolutionLabel(
  r: Pick<CheckpointDifferenceResolutionView, "transaction_type" | "summary">,
  translateType: (english: string) => string = (english) => english,
): string {
  const summary = r.summary?.trim();
  if (summary) return summary;
  return translateType(fallbackMethodLabel(r.transaction_type));
}
