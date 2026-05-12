/**
 * TransactionTimeOverride
 *
 * Collapsed by default — shows a "⏱ Set custom time" toggle.
 * When expanded, lets the user pick a past/present datetime and
 * converts it to an ISO string for the parent form.
 * Future dates are blocked via the `max` attribute and runtime guard.
 */

import { useState } from "react";

interface TransactionTimeOverrideProps {
  value?: string | undefined;
  onChange: (time: string | undefined) => void;
}

/** Convert an ISO string to the value expected by <input type="datetime-local"> */
function toLocalInput(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** Return the current local datetime in the format required by the `max` attribute */
function getMaxDatetime(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `T${pad(now.getHours())}:${pad(now.getMinutes())}`
  );
}

export function TransactionTimeOverride({
  value,
  onChange,
}: TransactionTimeOverrideProps) {
  const [expanded, setExpanded] = useState(!!value);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (!val) {
      onChange(undefined);
      return;
    }
    const date = new Date(val);
    // Guard against future dates even if the browser doesn't enforce `max`
    if (date > new Date()) return;
    onChange(date.toISOString());
  };

  const handleClear = () => {
    onChange(undefined);
    setExpanded(false);
  };

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors mt-1"
      >
        <span>⏱</span>
        <span>Set custom time</span>
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 mt-1 flex-wrap">
      <label className="text-xs text-slate-400 whitespace-nowrap">
        Transaction time:
      </label>
      <input
        type="datetime-local"
        value={toLocalInput(value)}
        onChange={handleChange}
        max={getMaxDatetime()}
        className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-white text-xs focus:outline-none focus:ring-1 focus:ring-orange-500"
      />
      <button
        type="button"
        onClick={handleClear}
        className="text-xs text-red-400 hover:text-red-300 transition-colors"
      >
        ✕ Clear
      </button>
    </div>
  );
}
