interface DateRangeFilterProps {
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  className?: string;
}

const inputClass =
  "px-2 py-1 rounded bg-slate-900 border border-slate-700 text-white text-sm focus:outline-none focus:ring-1 focus:ring-blue-500";

export function DateRangeFilter({
  from,
  to,
  onFromChange,
  onToChange,
  className = "",
}: DateRangeFilterProps) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <label className="text-xs text-slate-400">From:</label>
      <input
        type="date"
        value={from}
        onChange={(e) => onFromChange(e.target.value)}
        className={inputClass}
      />
      <label className="text-xs text-slate-400">To:</label>
      <input
        type="date"
        value={to}
        onChange={(e) => onToChange(e.target.value)}
        className={inputClass}
      />
    </div>
  );
}
