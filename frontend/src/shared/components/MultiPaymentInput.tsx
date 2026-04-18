import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import { useDynamicExchangeRate } from "@/hooks/useDynamicExchangeRate";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import type { TransactionType } from "@/utils/exchangeRates";

export type PaymentLine = {
  id: string;
  method: string;
  currencyCode: string;
  amount: number;
};

interface MultiPaymentInputProps {
  totalAmount: number;
  currency: string;
  /** The currency that totalAmount is denominated in. Defaults to "USD".
   *  e.g. Whish/iPick/KATCH pass "LBP", POS sale passes "USD". */
  totalAmountCurrency?: string;
  onChange: (payments: PaymentLine[]) => void;
  requiresClientForDebt?: boolean;
  hasClient?: boolean;
  transactionType: TransactionType;
  onExchangeRateChange?: (rate: number) => void;
  showPmFee?: boolean;
  pmFeeRate?: number;
  onPmFeesChange?: (fees: Record<string, number>) => void;
  /** Provider fee (e.g. OMT INTRA $1) charged on top of the send amount.
   *  Shown in the summary so the grand total = totalPaid + providerFee + totalPmFees. */
  providerFee?: number;
}

const CASH_EQUIVALENT_METHODS = new Set(["CASH", "DEBT"]);

export function MultiPaymentInput({
  totalAmount,
  currency,
  totalAmountCurrency = "USD",
  onChange,
  requiresClientForDebt = true,
  hasClient = false,
  transactionType,
  onExchangeRateChange,
  showPmFee = false,
  pmFeeRate = 0.01,
  onPmFeesChange,
  providerFee = 0,
}: MultiPaymentInputProps) {
  const { allMethods: paymentMethodOptions } = usePaymentMethods();
  const { activeCurrencies, getSymbol } = useCurrencyContext();

  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([
    {
      id: crypto.randomUUID(),
      method: "CASH",
      currencyCode: currency,
      amount: totalAmount,
    },
  ]);

  const [pmFeeOverrides, setPmFeeOverrides] = useState<Record<string, string>>(
    {},
  );

  // Determine selected currency from payment lines
  const hasLBPPayment = paymentLines.some(
    (line) => line.currencyCode === "LBP",
  );
  const selectedCurrency = hasLBPPayment ? "LBP" : "USD";

  // Dynamic exchange rate based on transaction type and selected currency
  const {
    rate,
    setRate: _setRate,
    rateInfo: _rateInfo,
    isBaseCurrency: _isBaseCurrency,
  } = useDynamicExchangeRate({
    selectedCurrency,
    transactionType,
  });

  const [customExchangeRate, setCustomExchangeRate] = useState<string>(
    rate.toString(),
  );

  // Update custom rate when auto rate changes — only depend on `rate` (the number),
  // not on the callback reference, to avoid re-firing when the parent re-renders
  // and passes a new function reference without the rate actually changing.
  useEffect(() => {
    setCustomExchangeRate(rate.toString());
    onExchangeRateChange?.(rate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rate]);

  const handleLinesChange = (newLines: PaymentLine[]) => {
    setPaymentLines(newLines);
    onChange(newLines);
  };

  const addPaymentLine = () => {
    handleLinesChange([
      ...paymentLines,
      {
        id: crypto.randomUUID(),
        method: "CASH",
        currencyCode: currency,
        amount: 0,
      },
    ]);
  };

  const removePaymentLine = (id: string) => {
    if (paymentLines.length > 1) {
      handleLinesChange(paymentLines.filter((line) => line.id !== id));
    }
  };

  const updatePaymentLine = (
    id: string,
    field: keyof PaymentLine,
    value: string | number,
  ) => {
    const updatedLines = paymentLines.map((line) =>
      line.id === id ? { ...line, [field]: value } : line,
    );

    // Handle PM fee clearing when method changes to/from CASH
    if (field === "method") {
      const newMethod = value as string;

      if (CASH_EQUIVALENT_METHODS.has(newMethod)) {
        // Clearing PM fee for CASH/DEBT methods
        const newOverrides = { ...pmFeeOverrides };
        delete newOverrides[id];
        setPmFeeOverrides(newOverrides);
      }
    }

    handleLinesChange(updatedLines);
  };

  const calculatePmFee = (lineId: string, lineAmount: number): number => {
    const override = pmFeeOverrides[lineId];
    if (override !== undefined) {
      return parseFloat(override) || 0;
    }
    return lineAmount * pmFeeRate;
  };

  // Compute the PM fees map — pure derivation, no new object stored in state
  const pmFeesMap: Record<string, number> = {};
  if (showPmFee) {
    paymentLines.forEach((line) => {
      if (!CASH_EQUIVALENT_METHODS.has(line.method)) {
        pmFeesMap[line.id] = calculatePmFee(line.id, line.amount);
      }
    });
  }
  const totalPmFees = Object.values(pmFeesMap).reduce(
    (sum, fee) => sum + fee,
    0,
  );

  // Emit PM fees to parent — depend on a stable serialised key so we only fire
  // when the actual fee VALUES change, not on every render (avoids infinite loop
  // caused by pmFeesMap being a new object reference each render).
  const pmFeesKey = JSON.stringify(pmFeesMap);
  useEffect(() => {
    if (onPmFeesChange) {
      onPmFeesChange(JSON.parse(pmFeesKey) as Record<string, number>);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pmFeesKey]);

  const effectiveRate = parseFloat(customExchangeRate) || rate;

  /** Convert a payment line amount into the totalAmountCurrency.
   *  - If the line currency matches totalAmountCurrency -> no conversion.
   *  - LBP -> USD: divide by rate.   USD -> LBP: multiply by rate. */
  const normalizeToTarget = (amount: number, lineCurrency: string): number => {
    if (lineCurrency === totalAmountCurrency) return amount;
    if (lineCurrency === "LBP" && totalAmountCurrency === "USD") {
      return amount / effectiveRate;
    }
    if (lineCurrency === "USD" && totalAmountCurrency === "LBP") {
      return amount * effectiveRate;
    }
    return amount;
  };

  // Calculate total paid normalized to the totalAmountCurrency
  const totalPaid = paymentLines.reduce((sum, line) => {
    return sum + normalizeToTarget(line.amount || 0, line.currencyCode);
  }, 0);

  // Tolerance for matching: LBP amounts are large so use higher tolerance
  const matchTolerance = totalAmountCurrency === "LBP" ? 100 : 0.01;
  const hasDebt = paymentLines.some((line) => line.method === "DEBT");

  // Summary formatting helpers
  const targetSymbol = getSymbol(totalAmountCurrency);
  const targetDecimals = totalAmountCurrency === "LBP" ? 0 : 2;
  const fmtTarget = (v: number) => {
    const formatted = Math.abs(v).toFixed(targetDecimals);
    if (["$", "€", "£"].includes(targetSymbol)) {
      return `${targetSymbol}${formatted}`;
    }
    return `${formatted} ${targetSymbol}`;
  };

  return (
    <div className="bg-slate-900/40 border border-slate-700/50 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-medium text-slate-300">Payment Split</div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500">1 USD =</label>
            <input
              type="number"
              value={customExchangeRate}
              onChange={(e) => {
                setCustomExchangeRate(e.target.value);
                const newRate = parseFloat(e.target.value) || rate;
                onExchangeRateChange?.(newRate);
              }}
              className="w-28 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1 text-white font-mono text-xs focus:outline-none focus:border-violet-500"
              placeholder={rate.toString()}
            />
            <label className="text-xs text-slate-500">LBP</label>
          </div>
          <button
            type="button"
            onClick={addPaymentLine}
            className="text-xs px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
          >
            + Add Payment Method
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {paymentLines.map((line) => (
          <div key={line.id}>
            <div className="grid grid-cols-12 gap-2 items-center">
              {/* Payment Method */}
              <div className="col-span-5">
                <select
                  value={line.method}
                  onChange={(e) =>
                    updatePaymentLine(line.id, "method", e.target.value)
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500"
                >
                  {paymentMethodOptions.map((pm) => (
                    <option key={pm.code} value={pm.code}>
                      {pm.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Currency */}
              <div className="col-span-3">
                <select
                  value={line.currencyCode}
                  onChange={(e) =>
                    updatePaymentLine(line.id, "currencyCode", e.target.value)
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500"
                >
                  {activeCurrencies.map((curr) => (
                    <option key={curr.code} value={curr.code}>
                      {curr.code}
                    </option>
                  ))}
                </select>
              </div>

              {/* Amount */}
              <div className="col-span-3">
                <div className="relative">
                  {/* Show prefix symbols ($, €, £) */}
                  {["$", "€", "£"].includes(getSymbol(line.currencyCode)) && (
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">
                      {getSymbol(line.currencyCode)}
                    </span>
                  )}
                  <input
                    type="number"
                    value={line.amount || ""}
                    onChange={(e) =>
                      updatePaymentLine(
                        line.id,
                        "amount",
                        parseFloat(e.target.value) || 0,
                      )
                    }
                    className={`w-full bg-slate-950 border border-slate-700 rounded-lg pr-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-violet-500 ${
                      ["$", "€", "£"].includes(getSymbol(line.currencyCode))
                        ? "pl-7"
                        : "pl-3"
                    }`}
                    placeholder="0"
                    step="0.01"
                  />
                </div>
              </div>

              {/* Remove Button */}
              <div className="col-span-1 flex justify-end">
                <button
                  type="button"
                  disabled={paymentLines.length === 1}
                  onClick={() => removePaymentLine(line.id)}
                  className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                  title="Remove payment line"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* PM Fee Row */}
            {showPmFee && !CASH_EQUIVALENT_METHODS.has(line.method) && (
              <div className="grid grid-cols-12 gap-2 items-center mt-1 ml-0 pl-0">
                <div className="col-span-5" />
                <div className="col-span-3" />
                <div className="col-span-3">
                  <div className="relative bg-violet-950/40 border border-violet-700/50 rounded-lg px-3 py-2">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-violet-400 text-xs">
                      $
                    </span>
                    <input
                      type="number"
                      value={
                        pmFeeOverrides[line.id] ??
                        (line.amount * pmFeeRate).toFixed(2)
                      }
                      onChange={(e) => {
                        const newOverrides = { ...pmFeeOverrides };
                        newOverrides[line.id] = e.target.value;
                        setPmFeeOverrides(newOverrides);
                      }}
                      className="w-full bg-transparent text-violet-200 text-sm font-mono focus:outline-none pl-7 pr-3 py-0"
                      placeholder="0.00"
                      step="0.01"
                    />
                  </div>
                </div>
                <div className="col-span-1 flex justify-start">
                  <label className="text-xs text-violet-400">PM fee:</label>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Summary
          totalAmount = sentAmount + providerFee (what customer must physically pay)
          totalPaid   = sum of all payment lines (must equal totalAmount)
          PM fees     = extra wallet surcharge on top (baked into non-cash lines by parent)
      */}
      <div className="mt-3 pt-3 border-t border-slate-700/50 space-y-1">
        {/* Breakdown: where the customer's money goes */}
        {providerFee > 0 && (
          <>
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">Send Amount</span>
              <span className="font-mono text-white">
                {fmtTarget(totalAmount - providerFee)}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-amber-400">Provider Fee</span>
              <span className="font-mono text-amber-300">
                +{fmtTarget(providerFee)}
              </span>
            </div>
            <div className="flex justify-between text-xs border-t border-slate-700/40 pt-1">
              <span className="text-slate-300 font-medium">Total to Pay</span>
              <span className="font-mono text-slate-200 font-medium">
                {fmtTarget(totalAmount)}
              </span>
            </div>
          </>
        )}
        {providerFee === 0 && (
          <div className="flex justify-between text-xs">
            <span className="text-slate-400">Total Amount</span>
            <span className="font-mono text-white">
              {fmtTarget(totalAmount)}
            </span>
          </div>
        )}
        <div className="flex justify-between text-xs">
          <span className="text-slate-400">Total Paid</span>
          <span
            className={`font-mono ${Math.abs(totalPaid - totalAmount) < matchTolerance ? "text-emerald-400" : "text-red-400"}`}
          >
            {fmtTarget(totalPaid)}
          </span>
        </div>
        {Math.abs(totalPaid - totalAmount) > matchTolerance && (
          <div className="flex justify-between text-xs">
            <span
              className={
                totalPaid < totalAmount ? "text-red-400" : "text-amber-400"
              }
            >
              {totalPaid < totalAmount ? "Remaining (Debt)" : "Overpaid"}
            </span>
            <span
              className={`font-mono font-bold ${totalPaid < totalAmount ? "text-red-400" : "text-amber-400"}`}
            >
              {fmtTarget(Math.abs(totalPaid - totalAmount))}
            </span>
          </div>
        )}
        {showPmFee && totalPmFees > 0 && (
          <>
            <div className="flex justify-between text-xs border-t border-violet-700/30 pt-1">
              <span className="text-violet-400">
                Wallet Surcharge (PM fees)
              </span>
              <span className="font-mono text-violet-300">
                +{fmtTarget(totalPmFees)}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-white font-semibold">Grand Total</span>
              <span className="font-mono text-white font-semibold">
                {fmtTarget(totalPaid + totalPmFees)}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Validation Messages */}
      {hasDebt && requiresClientForDebt && !hasClient && (
        <div className="mt-3 text-xs text-red-400 bg-red-500/10 px-3 py-2 rounded border border-red-500/30">
          ⚠️ Client is required when using DEBT payment method
        </div>
      )}
    </div>
  );
}
