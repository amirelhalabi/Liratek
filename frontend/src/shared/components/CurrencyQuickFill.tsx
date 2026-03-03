/**
 * CurrencyQuickFill Component
 *
 * Reusable currency quick-fill buttons that:
 * - Show available currencies
 * - Auto-fill amount in selected currency
 * - Update exchange rate when currency changes
 *
 * Usage:
 *   <CurrencyQuickFill
 *     baseAmount={100} // Amount in base currency (USD)
 *     currencies={activeCurrencies}
 *     onSelect={(currency, amount) => {
 *       setSelectedCurrency(currency);
 *       setAmount(amount);
 *     }}
 *     exchangeRate={customExchangeRate}
 *   />
 */

import { Zap } from "lucide-react";
import { roundLBPUp } from "@liratek/ui";

interface Currency {
  code: string;
  symbol: string;
  decimal_places: number;
}

interface CurrencyQuickFillProps {
  /** Base amount in USD */
  baseAmount: number;

  /** Available currencies */
  currencies: Currency[];

  /** Current exchange rate for LBP */
  exchangeRate: number;

  /** Callback when a currency is selected */
  onSelect: (currency: Currency, amount: number) => void;

  /** Optional className for styling */
  className?: string;
}

export function CurrencyQuickFill({
  baseAmount,
  currencies,
  exchangeRate,
  onSelect,
  className = "",
}: CurrencyQuickFillProps) {
  const getAmountInCurrency = (currency: Currency): number => {
    if (currency.code === "USD") {
      return baseAmount;
    } else if (currency.code === "LBP") {
      return roundLBPUp(baseAmount * exchangeRate);
    } else if (currency.code === "EUR") {
      // TODO: Add EUR rate support
      return baseAmount * 0.92; // Placeholder
    }
    return baseAmount;
  };

  const formatAmount = (currency: Currency): string => {
    const amount = getAmountInCurrency(currency);

    if (currency.code === "USD") {
      return `$${amount.toFixed(2)}`;
    } else if (currency.code === "LBP") {
      return `${amount.toLocaleString()} LBP`;
    } else if (currency.code === "EUR") {
      return `€${amount.toFixed(2)}`;
    }
    return `${currency.symbol}${amount.toFixed(currency.decimal_places)}`;
  };

  return (
    <div className={`flex gap-2 flex-wrap ${className}`}>
      {currencies.map((curr) => (
        <button
          key={curr.code}
          type="button"
          onClick={() => onSelect(curr, getAmountInCurrency(curr))}
          className="flex-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-1"
        >
          <Zap size={14} />
          {formatAmount(curr)}
        </button>
      ))}
    </div>
  );
}
