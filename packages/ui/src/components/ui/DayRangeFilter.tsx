/**
 * DayRangeFilter — From / To days plus Today, Yesterday, This week, This
 * month and All (LIRA-348). The day filter a `DataTable` shows through its
 * `dayRange` prop, and usable on its own.
 *
 * Days are the browser's own local days (`YYYY-MM-DD` from the local
 * getters, never the UTC day of `toISOString()` — rule 27). The server turns
 * them into the operator's day with `localDayRangeFilter`. "" = open end;
 * "All" clears both.
 *
 * `useDayRange()` holds a range that starts on today — the default every
 * paged table opens on.
 */
import { useCallback, useId, useState } from "react";
import { useTranslation } from "react-i18next";

const pad = (n: number): string => n.toString().padStart(2, "0");

/** A Date's local calendar day as `YYYY-MM-DD`. */
function toLocalDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Today, shifted by `offsetDays`, as a local day. */
function localDayOffset(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return toLocalDay(d);
}

/** The Monday of the current local week (weeks start on Monday). */
function startOfLocalWeek(): string {
  const d = new Date();
  const sinceMonday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - sinceMonday);
  return toLocalDay(d);
}

export type DayRangePreset =
  | "today"
  | "yesterday"
  | "thisWeek"
  | "thisMonth"
  | "all";

/** The `[from, to]` a preset stands for, computed when it is clicked. */
export function dayRangeForPreset(preset: DayRangePreset): [string, string] {
  const today = localDayOffset(0);
  switch (preset) {
    case "today":
      return [today, today];
    case "yesterday": {
      const y = localDayOffset(-1);
      return [y, y];
    }
    case "thisWeek":
      return [startOfLocalWeek(), today];
    case "thisMonth":
      return [`${today.slice(0, 7)}-01`, today];
    case "all":
      return ["", ""];
  }
}

const PRESETS: readonly DayRangePreset[] = [
  "today",
  "yesterday",
  "thisWeek",
  "thisMonth",
  "all",
];

export interface DayRange {
  from: string;
  to: string;
}

/** A day range that starts on today (or on `initial`). */
export function useDayRange(initial: DayRangePreset = "today"): DayRange & {
  setRange: (from: string, to: string) => void;
} {
  const [range, setRangeState] = useState<DayRange>(() => {
    const [from, to] = dayRangeForPreset(initial);
    return { from, to };
  });
  const setRange = useCallback(
    (from: string, to: string) => setRangeState({ from, to }),
    [],
  );
  return { ...range, setRange };
}

export interface DayRangeFilterProps {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  testId?: string;
  className?: string;
}

export function DayRangeFilter({
  from,
  to,
  onChange,
  testId = "day-range-filter",
  className = "",
}: DayRangeFilterProps) {
  const { t } = useTranslation("ui");
  const fromId = useId();
  const toId = useId();
  const input =
    "bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-white text-xs focus:outline-none focus:border-violet-500 [color-scheme:dark]";
  const isActive = (p: DayRangePreset) => {
    const [f, tt] = dayRangeForPreset(p);
    return f === from && tt === to;
  };
  return (
    <div
      role="group"
      aria-label={t("dayRange.label")}
      data-testid={testId}
      className={`flex flex-wrap items-center gap-1.5 ${className}`}
    >
      <label htmlFor={fromId} className="text-xs text-slate-400">
        {t("dateRange.from")}
      </label>
      <input
        id={fromId}
        type="date"
        value={from}
        max={to || undefined}
        // Moving From past To moves To along with it (and the reverse), so
        // the pair is never upside down. String order is day order here.
        onChange={(e) => {
          const next = e.target.value;
          onChange(next, to && next && next > to ? next : to);
        }}
        className={input}
      />
      <label htmlFor={toId} className="text-xs text-slate-400">
        {t("dateRange.to")}
      </label>
      <input
        id={toId}
        type="date"
        value={to}
        min={from || undefined}
        onChange={(e) => {
          const next = e.target.value;
          onChange(from && next && next < from ? next : from, next);
        }}
        className={input}
      />
      {PRESETS.map((p) => (
        <button
          key={p}
          type="button"
          aria-pressed={isActive(p)}
          onClick={() => {
            const [f, tt] = dayRangeForPreset(p);
            onChange(f, tt);
          }}
          className={`px-2 py-1 rounded-lg text-xs font-semibold transition-colors ${
            isActive(p)
              ? "bg-violet-600 text-white"
              : "bg-slate-700 text-slate-200 hover:bg-slate-600"
          }`}
        >
          {t(`dayRange.${p}`)}
        </button>
      ))}
    </div>
  );
}
