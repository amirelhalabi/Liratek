/**
 * DrawerCard Component
 * Reusable card component for displaying drawer information and currency inputs.
 *
 * When `getExpectedValue` is supplied, each field also shows a three-tier
 * variance status (green match / amber within-tolerance / red beyond-tolerance)
 * with the inline delta and a reset-to-expected affordance.
 */

import { useState, useRef } from "react";
import {
  DollarSign,
  Wallet,
  Phone,
  Coins,
  X,
  Check,
  TrendingUp,
  TrendingDown,
  RotateCcw,
} from "lucide-react";
import { DecimalInput } from "@liratek/ui";
import type { DrawerType, Currency } from "../types";
import { DRAWER_CONFIGS } from "../config/drawers";
import {
  getVarianceStatus,
  formatCurrencyAmount,
  type VarianceStatus,
} from "../utils/variance";

/** Static class maps so Tailwind keeps the status colours during purge. */
const STATUS_STYLES: Record<
  VarianceStatus,
  { border: string; text: string; ring: string }
> = {
  match: {
    border: "border-emerald-500/60",
    text: "text-emerald-400",
    ring: "focus:ring-emerald-500",
  },
  within: {
    border: "border-amber-500/60",
    text: "text-amber-400",
    ring: "focus:ring-amber-500",
  },
  beyond: {
    border: "border-red-500/60",
    text: "text-red-400",
    ring: "focus:ring-red-500",
  },
};

interface DrawerCardProps {
  drawer: DrawerType;
  currencies: Currency[];
  getDisplayValue: (drawer: DrawerType, code: string) => string;
  onAmountChange: (drawer: DrawerType, code: string, value: string) => void;
  disabled?: boolean;
  focusRingColor?: string;
  /** Additional currencies (non-core) to show in the currencies popup */
  otherCurrencies?: Currency[];
  /** When provided, enables per-field variance status against this expected value. */
  getExpectedValue?: (drawer: DrawerType, code: string) => number;
  /** Variance tolerance (%) separating amber (within) from red (beyond). */
  varianceThresholdPct?: number;
  /** Snap a field back to its expected value. */
  onResetToExpected?: (drawer: DrawerType, code: string) => void;
}

export function DrawerCard({
  drawer,
  currencies,
  getDisplayValue,
  onAmountChange,
  disabled = false,
  focusRingColor = "violet-500",
  otherCurrencies,
  getExpectedValue,
  varianceThresholdPct = 0,
  onResetToExpected,
}: DrawerCardProps) {
  const config = DRAWER_CONFIGS[drawer];
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

  /** Render a single currency input row, optionally with variance status. */
  const renderField = (
    currency: Currency,
    fieldKey: string,
    size: "lg" | "sm",
  ) => {
    const rawValue = getDisplayValue(drawer, currency.code);
    const showStatus = !!getExpectedValue;
    const expected = showStatus
      ? getExpectedValue!(drawer, currency.code)
      : 0;
    const physical = parseFloat(rawValue) || 0;
    const info = showStatus
      ? getVarianceStatus(physical, expected, varianceThresholdPct)
      : null;
    const styles = info ? STATUS_STYLES[info.status] : null;
    const borderClass = styles ? styles.border : "border-slate-600";
    const ringClass = styles ? styles.ring : `focus:ring-${focusRingColor}`;
    const isDirty = !!info && info.status !== "match";

    return (
      <div key={currency.code} className="space-y-1">
        <div className="flex items-center gap-3">
          <label
            htmlFor={fieldKey}
            className="text-sm font-semibold text-slate-300 w-16 flex-shrink-0"
          >
            {currency.code}
          </label>
          <DecimalInput
            id={fieldKey}
            value={parseFloat(rawValue) || 0}
            onChange={(n) =>
              onAmountChange(drawer, currency.code, n ? String(n) : "")
            }
            allowNegative
            disabled={disabled}
            placeholder="0"
            className={`flex-1 min-w-0 bg-slate-900 border-2 ${borderClass} rounded-lg px-4 ${
              size === "lg" ? "py-2.5 text-lg" : "py-2"
            } text-white font-mono placeholder-slate-500 focus:outline-none focus:ring-2 ${ringClass} transition cursor-text disabled:opacity-50 disabled:cursor-not-allowed`}
          />
          {info && (
            <div
              className={`w-28 flex-shrink-0 text-right text-xs font-bold ${styles!.text}`}
            >
              {info.status === "match" ? (
                <span className="inline-flex items-center gap-1 justify-end">
                  <Check className="w-3.5 h-3.5" /> Match
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 justify-end">
                  {info.variance > 0 ? (
                    <TrendingUp className="w-3.5 h-3.5" />
                  ) : (
                    <TrendingDown className="w-3.5 h-3.5" />
                  )}
                  {info.variance > 0 ? "+" : ""}
                  {formatCurrencyAmount(info.variance, currency.code)}
                </span>
              )}
            </div>
          )}
        </div>
        {showStatus && (
          <div className="flex items-center gap-2 pl-[4.75rem] text-[11px] text-slate-500">
            <span>
              Expected: {formatCurrencyAmount(expected, currency.code)}
            </span>
            {isDirty && onResetToExpected && (
              <button
                type="button"
                onClick={() => onResetToExpected(drawer, currency.code)}
                disabled={disabled}
                className="inline-flex items-center gap-0.5 text-slate-400 hover:text-white transition-colors disabled:opacity-50"
                title="Reset to expected"
              >
                <RotateCcw className="w-3 h-3" /> reset
              </button>
            )}
          </div>
        )}
      </div>
    );
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
          currencies.map((currency) =>
            renderField(currency, `${drawer}-${currency.code}`, "lg"),
          )
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
              {otherCurrencies!.map((currency) =>
                renderField(currency, `${drawer}-${currency.code}-popup`, "sm"),
              )}
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
