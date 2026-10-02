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
 * One active SIM line counted on an MTC/Alfa card (LIRA-252 item A). The
 * drawer no longer takes a free-typed amount — it is always the SUM of these
 * rows (owner decision A) — so each active line gets its OWN credits input
 * plus the same `Validity` row Phase 3 introduced, and the card lists one
 * row per line instead of a single combined USD field.
 */
export interface DrawerCardCarrierLineRow {
  lineId: number;
  phoneNumber: string;
  label?: string | null;
  /** Raw string for the controlled credits input (mirrors `getDisplayValue`'s
   *  contract on the generic currency fields). */
  creditsValue: string;
  onCreditsChange: (value: string) => void;
  expectedCredits: number;
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
  /** MTC/Alfa only — the carrier's active SIM lines, one row each (see the
   *  type's doc). The card's header shows the SUM of every row's credits —
   *  there is no separately-typed drawer amount any more. */
  carrierLines?: DrawerCardCarrierLineRow[];
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
  carrierLines,
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
   * One SIM line's Credits row — the per-line counterpart of `renderField`
   * above (same variance grammar) now that the drawer amount is the SUM of
   * these rows rather than one free-typed field (owner decision A).
   */
  const renderCreditsField = (line: DrawerCardCarrierLineRow) => {
    const fieldKey = `${drawer}-credits-${line.lineId}`;
    const physical = parseFloat(line.creditsValue) || 0;
    const info = getVarianceStatus(physical, line.expectedCredits);
    const styles = STATUS_STYLES[info.status];
    const isDirty = info.status !== "match";

    return (
      <div key={fieldKey} className="space-y-1">
        <div className="flex items-center gap-3">
          <label
            htmlFor={fieldKey}
            className="text-sm font-semibold text-slate-300 w-16 flex-shrink-0"
          >
            Credits
          </label>
          <DecimalInput
            id={fieldKey}
            value={physical}
            onChange={(n) => line.onCreditsChange(n ? String(n) : "")}
            allowNegative
            disabled={disabled}
            placeholder="0"
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
                {info.variance > 0 ? "+" : ""}
                {formatCurrencyAmount(info.variance, "USD")}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 pl-[4.75rem] text-[11px] text-slate-500">
          <span>Expected: {formatCurrencyAmount(line.expectedCredits, "USD")}</span>
          {isDirty && (
            <button
              type="button"
              onClick={() => line.onCreditsChange(String(line.expectedCredits))}
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

  /**
   * The SIM's validity-expiry row — same grammar as `renderField` above
   * (label / input / status cell / `Expected:` sub-row with reset), with a
   * date input instead of a decimal one and a signed DAY count instead of a
   * signed amount as the variance figure.
   */
  const renderValidityField = (line: DrawerCardCarrierLineRow) => {
    const fieldKey = `${drawer}-validity-${line.lineId}`;
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
            {carrierLines && carrierLines.length > 0
              ? `${carrierLines.length} active line${carrierLines.length > 1 ? "s" : ""}`
              : config.description}
          </p>
        </div>
        {carrierLines && carrierLines.length > 0 && (
          <div className="text-right">
            <p className="text-[11px] text-slate-400 uppercase tracking-wide">
              Drawer (sum)
            </p>
            <p className="text-lg font-mono font-bold text-white">
              {formatCurrencyAmount(
                carrierLines.reduce(
                  (sum, l) => sum + (parseFloat(l.creditsValue) || 0),
                  0,
                ),
                "USD",
              )}
            </p>
          </div>
        )}
      </div>

      {/* Currency Inputs / Carrier-line rows */}
      <div className="space-y-4">
        {currencies.length === 0 && !carrierLines ? (
          <p className="text-sm text-slate-300/80">No currencies to display.</p>
        ) : (
          currencies.map((currency) =>
            renderField(currency, `${drawer}-${currency.code}`),
          )
        )}
        {carrierLines?.map((line) => (
          <div
            key={line.lineId}
            className="rounded-lg border border-slate-700/60 bg-black/10 p-3 space-y-3"
          >
            <p className="text-xs font-semibold text-slate-300">
              {line.phoneNumber}
              {line.label ? ` · ${line.label}` : ""}
            </p>
            {renderCreditsField(line)}
            {renderValidityField(line)}
          </div>
        ))}
      </div>
    </div>
  );
}
