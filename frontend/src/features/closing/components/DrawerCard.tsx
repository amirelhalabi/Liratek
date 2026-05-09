/**
 * DrawerCard Component
 * Reusable card component for displaying drawer information and currency inputs
 */

import { useState, useRef } from "react";
import { DollarSign, Wallet, Phone, Coins, X } from "lucide-react";
import type { DrawerType, Currency } from "../types";
import { DRAWER_CONFIGS } from "../config/drawers";

/** Format a numeric value with thousand-separator commas */
function formatWithCommas(value: string | number): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num) || num === 0) return "0";
  return num.toLocaleString();
}

interface DrawerCardProps {
  drawer: DrawerType;
  currencies: Currency[];
  getDisplayValue: (drawer: DrawerType, code: string) => string;
  onAmountChange: (drawer: DrawerType, code: string, value: string) => void;
  disabled?: boolean;
  focusRingColor?: string;
  /** Additional currencies (non-core) to show in the currencies popup */
  otherCurrencies?: Currency[];
}

export function DrawerCard({
  drawer,
  currencies,
  getDisplayValue,
  onAmountChange,
  disabled = false,
  focusRingColor = "violet-500",
  otherCurrencies,
}: DrawerCardProps) {
  const config = DRAWER_CONFIGS[drawer];
  /** Track which field is actively being edited (show raw number) */
  const [editingField, setEditingField] = useState<string | null>(null);
  const [showCurrencyPopup, setShowCurrencyPopup] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const hasOtherCurrencies = otherCurrencies && otherCurrencies.length > 0;

  return (
    <div
      className={`border-2 rounded-xl p-5 transition-all hover:shadow-lg ${config.color.border} ${config.color.background}`}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="bg-white/10 p-2 rounded-lg text-white">{getIcon()}</div>
        <div className="flex-1">
          <h3 className="font-bold text-lg text-white">{config.label}</h3>
          <p className="text-xs text-slate-400">{config.description}</p>
        </div>
        {hasOtherCurrencies && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowCurrencyPopup(true)}
              onMouseEnter={() => {
                tooltipTimeout.current = setTimeout(
                  () => setShowTooltip(true),
                  400,
                );
              }}
              onMouseLeave={() => {
                if (tooltipTimeout.current)
                  clearTimeout(tooltipTimeout.current);
                setShowTooltip(false);
              }}
              className="p-2 rounded-lg bg-slate-700/50 hover:bg-slate-600/50 text-slate-300 hover:text-white transition-colors border border-slate-600/50"
              title="Other currencies"
            >
              <Coins size={16} />
            </button>

            {/* Tooltip on hover */}
            {showTooltip && !showCurrencyPopup && (
              <div className="absolute right-0 top-full mt-2 z-50 bg-slate-800 border border-slate-600 rounded-lg p-3 shadow-xl min-w-48">
                <p className="text-xs text-slate-400 uppercase tracking-wide mb-2">
                  Other Currencies
                </p>
                <div className="space-y-1">
                  {otherCurrencies!.map((c) => {
                    const val =
                      parseFloat(getDisplayValue(drawer, c.code)) || 0;
                    return (
                      <div
                        key={c.code}
                        className="flex justify-between text-sm"
                      >
                        <span className="text-slate-300">
                          {c.name || c.code}
                        </span>
                        <span className="text-emerald-400 font-mono">
                          {val === 0
                            ? "0"
                            : val.toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Currency Inputs */}
      <div className="space-y-3">
        {currencies.length === 0 ? (
          <p className="text-sm text-slate-300/80">No currencies to display.</p>
        ) : (
          currencies.map((currency) => {
            const fieldKey = `${drawer}-${currency.code}`;
            const rawValue = getDisplayValue(drawer, currency.code);
            const isEditing = editingField === fieldKey;

            return (
              <div key={currency.code} className="flex items-center gap-3">
                <label
                  htmlFor={fieldKey}
                  className="text-sm font-semibold text-slate-300 w-16 flex-shrink-0"
                >
                  {currency.code}
                </label>
                <div className="flex-1">
                  <input
                    id={fieldKey}
                    type="text"
                    inputMode="decimal"
                    value={
                      isEditing ? rawValue : formatWithCommas(rawValue || "0")
                    }
                    onChange={(e) => {
                      // Strip commas so the underlying value stays numeric
                      const cleaned = e.target.value.replace(/,/g, "");
                      // Allow empty, negative sign, digits, and one decimal point
                      if (/^-?[0-9]*\.?[0-9]*$/.test(cleaned)) {
                        onAmountChange(drawer, currency.code, cleaned);
                      }
                    }}
                    onFocus={() => setEditingField(fieldKey)}
                    onBlur={() => setEditingField(null)}
                    placeholder="0"
                    autoComplete="off"
                    disabled={disabled}
                    className={`w-full bg-slate-900 border-2 border-slate-600 rounded-lg px-4 py-2.5 text-white text-lg font-mono placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-${focusRingColor} focus:border-${focusRingColor} transition cursor-text disabled:opacity-50 disabled:cursor-not-allowed`}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Other Currencies Popup */}
      {showCurrencyPopup && hasOtherCurrencies && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowCurrencyPopup(false);
          }}
        >
          <div
            className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl w-full max-w-md p-5"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">
                Other Currencies — {config.label}
              </h3>
              <button
                onClick={() => setShowCurrencyPopup(false)}
                className="p-1 hover:bg-slate-700 rounded-lg transition-colors text-slate-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {otherCurrencies!.map((currency) => {
                const fieldKey = `${drawer}-${currency.code}-popup`;
                const rawValue = getDisplayValue(drawer, currency.code);
                const isEditing = editingField === fieldKey;

                return (
                  <div key={currency.code} className="flex items-center gap-3">
                    <label
                      htmlFor={fieldKey}
                      className="text-sm font-semibold text-slate-300 w-20 flex-shrink-0"
                    >
                      {currency.code}
                    </label>
                    <input
                      id={fieldKey}
                      type="text"
                      inputMode="decimal"
                      value={
                        isEditing ? rawValue : formatWithCommas(rawValue || "0")
                      }
                      onChange={(e) => {
                        const cleaned = e.target.value.replace(/,/g, "");
                        if (/^-?[0-9]*\.?[0-9]*$/.test(cleaned)) {
                          onAmountChange(drawer, currency.code, cleaned);
                        }
                      }}
                      onFocus={() => setEditingField(fieldKey)}
                      onBlur={() => setEditingField(null)}
                      placeholder="0"
                      autoComplete="off"
                      disabled={disabled}
                      className={`flex-1 bg-slate-950 border border-slate-600 rounded-lg px-3 py-2 text-white font-mono placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-${focusRingColor} focus:border-${focusRingColor} transition disabled:opacity-50`}
                    />
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setShowCurrencyPopup(false)}
                className="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm rounded-lg transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
