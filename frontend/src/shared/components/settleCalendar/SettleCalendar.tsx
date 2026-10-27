/**
 * LIRA-343 (spec FR-001..FR-006, FR-014, FR-016b): a generic month calendar
 * for settling an account day by day. It knows nothing about suppliers or
 * OMT: the caller passes the days (core `buildSettleDays` output), the picked
 * set and the callbacks.
 *
 * Look (owner, 2026-10-26 mock): month name centred with round chevrons on
 * the calendar's own corners; 7 columns, fixed 54px on wide screens and full
 * width under 420px; every week row the same height; under the grid the
 * legend, "<$> + <LBP> left this month", and an amber link to an older month
 * that still has unselected open days. Picked days sit on a neutral band that
 * joins consecutive picked days in the same week row.
 */
import { Trans, useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, List } from "lucide-react";
import { DirIcon } from "@liratek/ui/components/ui/DirIcon";
import { formatNumber } from "@liratek/ui/i18n/format";
import { useFormat } from "@/i18n/useFormat";
import { DayCircle } from "./DayCircle";
import { isDayEnabled } from "./dayEnabled";
import { SettleLegend } from "./SettleLegend";
import { DEFAULT_SETTLE_FORMATTERS, joinCurrencyAmounts } from "./format";
import type { SettleAccountMark, SettleDay, SettleFormatters } from "./types";

export interface SettleCalendarProps {
  /** `YYYY-MM`. */
  month: string;
  days: readonly SettleDay[];
  /** `YYYY-MM-DD`, the shop's today (from the caller, never the server). */
  today: string;
  picked: ReadonlySet<string>;
  /** Picked days with some transfers left out: a half-filled badge instead
   *  of the ✓. Only read for picked days. */
  partlyPicked?: ReadonlySet<string> | undefined;
  onToggleDay: (day: string) => void;
  onOpenDay: (day: string) => void;
  /** Arrow is disabled when undefined. */
  onPrevMonth?: (() => void) | undefined;
  onNextMonth?: (() => void) | undefined;
  /** Older open days left out while a newer day is picked ("!" badge). */
  leftOutDays?: ReadonlySet<string> | undefined;
  /** The day whose details are shown (outlined). */
  focusedDay?: string | null;
  monthLeft: { usd: number; lbp: number };
  olderUnselected?:
    | { count: number; monthLabel: string; onOpen: () => void }
    | undefined;
  formatters?: Partial<SettleFormatters> | undefined;
  /** Overrides the default ↺ tooltip wording. */
  formatMark?: ((mark: SettleAccountMark) => string) | undefined;
  /** 1 = Monday (default), 0 = Sunday. */
  weekStartsOn?: 0 | 1 | undefined;
  /**
   * The "See transactions (N)" pill under "… left this month" (owner mock
   * 2026-10-26 §7). N = open transactions on the picked days
   * (`countOpenSettleTransactions`); `controlsId` = the panel region's id
   * (`SettleSheetLayout`'s `panelId`). Hidden when omitted.
   */
  seeTransactions?:
    | {
        count: number;
        expanded: boolean;
        controlsId: string;
        onToggle: () => void;
      }
    | undefined;
}

const EMPTY_SET: ReadonlySet<string> = new Set();

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function emptyDay(day: string): SettleDay {
  return {
    day,
    state: "NONE",
    left_usd: 0,
    left_lbp: 0,
    owed_usd: 0,
    owed_lbp: 0,
    paid_pct_usd: null,
    paid_pct_lbp: null,
    currency_state_usd: null,
    currency_state_lbp: null,
    selectable: false,
    waiting_count: 0,
    account_marks: [],
  };
}

export function SettleCalendar({
  month,
  days,
  today,
  picked,
  partlyPicked = EMPTY_SET,
  onToggleDay,
  onOpenDay,
  onPrevMonth,
  onNextMonth,
  leftOutDays = EMPTY_SET,
  focusedDay = null,
  monthLeft,
  olderUnselected,
  formatters: formatterOverrides,
  formatMark,
  weekStartsOn = 1,
  seeTransactions,
}: SettleCalendarProps) {
  const { t } = useTranslation("suppliers");
  const fmt = useFormat();
  const formatters: SettleFormatters = {
    ...DEFAULT_SETTLE_FORMATTERS,
    ...formatterOverrides,
  };

  const [yStr, mStr] = month.split("-");
  const year = Number(yStr);
  const monthIndex = Number(mStr) - 1;
  // Pure calendar arithmetic in UTC: no dependence on the machine's zone.
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const firstDow = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay(); // 0 = Sunday
  const offset = (firstDow - weekStartsOn + 7) % 7;

  const byDay = new Map<string, SettleDay>();
  for (const d of days) byDay.set(d.day, d);

  const slots: (number | null)[] = [];
  for (let i = 0; i < offset; i += 1) slots.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) slots.push(d);
  while (slots.length % 7 !== 0) slots.push(null);

  const keyOf = (d: number) => `${month}-${pad2(d)}`;
  const dayData = (key: string) => byDay.get(key) ?? emptyDay(key);

  // Owner request 2026-10-27: hide a week in which no day can be tapped. A
  // week whose day carries a ↺ account mark stays, so the mark is never lost.
  // A month with no such week keeps every week (never an empty grid).
  const keepsWeek = (d: number) => {
    const data = dayData(keyOf(d));
    return (
      isDayEnabled(data, keyOf(d) > today) || data.account_marks.length > 0
    );
  };
  const weekHasTappable = (w: number) =>
    slots.slice(w * 7, w * 7 + 7).some((d) => d !== null && keepsWeek(d));
  const weekCount = slots.length / 7;
  const shownWeeks = Array.from({ length: weekCount }, (_, w) => w).filter(
    weekHasTappable,
  );
  const visibleWeeks = new Set(
    shownWeeks.length
      ? shownWeeks
      : Array.from({ length: weekCount }, (_, w) => w),
  );

  // Labels: local-midnight Date objects for display only (no day bucketing).
  const monthName = fmt.formatDate(new Date(year, monthIndex, 1), {
    month: "long",
    year: "numeric",
  });
  // 1 Jan 2024 was a Monday, 7 Jan 2024 a Sunday.
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    fmt.formatDate(new Date(2024, 0, (weekStartsOn === 1 ? 1 : 7) + i), {
      weekday: "short",
    }),
  );

  const monthAmounts = joinCurrencyAmounts(
    monthLeft.usd,
    monthLeft.lbp,
    formatters,
  );

  const navClass =
    "grid size-[30px] place-items-center rounded-full border border-slate-700 bg-transparent text-slate-300 enabled:hover:bg-slate-800 enabled:hover:text-white disabled:cursor-default disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 motion-safe:transition-colors";

  return (
    <div className="flex flex-col gap-2">
      <div className="mx-auto flex w-full max-w-full items-center justify-between gap-2.5 px-1.5 min-[421px]:w-[378px]">
        <button
          type="button"
          className={navClass}
          onClick={onPrevMonth}
          disabled={!onPrevMonth}
          aria-label={t("accountSettle.calendar.prevMonth")}
        >
          <DirIcon icon={ChevronLeft} className="size-3.5" aria-hidden="true" />
        </button>
        <span
          className="text-base font-bold tracking-tight text-white"
          aria-live="polite"
        >
          {monthName}
        </span>
        <button
          type="button"
          className={navClass}
          onClick={onNextMonth}
          disabled={!onNextMonth}
          aria-label={t("accountSettle.calendar.nextMonth")}
        >
          <DirIcon
            icon={ChevronRight}
            className="size-3.5"
            aria-hidden="true"
          />
        </button>
      </div>

      <div className="grid grid-cols-[repeat(7,minmax(0,1fr))] grid-rows-[auto] auto-rows-fr justify-center gap-y-0.5 min-[421px]:grid-cols-[repeat(7,54px)]">
        {weekdays.map((w, i) => (
          <div
            key={`dow-${i}`}
            className="pb-1 text-center text-[10px] font-semibold tracking-wider text-slate-400 uppercase"
          >
            {w}
          </div>
        ))}
        {slots.map((d, i) => {
          if (!visibleWeeks.has(Math.floor(i / 7))) return null;
          if (d === null) {
            return <div key={`blank-${i}`} data-blank aria-hidden="true" />;
          }
          const key = keyOf(d);
          const col = i % 7;
          const data = dayData(key);
          const isFuture = key > today;
          const isPicked = picked.has(key);
          const prevPicked =
            col > 0 &&
            slots[i - 1] !== null &&
            picked.has(keyOf(slots[i - 1] as number));
          const nextPicked =
            col < 6 &&
            slots[i + 1] != null &&
            picked.has(keyOf(slots[i + 1] as number));
          const bandEdge =
            !prevPicked && !nextPicked
              ? "both"
              : !prevPicked
                ? "start"
                : !nextPicked
                  ? "end"
                  : "mid";
          return (
            <div
              key={key}
              data-day={key}
              className="relative flex items-start justify-center px-0.5 py-px"
            >
              {isPicked && (
                <span
                  data-band={bandEdge}
                  aria-hidden="true"
                  className={`pointer-events-none absolute top-px h-[46px] bg-slate-200/10 ${
                    bandEdge === "both"
                      ? "rounded-full"
                      : bandEdge === "start"
                        ? "rounded-s-full"
                        : bandEdge === "end"
                          ? "rounded-e-full"
                          : ""
                  }`}
                  style={{
                    insetInlineStart:
                      bandEdge === "start" || bandEdge === "both"
                        ? "calc(50% - 25px)"
                        : 0,
                    insetInlineEnd:
                      bandEdge === "end" || bandEdge === "both"
                        ? "calc(50% - 25px)"
                        : 0,
                    boxShadow:
                      "inset 0 1px 0 rgba(226,232,240,.14), inset 0 -1px 0 rgba(226,232,240,.14)",
                  }}
                />
              )}
              <DayCircle
                day={data}
                dayNumber={d}
                dateLabel={fmt.formatDate(new Date(year, monthIndex, d), {
                  day: "numeric",
                  month: "long",
                })}
                isToday={key === today}
                isFuture={isFuture}
                picked={isPicked}
                partlyPicked={isPicked && partlyPicked.has(key)}
                leftOut={leftOutDays.has(key)}
                focused={focusedDay === key}
                formatters={formatters}
                formatMark={formatMark}
                onOpen={onOpenDay}
                onToggle={onToggleDay}
              />
            </div>
          );
        })}
      </div>

      <SettleLegend />

      <div
        data-testid="settle-month-left"
        className="text-center text-xs text-slate-400"
      >
        {monthAmounts ? (
          <Trans
            t={t}
            i18nKey="accountSettle.calendar.monthLeft"
            values={{ amounts: monthAmounts }}
            components={{ b: <b className="font-semibold text-slate-300" /> }}
          />
        ) : (
          t("accountSettle.calendar.nothingLeft")
        )}
      </div>

      {seeTransactions && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={seeTransactions.onToggle}
            aria-expanded={seeTransactions.expanded}
            aria-controls={seeTransactions.controlsId}
            data-testid="settle-see-transactions"
            className={`inline-flex items-center gap-2 rounded-full border bg-slate-800 px-3.5 py-1.5 text-[13px] font-semibold text-white hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 motion-safe:transition-colors ${
              seeTransactions.expanded
                ? "border-emerald-500"
                : "border-slate-600"
            }`}
          >
            <List className="size-[15px]" aria-hidden="true" />
            <span>
              {seeTransactions.expanded
                ? t("accountSettle.transactions.hide")
                : t("accountSettle.transactions.see")}
            </span>
            <b className="rounded-full bg-slate-950 px-[7px] text-[11px] tabular-nums">
              {formatNumber(seeTransactions.count)}
            </b>
            <DirIcon
              icon={ChevronRight}
              className={`size-3.5 text-slate-400 motion-safe:transition-transform motion-safe:duration-300 ${
                seeTransactions.expanded ? "rotate-180" : ""
              }`}
              aria-hidden="true"
            />
          </button>
        </div>
      )}

      {olderUnselected && olderUnselected.count > 0 && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={olderUnselected.onOpen}
            className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/20 px-2.5 py-0.5 text-[11.5px] font-semibold text-amber-400 hover:bg-amber-500/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 motion-safe:transition-colors"
          >
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full bg-amber-400"
            />
            {t("accountSettle.calendar.olderUnselected", {
              count: olderUnselected.count,
              month: olderUnselected.monthLabel,
            })}
            <DirIcon
              icon={ChevronRight}
              className="size-3"
              aria-hidden="true"
            />
          </button>
        </div>
      )}
    </div>
  );
}
