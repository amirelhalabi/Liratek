/**
 * VarianceCard Component
 * Displays variance between physical and expected amounts
 */

import {
  TrendingUp,
  TrendingDown,
  Minus,
  DollarSign,
  Wallet,
  Phone,
} from "lucide-react";
import type { DrawerType, Currency, DrawerVariance } from "../types";
import { DRAWER_CONFIGS } from "../config/drawers";

interface VarianceCardProps {
  drawer: DrawerType;
  currencies: Currency[];
  physicalAmounts: Record<string, number>;
  getExpectedAmount: (currencyCode: string) => number;
}

/**
 * Props for the per-drawer variance breakdown display
 */
interface DrawerVarianceBreakdownProps {
  drawers: DrawerVariance[];
  formatAmount?: (amount: number, currency: string) => string;
}

export function VarianceCard({
  drawer,
  currencies,
  physicalAmounts,
  getExpectedAmount,
}: VarianceCardProps) {
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
      className={`border-2 rounded-xl p-5 ${config.color.border} ${config.color.background}`}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="bg-white/10 p-2 rounded-lg text-white">{getIcon()}</div>
        <h3 className="font-bold text-lg text-white">{config.label}</h3>
      </div>

      {/* Currency Variance Details */}
      <div className="space-y-3">
        {currencies.map((currency) => {
          const physical = physicalAmounts[currency.code] || 0;
          const expected = getExpectedAmount(currency.code);
          const variance = physical - expected;
          const hasVariance = Math.abs(variance) > 0.01;

          return (
            <div
              key={currency.code}
              className="bg-slate-900/30 rounded-lg p-3 space-y-1"
            >
              <div className="flex justify-between items-center">
                <span className="text-sm font-semibold text-slate-300">
                  {currency.code}
                </span>
                {hasVariance && (
                  <span
                    className={`text-xs font-bold flex items-center gap-1 ${
                      variance > 0
                        ? "text-green-400"
                        : variance < 0
                          ? "text-red-400"
                          : "text-slate-400"
                    }`}
                  >
                    {variance > 0 ? (
                      <TrendingUp className="w-4 h-4" />
                    ) : variance < 0 ? (
                      <TrendingDown className="w-4 h-4" />
                    ) : (
                      <Minus className="w-4 h-4" />
                    )}
                    {variance > 0 ? "+" : ""}
                    {variance.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-slate-500">Expected:</span>
                  <span className="text-white font-mono ml-2">
                    {expected.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">Physical:</span>
                  <span className="text-white font-mono ml-2">
                    {physical.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * DrawerVarianceBreakdown - displays per-drawer variance details
 * Used in checkpoint timeline to show which drawers have discrepancies
 */
export function DrawerVarianceBreakdown({
  drawers,
  formatAmount,
}: DrawerVarianceBreakdownProps) {
  const fmt = (amount: number, currency: string) => {
    if (formatAmount) return formatAmount(amount, currency);
    if (currency === "LBP") return Math.round(amount).toLocaleString();
    return amount.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const withVariance = drawers.filter((d) => Math.abs(d.variance) > 0.01);

  if (withVariance.length === 0) {
    return (
      <p className="text-sm text-slate-500 italic">No variance detected</p>
    );
  }

  // Group by drawer
  const grouped: Record<string, DrawerVariance[]> = {};
  for (const d of withVariance) {
    if (!grouped[d.drawerName]) grouped[d.drawerName] = [];
    grouped[d.drawerName].push(d);
  }

  return (
    <div className="space-y-2">
      {Object.entries(grouped).map(([drawerName, items]) => (
        <div
          key={drawerName}
          className="bg-slate-900/50 rounded-lg p-3 border border-slate-700/50"
        >
          <p className="text-xs text-slate-500 font-medium mb-2">
            {drawerName}
          </p>
          <div className="space-y-1">
            {items.map((item) => (
              <div
                key={`${item.drawerName}-${item.currency}`}
                className="flex justify-between items-center text-sm"
              >
                <span className="text-slate-300">{item.currency}</span>
                <div className="flex items-center gap-2">
                  <span className="text-slate-500 text-xs">
                    {fmt(item.expected, item.currency)} →{" "}
                    {fmt(item.actual, item.currency)}
                  </span>
                  <span
                    className={`font-mono font-bold text-xs flex items-center gap-1 ${
                      item.variance > 0 ? "text-green-400" : "text-red-400"
                    }`}
                  >
                    {item.variance > 0 ? (
                      <TrendingUp className="w-3 h-3" />
                    ) : (
                      <TrendingDown className="w-3 h-3" />
                    )}
                    {item.variance > 0 ? "+" : ""}
                    {fmt(item.variance, item.currency)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
