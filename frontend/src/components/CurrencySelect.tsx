/**
 * CurrencySelect
 *
 * Reusable currency dropdown component that sources data from CurrencyContext.
 */

import { useCurrencyContext } from "../contexts/CurrencyContext";

interface CurrencySelectProps {
  value: string;
  onChange: (code: string) => void;
  /** Optional: only show currencies enabled for this module */
  moduleKey?: string;
  /** Show all currencies or only active ones (default: active only) */
  showAll?: boolean;
  className?: string;
  disabled?: boolean;
  /** Optional list of currencies to use instead of context */
  currencies?: Array<{ code: string; name: string; symbol: string }>;
}

export default function CurrencySelect({
  value,
  onChange,
  showAll = false,
  className = "",
  disabled = false,
  currencies: overrideCurrencies,
}: CurrencySelectProps) {
  const { activeCurrencies, currencies: allCurrencies } = useCurrencyContext();

  const list =
    overrideCurrencies ?? (showAll ? allCurrencies : activeCurrencies);

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={`bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-violet-500 ${className}`}
    >
      {list.map((c) => (
        <option key={c.code} value={c.code}>
          {c.code} — {c.name}
        </option>
      ))}
    </select>
  );
}
