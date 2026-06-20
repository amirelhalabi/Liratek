import { DecimalInput } from "@liratek/ui";

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
  return (
    <div className="shrink-0 bg-slate-900/50 rounded-xl p-4 border border-slate-700/50">
      <div className="space-y-3">
        <div className="flex justify-between text-slate-400">
          <span>Subtotal</span>
          <span>${totalAmount.toFixed(2)}</span>
        </div>
        <div className="flex justify-between items-center text-slate-400">
          <span>Discount</span>
          <DecimalInput
            value={discount}
            onChange={onDiscountChange}
            prefix="$"
            wrapperClassName="relative w-28"
            className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-7 pr-3 py-2 text-white font-mono focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 text-right"
            placeholder="0"
          />
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
