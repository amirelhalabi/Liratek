/**
 * DateRangeFilter — Shared date range picker component.
 *
 * Provides "From" / "To" date inputs with consistent styling.
 * Extracted from Profits.tsx and Reports.tsx to eliminate duplication; the
 * single copy used app-wide (import from @liratek/ui).
 */

import { useTranslation } from "react-i18next";

// ---------------------------------------------------------------------------
// Helpers (exported so consumers can set sensible defaults)
// ---------------------------------------------------------------------------

const pad = (n: number): string => n.toString().padStart(2, "0");

/** Format a Date as YYYY-MM-DD in the LOCAL timezone (not UTC). */
function toLocalDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Today in YYYY-MM-DD format (LOCAL time).
 *
 * Uses local getters, NOT `toISOString()` — the latter returns the UTC
 * calendar day, which rolls over at 03:00 in Beirut (UTC+3) and mismatches the
 * backend's `DATE(col, 'localtime')` reporting filters.
 */
export function todayISO(): string {
  return toLocalDay(new Date());
}

/** N days ago in YYYY-MM-DD format (LOCAL time). */
export function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toLocalDay(d);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Visual style. The two looks both pre-date the consolidation of the
 * frontend's own DateRangeFilter into this one and are kept pixel-identical:
 * - "default" — slate inputs with "From:" / "To:" labels (history modals,
 *   Audit, Sessions, Checkpoint Timeline).
 * - "compact" — smaller gray inputs with "From" / "To" labels (Profits,
 *   Inventory product list).
 */
export type DateRangeFilterVariant = "default" | "compact";

export interface DateRangeFilterProps {
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  className?: string;
  variant?: DateRangeFilterVariant;
}

const VARIANT_STYLES: Record<
  DateRangeFilterVariant,
  {
    labelClass: string;
    input: string;
    fromKey: "dateRange.fromColon" | "dateRange.from";
    toKey: "dateRange.toColon" | "dateRange.to";
  }
> = {
  default: {
    labelClass: "text-xs text-slate-400",
    input:
      "bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white text-sm focus:ring-2 focus:ring-violet-600",
    fromKey: "dateRange.fromColon",
    toKey: "dateRange.toColon",
  },
  compact: {
    labelClass: "text-xs text-gray-400",
    input:
      "bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white",
    fromKey: "dateRange.from",
    toKey: "dateRange.to",
  },
};

export default function DateRangeFilter({
  from,
  to,
  onFromChange,
  onToChange,
  className = "",
  variant = "default",
}: DateRangeFilterProps) {
  const { t } = useTranslation("ui");
  const styles = VARIANT_STYLES[variant];
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <label className={styles.labelClass}>{t(styles.fromKey)}</label>
      <input
        type="date"
        data-testid="date-range-from"
        value={from}
        onChange={(e) => onFromChange(e.target.value)}
        className={styles.input}
      />
      <label className={styles.labelClass}>{t(styles.toKey)}</label>
      <input
        type="date"
        data-testid="date-range-to"
        value={to}
        onChange={(e) => onToChange(e.target.value)}
        className={styles.input}
      />
    </div>
  );
}
