/**
 * DrawerCard Component
 * Reusable card component for displaying drawer information and currency inputs.
 *
 * When `getExpectedValue` is supplied, each field also shows a two-tier variance
 * status (green match / amber attention). There is no tolerance — any difference
 * from the expected value is flagged, with the inline signed delta and a
 * reset-to-expected affordance.
 */

import {
  DollarSign,
  Wallet,
  Phone,
  Check,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";
import { DecimalInput } from "@liratek/ui";
import type { DrawerType, Currency } from "../types";
import { DRAWER_CONFIGS } from "../config/drawers";
import {
  getVarianceStatus,
  getDateVarianceStatus,
  formatCurrencyAmount,
  formatDayVariance,
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
  diff: {
    border: "border-amber-500/60",
    text: "text-amber-400",
    ring: "focus:ring-amber-500",
  },
};

/**
 * The shop's own SIM line behind an MTC/Alfa card (D2, plan Phase 3). When
 * supplied, the card grows a `Validity` row below the currency rows and puts
 * the line's number in the header — the operator is counting a specific SIM,
 * not an abstract drawer.
 */
export interface DrawerCardCarrierLine {
  phoneNumber: string;
  label?: string | null;
  /** Counted expiry as `YYYY-MM-DD`; `""` while uncounted. */
  countedExpiresAt: string;
  /** The expiry currently stored on the line — `null` if it has none. */
  expectedExpiresAt: string | null;
  onExpiryChange: (value: string) => void;
  onResetExpiry: () => void;
}

interface DrawerCardProps {
  drawer: DrawerType;
  currencies: Currency[];
  getDisplayValue: (drawer: DrawerType, code: string) => string;
  onAmountChange: (drawer: DrawerType, code: string, value: string) => void;
  disabled?: boolean;
  focusRingColor?: string;
  /** When provided, enables per-field variance status against this expected value. */
  getExpectedValue?: (drawer: DrawerType, code: string) => number;
  /** Snap a field back to its expected value. */
  onResetToExpected?: (drawer: DrawerType, code: string) => void;
  /** MTC/Alfa only — the SIM line this card counts (see the type's doc). */
  carrierLine?: DrawerCardCarrierLine;
  /** Relabel a currency row, keyed by code. On the carrier cards the USD row
   *  is the SIM's credit balance, not cash, so it reads `Credits`. */
  currencyLabels?: Record<string, string>;
}

export function DrawerCard({
  drawer,
  currencies,
  getDisplayValue,
  onAmountChange,
  disabled = false,
  focusRingColor = "violet-500",
  getExpectedValue,
  onResetToExpected,
  carrierLine,
  currencyLabels,
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

  /** Render a single currency input row, optionally with variance status. */
  const renderField = (currency: Currency, fieldKey: string) => {
    const rawValue = getDisplayValue(drawer, currency.code);
    const showStatus = !!getExpectedValue;
    const expected = showStatus ? getExpectedValue!(drawer, currency.code) : 0;
    const physical = parseFloat(rawValue) || 0;
    const info = showStatus ? getVarianceStatus(physical, expected) : null;
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
            {currencyLabels?.[currency.code] ?? currency.code}
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
            className={`flex-1 min-w-0 bg-slate-900 border-2 ${borderClass} rounded-lg px-4 py-2.5 text-lg text-white font-mono placeholder-slate-500 focus:outline-none focus:ring-2 ${ringClass} transition cursor-text disabled:opacity-50 disabled:cursor-not-allowed`}
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
                  <AlertTriangle className="w-3.5 h-3.5" />
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

  /**
   * The SIM's validity-expiry row — same grammar as `renderField` above
   * (label / input / status cell / `Expected:` sub-row with reset), with a
   * date input instead of a decimal one and a signed DAY count instead of a
   * signed amount as the variance figure.
   */
  const renderValidityField = (line: DrawerCardCarrierLine) => {
    const fieldKey = `${drawer}-validity`;
    const info = getDateVarianceStatus(
      line.countedExpiresAt || null,
      line.expectedExpiresAt,
    );
    const styles = STATUS_STYLES[info.status];
    const isDirty = info.status !== "match";

    return (
      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <label
            htmlFor={fieldKey}
            className="text-sm font-semibold text-slate-300 w-16 flex-shrink-0"
          >
            Validity
          </label>
          <input
            id={fieldKey}
            type="date"
            value={line.countedExpiresAt}
            onChange={(e) => line.onExpiryChange(e.target.value)}
            disabled={disabled}
            className={`flex-1 min-w-0 bg-slate-900 border-2 ${styles.border} rounded-lg px-4 py-2.5 text-lg text-white font-mono placeholder-slate-500 focus:outline-none focus:ring-2 ${styles.ring} transition cursor-text disabled:opacity-50 disabled:cursor-not-allowed`}
          />
          <div
            className={`w-28 flex-shrink-0 text-right text-xs font-bold ${styles.text}`}
          >
            {info.status === "match" ? (
              <span className="inline-flex items-center gap-1 justify-end">
                <Check className="w-3.5 h-3.5" /> Match
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 justify-end">
                <AlertTriangle className="w-3.5 h-3.5" />
                {formatDayVariance(info.days)}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 pl-[4.75rem] text-[11px] text-slate-500">
          <span>Expected: {line.expectedExpiresAt ?? "not set"}</span>
          {isDirty && (
            <button
              type="button"
              onClick={line.onResetExpiry}
              disabled={disabled}
              className="inline-flex items-center gap-0.5 text-slate-400 hover:text-white transition-colors disabled:opacity-50"
              title="Reset to expected"
            >
              <RotateCcw className="w-3 h-3" /> reset
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      className={`border-2 rounded-xl p-5 transition-all hover:shadow-lg ${config.color.border} ${config.color.background}`}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="bg-white/10 p-2 rounded-lg text-white">{getIcon()}</div>
        <div className="flex-1">
          <h3 className="font-bold text-lg text-white">{config.label}</h3>
          <p className="text-xs text-slate-400">
            {carrierLine
              ? `${carrierLine.phoneNumber}${carrierLine.label ? ` · ${carrierLine.label}` : ""}`
              : config.description}
          </p>
        </div>
      </div>

      {/* Currency Inputs */}
      <div className="space-y-3">
        {currencies.length === 0 ? (
          <p className="text-sm text-slate-300/80">No currencies to display.</p>
        ) : (
          currencies.map((currency) =>
            renderField(currency, `${drawer}-${currency.code}`),
          )
        )}
        {carrierLine && renderValidityField(carrierLine)}
      </div>
    </div>
  );
}
