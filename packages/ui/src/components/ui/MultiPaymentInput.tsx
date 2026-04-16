import { useState, useEffect } from "react";
import { X } from "lucide-react";

export type PaymentLine = {
  id: string;
  method: string;
  currencyCode: string;
  amount: number;
};

export interface PaymentMethod {
  code: string;
  label: string;
}

export interface Currency {
  code: string;
  symbol: string;
}

export type TransactionType =
  | "SEND"
  | "RECEIVE"
  | "SERVICE_PAYMENT"
  | "DEBT_PAYMENT"
  | "CUSTOM_SERVICE";

export interface MultiPaymentInputProps {
  totalAmount: number;
  currency: string;
  onChange: (payments: PaymentLine[]) => void;
  requiresClientForDebt?: boolean;
  hasClient?: boolean;
  onExchangeRateChange?: (rate: number) => void;
  showPmFee?: boolean;
  pmFeeRate?: number;
  onPmFeesChange?: (fees: Record<string, number>) => void;
  /** Provider fee (e.g. OMT INTRA $1) charged on top of the send amount.
   *  Shown in the summary so the grand total = totalPaid + providerFee + totalPmFees. */
  providerFee?: number;
  /** Payment methods to display in dropdown */
  paymentMethods: PaymentMethod[];
  /** Available currencies */
  currencies: Currency[];
  /** Current exchange rate (1 USD = X LBP). Defaults to 89000 if not provided */
  exchangeRate?: number;
  /** Callback when exchange rate changes */
  onRateChange?: (rate: number) => void;
}

const CASH_EQUIVALENT_METHODS = new Set(["CASH", "DEBT"]);

export default function MultiPaymentInput({
  totalAmount,
  currency,
  onChange,
  requiresClientForDebt = true,
  hasClient = false,
  onExchangeRateChange,
  showPmFee = false,
  pmFeeRate = 0.01,
  onPmFeesChange,
  providerFee = 0,
  paymentMethods = [],
  currencies = [],
  exchangeRate,
  onRateChange,
}: MultiPaymentInputProps) {
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

  const [customExchangeRate, setCustomExchangeRate] = useState<string>(
    (exchangeRate || 89000).toString(),
  );

  const safeExchangeRate = exchangeRate || 89000;

  // Update custom rate when exchange rate prop changes
  useEffect(() => {
    setCustomExchangeRate(safeExchangeRate.toString());
    onExchangeRateChange?.(safeExchangeRate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeExchangeRate]);

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

  // Calculate total paid in USD (convert LBP to USD using exchange rate)
  const totalPaid = paymentLines.reduce((sum, line) => {
    const amount = line.amount || 0;
    if (line.currencyCode === "LBP") {
      // Convert LBP to USD
      return sum + amount / safeExchangeRate;
    }
    return sum + amount;
  }, 0);

  const hasDebt = paymentLines.some((line) => line.method === "DEBT");

  const getSymbol = (currencyCode: string): string => {
    const curr = currencies.find((c) => c.code === currencyCode);
    return curr?.symbol || "$";
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
                const newRate = parseFloat(e.target.value) || safeExchangeRate;
                onRateChange?.(newRate);
                onExchangeRateChange?.(newRate);
              }}
              className="w-28 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1 text-white font-mono text-xs focus:outline-none focus:border-violet-500"
              placeholder={safeExchangeRate.toString()}
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
                  {paymentMethods.map((pm) => (
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
                  {currencies.map((curr) => (
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
                ${(totalAmount - providerFee).toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-amber-400">Provider Fee</span>
              <span className="font-mono text-amber-300">
                +${providerFee.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between text-xs border-t border-slate-700/40 pt-1">
              <span className="text-slate-300 font-medium">Total to Pay</span>
              <span className="font-mono text-slate-200 font-medium">
                ${totalAmount.toFixed(2)}
              </span>
            </div>
          </>
        )}
        {providerFee === 0 && (
          <div className="flex justify-between text-xs">
            <span className="text-slate-400">Total Amount</span>
            <span className="font-mono text-white">
              ${totalAmount.toFixed(2)}
            </span>
          </div>
        )}
        <div className="flex justify-between text-xs">
          <span className="text-slate-400">Total Paid</span>
          <span
            className={`font-mono ${Math.abs(totalPaid - totalAmount) < 0.01 ? "text-emerald-400" : "text-red-400"}`}
          >
            ${totalPaid.toFixed(2)}
          </span>
        </div>
        {Math.abs(totalPaid - totalAmount) > 0.01 && (
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
              ${Math.abs(totalPaid - totalAmount).toFixed(2)}
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
                +${totalPmFees.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-white font-semibold">Grand Total</span>
              <span className="font-mono text-white font-semibold">
                ${(totalPaid + totalPmFees).toFixed(2)}
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
