/**
 * DateRangeFilter — Shared date range picker component.
 *
 * Provides "From" / "To" date inputs with consistent styling.
 * Extracted from Profits.tsx and Reports.tsx to eliminate duplication.
 */

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

export interface DateRangeFilterProps {
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  className?: string;
}

export default function DateRangeFilter({
  from,
  to,
  onFromChange,
  onToChange,
  className = "",
}: DateRangeFilterProps) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <label className="text-xs text-gray-400">From</label>
      <input
        type="date"
        data-testid="date-range-from"
        value={from}
        onChange={(e) => onFromChange(e.target.value)}
        className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white"
      />
      <label className="text-xs text-gray-400">To</label>
      <input
        type="date"
        data-testid="date-range-to"
        value={to}
        onChange={(e) => onToChange(e.target.value)}
        className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white"
      />
    </div>
  );
}
