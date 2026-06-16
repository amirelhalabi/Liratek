import { useState, useEffect } from "react";
import {
  formatWithCommas,
  isPartialDecimal,
} from "@/shared/utils/formatWithCommas";

interface OrderSummaryProps {
  totalAmount: number;
  discount: number;
  finalAmount: number;
  effectiveExchangeRate: number;
  onDiscountChange: (discount: number) => void;
}

export function OrderSummary({
  totalAmount,
  discount,
  finalAmount,
  effectiveExchangeRate,
  onDiscountChange,
}: OrderSummaryProps) {
  // Local display string to allow partial decimal entry (e.g. "5.") without
  // the canonical number prop wiping it on re-render. Cleared on blur.
  const [editing, setEditing] = useState<string | null>(null);

  // If the parent resets discount to 0 externally, clear our editing state too
  useEffect(() => {
    if (discount === 0) setEditing(null);
  }, [discount]);

  const displayValue =
    editing !== null
      ? formatWithCommas(editing)
      : discount
        ? formatWithCommas(String(discount))
        : "";

  return (
    <div className="shrink-0 bg-slate-900/50 rounded-xl p-4 border border-slate-700/50">
      <div className="space-y-3">
        <div className="flex justify-between text-slate-400">
          <span>Subtotal</span>
          <span>${totalAmount.toFixed(2)}</span>
        </div>
        <div className="flex justify-between items-center text-slate-400">
          <span>Discount</span>
          <div className="relative w-28">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">
              $
            </span>
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={displayValue}
              onChange={(e) => {
                const cleaned = e.target.value.replace(/,/g, "");
                if (isPartialDecimal(cleaned)) {
                  setEditing(cleaned);
                  onDiscountChange(parseFloat(cleaned) || 0);
                }
              }}
              onBlur={() => setEditing(null)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-7 pr-3 py-2 text-white font-mono focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 text-right"
              placeholder="0"
            />
          </div>
        </div>
        <div className="border-t border-slate-700 pt-3 flex justify-between items-center">
          <span className="text-lg font-bold text-white">Net Total</span>
          <span className="text-2xl font-bold text-violet-400">
            ${finalAmount.toFixed(2)}
          </span>
        </div>
        <div className="text-right text-xs text-slate-500">
          ≈ {(finalAmount * effectiveExchangeRate).toLocaleString()} LBP
        </div>
      </div>
    </div>
  );
}
