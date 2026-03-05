/**
 * DateRangeFilter — Shared date range picker component.
 *
 * Provides "From" / "To" date inputs with consistent styling.
 * Extracted from Profits.tsx and Reports.tsx to eliminate duplication.
 */

// ---------------------------------------------------------------------------
// Helpers (exported so consumers can set sensible defaults)
// ---------------------------------------------------------------------------

/** Today in YYYY-MM-DD format (local time) */
export function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

/** N days ago in YYYY-MM-DD format (local time) */
export function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
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
        value={from}
        onChange={(e) => onFromChange(e.target.value)}
        className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white"
      />
      <label className="text-xs text-gray-400">To</label>
      <input
        type="date"
        value={to}
        onChange={(e) => onToChange(e.target.value)}
        className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white"
      />
    </div>
  );
}
