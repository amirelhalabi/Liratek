/**
 * DrawerCard Component
 * Reusable card component for displaying drawer information and currency inputs
 */

import { DollarSign, Wallet, Phone } from "lucide-react";
import type { DrawerType, Currency } from "../types";
import { DRAWER_CONFIGS } from "../config/drawers";

interface DrawerCardProps {
  drawer: DrawerType;
  currencies: Currency[];
  getDisplayValue: (drawer: DrawerType, code: string) => string;
  onAmountChange: (drawer: DrawerType, code: string, value: string) => void;
  disabled?: boolean;
  focusRingColor?: string;
}

export function DrawerCard({
  drawer,
  currencies,
  getDisplayValue,
  onAmountChange,
  disabled = false,
  focusRingColor = "violet-500",
}: DrawerCardProps) {
  const config = DRAWER_CONFIGS[drawer];

  const getIcon = () => {
    switch (config.icon) {
      case "wallet":
        return <Wallet className="w-5 h-5" />;
      case "dollar-sign":
        return <DollarSign className="w-5 h-5" />;
      case "phone":
        return <Phone className="w-5 h-5" />;
      default:
        return <Wallet className="w-5 h-5" />;
    }
  };

  return (
    <div
      className={`border-2 rounded-xl p-5 transition-all hover:shadow-lg ${config.color.border} ${config.color.background}`}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="bg-white/10 p-2 rounded-lg text-white">
          {getIcon()}
        </div>
        <div>
          <h3 className="font-bold text-lg text-white">{config.label}</h3>
          <p className="text-xs text-slate-400">{config.description}</p>
        </div>
      </div>

      {/* Currency Inputs */}
      <div className="space-y-3">
        {currencies.length === 0 ? (
          <p className="text-sm text-slate-300/80">No currencies to display.</p>
        ) : (
          currencies.map((currency) => (
          <div key={currency.code} className="flex items-center gap-3">
            <label
              htmlFor={`${drawer}-${currency.code}`}
              className="text-sm font-semibold text-slate-300 w-16 flex-shrink-0"
            >
              {currency.code}
            </label>
            <input
              id={`${drawer}-${currency.code}`}
              type="number"
              step="0.01"
              min="0"
              value={getDisplayValue(drawer, currency.code)}
              onChange={(e) => onAmountChange(drawer, currency.code, e.target.value)}
              placeholder="0.00"
              autoComplete="off"
              disabled={disabled}
              className={`flex-1 bg-slate-900 border-2 border-slate-600 rounded-lg px-4 py-2.5 text-white text-lg font-mono placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-${focusRingColor} focus:border-${focusRingColor} transition cursor-text disabled:opacity-50 disabled:cursor-not-allowed`}
            />
          </div>
          ))
        )}
      </div>
    </div>
  );
}
