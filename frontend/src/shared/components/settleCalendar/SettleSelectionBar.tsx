/**
 * LIRA-343 (spec FR-009, FR-014): the summary of the picked days under the
 * settle calendar — "N · first → last · $x + y LBP · K left out · Clear", or
 * "Tap the days you are settling · Pick all open" when nothing is picked.
 * Generic: the caller passes ready day labels and totals.
 */
import { useTranslation } from "react-i18next";
import { DEFAULT_SETTLE_FORMATTERS, joinCurrencyAmounts } from "./format";
import type { SettleFormatters } from "./types";

export interface SettleSelectionBarProps {
  count: number;
  /** Display labels, e.g. "21 Oct". */
  firstDay: string;
  lastDay: string;
  totals: { usd: number; lbp: number };
  leftOutCount: number;
  onClear: () => void;
  onPickAllOpen: () => void;
  formatters?:
    | Partial<Pick<SettleFormatters, "formatUsd" | "formatLbp">>
    | undefined;
}

const LINK =
  "border-0 bg-transparent p-0 text-xs font-semibold text-slate-400 underline underline-offset-[3px] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 rounded";

export function SettleSelectionBar({
  count,
  firstDay,
  lastDay,
  totals,
  leftOutCount,
  onClear,
  onPickAllOpen,
  formatters: overrides,
}: SettleSelectionBarProps) {
  const { t } = useTranslation("suppliers");
  const f = { ...DEFAULT_SETTLE_FORMATTERS, ...overrides };
  const box =
    "flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-[12.5px] text-slate-300";

  if (count === 0) {
    return (
      <div data-testid="settle-selection-bar" className={box}>
        <span>{t("accountSettle.calendar.emptySelection")}</span>
        <span className="ms-auto">
          <button type="button" className={LINK} onClick={onPickAllOpen}>
            {t("accountSettle.calendar.pickAllOpen")}
          </button>
        </span>
      </div>
    );
  }

  const range =
    count > 1 && firstDay !== lastDay
      ? t("accountSettle.calendar.range", { first: firstDay, last: lastDay })
      : firstDay;
  const sum = joinCurrencyAmounts(totals.usd, totals.lbp, f) || f.formatUsd(0);

  return (
    <div data-testid="settle-selection-bar" className={box} aria-live="polite">
      <span
        aria-hidden="true"
        className="inline-grid h-[22px] min-w-[22px] place-items-center rounded-full bg-slate-100 px-1.5 text-xs font-extrabold text-slate-900"
      >
        {count}
      </span>
      <span className="sr-only">
        {t("accountSettle.calendar.selectedCount", { count })}
      </span>
      <span className="font-semibold text-white">{range}</span>
      {leftOutCount > 0 && (
        <span className="font-semibold text-amber-400">
          {t("accountSettle.calendar.leftOut", { count: leftOutCount })}
        </span>
      )}
      <span className="ms-auto font-mono text-white tabular-nums">{sum}</span>
      <button type="button" className={LINK} onClick={onClear}>
        {t("accountSettle.calendar.clear")}
      </button>
    </div>
  );
}
