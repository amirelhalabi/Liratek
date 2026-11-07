import { useId } from "react";
import { useTranslation } from "react-i18next";
import { localDay, localMonth } from "@/shared/utils/localDay";

/** LIRA-343 (FR-016c) — two date fields + Today / Yesterday / This month /
 *  Clear. Shared by the Suppliers and Partners windows (owner 2026-11-07).
 *  Days are the browser's own local days (rule 27: never the UTC day
 *  of `toISOString()`). */
export function DayRangeFilter({
  from,
  to,
  onChange,
  testId = "day-range-filter",
  accent = "orange",
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  testId?: string;
  /** Focus colour of the page it sits on. */
  accent?: "orange" | "violet";
}) {
  const { t } = useTranslation("shared");
  const fromId = useId();
  const toId = useId();
  const today = () => localDay();
  const yesterday = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return localDay(d);
  };
  const input =
    "bg-slate-900 border border-slate-600 rounded-lg px-2 py-1.5 text-white text-sm focus:outline-none [color-scheme:dark] " +
    (accent === "violet"
      ? "focus:border-violet-500"
      : "focus:border-orange-500");
  const preset =
    "px-2.5 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-semibold";
  return (
    <div
      role="group"
      aria-label={t("dayRangeFilter.label")}
      data-testid={testId}
      className="flex flex-wrap items-center gap-2"
    >
      <label htmlFor={fromId} className="text-xs text-slate-400">
        {t("dayRangeFilter.from")}
      </label>
      <input
        id={fromId}
        type="date"
        value={from}
        max={to || undefined}
        // The server refuses From after To: moving From past To moves To
        // along with it (and the reverse below), so the pair is never upside
        // down. Plain string order is day order for `YYYY-MM-DD`.
        onChange={(e) => {
          const next = e.target.value;
          onChange(next, to && next && next > to ? next : to);
        }}
        className={input}
      />
      <label htmlFor={toId} className="text-xs text-slate-400">
        {t("dayRangeFilter.to")}
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
      <button
        type="button"
        className={preset}
        onClick={() => onChange(today(), today())}
      >
        {t("dayRangeFilter.today")}
      </button>
      <button
        type="button"
        className={preset}
        onClick={() => onChange(yesterday(), yesterday())}
      >
        {t("dayRangeFilter.yesterday")}
      </button>
      <button
        type="button"
        className={preset}
        onClick={() => onChange(`${localMonth()}-01`, today())}
      >
        {t("dayRangeFilter.thisMonth")}
      </button>
      <button
        type="button"
        className="px-2 py-1.5 text-xs font-semibold text-slate-400 hover:text-white underline underline-offset-[3px]"
        onClick={() => onChange("", "")}
      >
        {t("dayRangeFilter.clear")}
      </button>
    </div>
  );
}
