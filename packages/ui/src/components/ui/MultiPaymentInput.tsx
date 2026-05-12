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
  /** The currency that totalAmount is denominated in. Defaults to "USD".
   *  e.g. Whish/iPick/KATCH pass "LBP", POS sale passes "USD". */
  totalAmountCurrency?: string;
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
  /** Show an optional discount field that reduces the amount the customer pays.
   *  Discount is subtracted from totalAmount before payment matching. */
  showDiscount?: boolean;
  /** Maximum allowed discount (in totalAmountCurrency). Cannot exceed cost. */
  maxDiscount?: number;
  /** Callback when discount changes. Receives discount normalized to totalAmountCurrency. */
  onDiscountChange?: (discount: number) => void;
}

const CASH_EQUIVALENT_METHODS = new Set(["CASH", "DEBT"]);

/** Format a number with commas (e.g. 3600000 → "3,600,000", 150.50 → "150.50") */
function fmtNum(value: number | string): string {
  if (value === "" || value === 0) return "";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "";
  const parts = num.toString().split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.join(".");
}

/** Strip commas and parse to number */
function parseNum(formatted: string): number {
  return parseFloat(formatted.replace(/,/g, "")) || 0;
}

export default function MultiPaymentInput({
  totalAmount,
  currency,
  totalAmountCurrency = "USD",
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
  showDiscount = true,
  maxDiscount,
  onDiscountChange,
}: MultiPaymentInputProps) {
  const [isSplitMode, setIsSplitMode] = useState(false);
  const [discountRaw, setDiscountRaw] = useState<string>("");
  const [discountCurrency, setDiscountCurrency] = useState<string>(currency);
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
  const effectiveRate = parseFloat(customExchangeRate) || safeExchangeRate;

  // --- Discount logic ---
  const discountAmount = parseNum(discountRaw);

  /** Normalize discount from discountCurrency to totalAmountCurrency */
  const normalizeDiscount = (amt: number, fromCurr: string): number => {
    if (fromCurr === totalAmountCurrency) return amt;
    if (fromCurr === "LBP" && totalAmountCurrency === "USD")
      return amt / effectiveRate;
    if (fromCurr === "USD" && totalAmountCurrency === "LBP")
      return amt * effectiveRate;
    return amt;
  };

  const discountNormalized = normalizeDiscount(
    discountAmount,
    discountCurrency,
  );
  const clampedDiscount =
    maxDiscount !== undefined
      ? Math.min(discountNormalized, maxDiscount)
      : discountNormalized;
  const effectiveTotalAmount = Math.max(0, totalAmount - clampedDiscount);

  // Auto-sync discount currency with single payment line currency
  useEffect(() => {
    if (!isSplitMode && paymentLines.length === 1) {
      setDiscountCurrency(paymentLines[0].currencyCode);
    }
  }, [isSplitMode, paymentLines]);

  // Emit discount to parent
  useEffect(() => {
    onDiscountChange?.(clampedDiscount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clampedDiscount]);

  // Update custom rate when exchange rate prop changes
  useEffect(() => {
    setCustomExchangeRate(safeExchangeRate.toString());
    onExchangeRateChange?.(safeExchangeRate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeExchangeRate]);

  // Track single-mode line currency for auto-sync dependency
  const singleLineCurrency =
    !isSplitMode && paymentLines.length === 1
      ? paymentLines[0].currencyCode
      : null;

  // In single mode, auto-sync the line amount with effectiveTotalAmount (currency-aware)
  useEffect(() => {
    if (!isSplitMode && paymentLines.length === 1) {
      const line = paymentLines[0];
      // Convert effectiveTotalAmount (in totalAmountCurrency) to the line's currency
      let converted = effectiveTotalAmount;
      if (line.currencyCode !== totalAmountCurrency) {
        if (totalAmountCurrency === "USD" && line.currencyCode === "LBP") {
          converted = effectiveTotalAmount * effectiveRate;
        } else if (
          totalAmountCurrency === "LBP" &&
          line.currencyCode === "USD"
        ) {
          converted = effectiveTotalAmount / effectiveRate;
        }
      }
      if (line.amount !== converted) {
        const updated = [{ ...line, amount: converted }];
        setPaymentLines(updated);
        onChange(updated);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    totalAmount,
    isSplitMode,
    effectiveRate,
    singleLineCurrency,
    clampedDiscount,
  ]);

  const handleLinesChange = (newLines: PaymentLine[]) => {
    setPaymentLines(newLines);
    onChange(newLines);
  };

  const addPaymentLine = () => {
    // Calculate remaining in totalAmountCurrency, then convert to the new line's currency
    const remaining = effectiveTotalAmount - totalPaid;
    const newCurrency = currency;
    let autoAmount = 0;
    if (remaining > 0) {
      if (newCurrency === totalAmountCurrency) {
        autoAmount = remaining;
      } else if (newCurrency === "LBP" && totalAmountCurrency === "USD") {
        autoAmount = Math.round(remaining * effectiveRate);
      } else if (newCurrency === "USD" && totalAmountCurrency === "LBP") {
        autoAmount = parseFloat((remaining / effectiveRate).toFixed(2));
      } else {
        autoAmount = remaining;
      }
    }
    handleLinesChange([
      ...paymentLines,
      {
        id: crypto.randomUUID(),
        method: "CASH",
        currencyCode: newCurrency,
        amount: autoAmount,
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
    const updatedLines = paymentLines.map((line) => {
      if (line.id !== id) return line;
      const updated = { ...line, [field]: value };

      // Convert amount when currency changes
      if (field === "currencyCode" && value !== line.currencyCode) {
        const oldCurr = line.currencyCode;
        const newCurr = value as string;
        if (oldCurr === "USD" && newCurr === "LBP") {
          updated.amount = Math.round(line.amount * effectiveRate);
        } else if (oldCurr === "LBP" && newCurr === "USD") {
          updated.amount = parseFloat((line.amount / effectiveRate).toFixed(2));
        }
      }

      return updated;
    });

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

  /** Convert a payment line amount into the totalAmountCurrency.
   *  - If the line currency matches totalAmountCurrency → no conversion.
   *  - LBP → USD: divide by rate.   USD → LBP: multiply by rate. */
  const normalizeToTarget = (amount: number, lineCurrency: string): number => {
    if (lineCurrency === totalAmountCurrency) return amount;
    if (lineCurrency === "LBP" && totalAmountCurrency === "USD") {
      return amount / effectiveRate;
    }
    if (lineCurrency === "USD" && totalAmountCurrency === "LBP") {
      return amount * effectiveRate;
    }
    // Fallback for other currency pairs — treat as-is (no cross-rate support yet)
    return amount;
  };

  // Calculate total paid normalized to the totalAmountCurrency
  const totalPaid = paymentLines.reduce((sum, line) => {
    return sum + normalizeToTarget(line.amount || 0, line.currencyCode);
  }, 0);

  // Tolerance for matching: LBP amounts are large so use higher tolerance
  const matchTolerance = totalAmountCurrency === "LBP" ? 100 : 0.01;

  const hasDebt = paymentLines.some((line) => line.method === "DEBT");

  const getSymbol = (currencyCode: string): string => {
    const curr = currencies.find((c) => c.code === currencyCode);
    return curr?.symbol || "$";
  };

  // Summary formatting helpers — in single mode, display in the line's currency
  const displayCurrency =
    !isSplitMode && paymentLines.length === 1
      ? paymentLines[0].currencyCode
      : totalAmountCurrency;
  const targetSymbol = getSymbol(displayCurrency);
  const targetDecimals = displayCurrency === "LBP" ? 0 : 2;

  /** Convert a value from totalAmountCurrency to displayCurrency for summary */
  const toDisplayCurrency = (v: number): number => {
    if (displayCurrency === totalAmountCurrency) return v;
    if (totalAmountCurrency === "USD" && displayCurrency === "LBP")
      return v * effectiveRate;
    if (totalAmountCurrency === "LBP" && displayCurrency === "USD")
      return v / effectiveRate;
    return v;
  };

  const fmtTarget = (v: number) => {
    const abs = Math.abs(v);
    const fixed = abs.toFixed(targetDecimals);
    const parts = fixed.split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const formatted = parts.join(".");
    // Prefix symbols ($, €, £) go before the number, others (LBP) go after
    if (["$", "€", "£"].includes(targetSymbol)) {
      return `${targetSymbol}${formatted}`;
    }
    return `${formatted} ${targetSymbol}`;
  };

  const toggleSplitMode = () => {
    if (isSplitMode) {
      // Switching to single: reset to one line with full amount
      const singleLine: PaymentLine[] = [
        {
          id: crypto.randomUUID(),
          method: paymentLines[0]?.method || "CASH",
          currencyCode: paymentLines[0]?.currencyCode || currency,
          amount: effectiveTotalAmount,
        },
      ];
      setPaymentLines(singleLine);
      onChange(singleLine);
    }
    setIsSplitMode(!isSplitMode);
  };

  return (
    <div className="bg-slate-900/50 border border-slate-700/50 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/40">
        <span className="text-sm font-semibold text-slate-200 tracking-wide">
          {isSplitMode ? "Payment Split" : "Payment"}
        </span>
        <button
          type="button"
          onClick={toggleSplitMode}
          className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full transition-all ${
            isSplitMode
              ? "bg-violet-500/20 text-violet-300 border border-violet-500/40"
              : "bg-slate-800 text-slate-400 border border-slate-600 hover:text-slate-200 hover:border-slate-500"
          }`}
        >
          {isSplitMode ? (
            <>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
              </svg>
              Split Active
            </>
          ) : (
            <>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M16 3h5v5M4 20L21 3" />
              </svg>
              Split
            </>
          )}
        </button>
      </div>

      {/* Exchange Rate (split mode only) */}
      {isSplitMode && (
        <div className="flex items-center justify-center gap-2 px-4 py-2 bg-slate-800/40 border-b border-slate-700/30">
          <span className="text-xs text-slate-500">1 USD =</span>
          <input
            type="text"
            inputMode="decimal"
            value={fmtNum(customExchangeRate)}
            onChange={(e) => {
              const raw = e.target.value.replace(/,/g, "");
              setCustomExchangeRate(raw);
              const newRate = parseFloat(raw) || safeExchangeRate;
              onRateChange?.(newRate);
              onExchangeRateChange?.(newRate);
            }}
            className="w-28 bg-slate-900 border border-slate-600 rounded-lg px-3 py-1 text-white font-mono text-xs text-center focus:outline-none focus:border-violet-500 transition-colors"
            placeholder={fmtNum(safeExchangeRate)}
          />
          <span className="text-xs text-slate-500">LBP</span>
        </div>
      )}

      {/* Payment Lines */}
      <div className="px-4 py-3 space-y-2">
        {isSplitMode ? (
          <>
            {paymentLines.map((line, idx) => (
              <div
                key={line.id}
                className="bg-slate-800/60 border border-slate-700/40 rounded-xl p-3 space-y-2"
              >
                <div className="flex items-center gap-2">
                  {/* Line number badge */}
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-slate-700 text-slate-300 text-[10px] font-bold flex items-center justify-center">
                    {idx + 1}
                  </span>

                  {/* Payment Method */}
                  <select
                    value={line.method}
                    onChange={(e) =>
                      updatePaymentLine(line.id, "method", e.target.value)
                    }
                    className="flex-1 min-w-0 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500 transition-colors"
                  >
                    {paymentMethods.map((pm) => (
                      <option key={pm.code} value={pm.code}>
                        {pm.label}
                      </option>
                    ))}
                  </select>

                  {/* Currency */}
                  <select
                    value={line.currencyCode}
                    onChange={(e) =>
                      updatePaymentLine(line.id, "currencyCode", e.target.value)
                    }
                    className="w-20 bg-slate-900 border border-slate-600 rounded-lg px-2 py-2 text-white text-sm focus:outline-none focus:border-violet-500 transition-colors"
                  >
                    {currencies.map((curr) => (
                      <option key={curr.code} value={curr.code}>
                        {curr.code}
                      </option>
                    ))}
                  </select>

                  {/* Amount */}
                  <div className="relative w-32">
                    {["$", "€", "£"].includes(getSymbol(line.currencyCode)) && (
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">
                        {getSymbol(line.currencyCode)}
                      </span>
                    )}
                    <input
                      type="text"
                      inputMode="decimal"
                      value={fmtNum(line.amount)}
                      onChange={(e) =>
                        updatePaymentLine(
                          line.id,
                          "amount",
                          parseNum(e.target.value),
                        )
                      }
                      className={`w-full bg-slate-900 border border-slate-600 rounded-lg pr-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-violet-500 transition-colors ${
                        ["$", "€", "£"].includes(getSymbol(line.currencyCode))
                          ? "pl-7"
                          : "pl-3"
                      }`}
                      placeholder="0"
                    />
                  </div>

                  {/* Remove */}
                  <button
                    type="button"
                    disabled={paymentLines.length === 1}
                    onClick={() => removePaymentLine(line.id)}
                    className="flex-shrink-0 p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-20 disabled:hover:bg-transparent disabled:hover:text-slate-500 transition-all"
                    title="Remove"
                  >
                    <X size={14} />
                  </button>
                </div>

                {/* PM Fee sub-line */}
                {showPmFee && !CASH_EQUIVALENT_METHODS.has(line.method) && (
                  <div className="flex items-center gap-2 ml-7 pl-3 border-l-2 border-violet-500/30">
                    <span className="text-[11px] text-violet-400 whitespace-nowrap">
                      PM fee
                    </span>
                    <div className="relative w-24">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-violet-400 text-[10px]">
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
                        className="w-full bg-violet-950/40 border border-violet-700/40 rounded-md pl-5 pr-2 py-1 text-violet-200 text-xs font-mono focus:outline-none focus:border-violet-500"
                        placeholder="0.00"
                        step="0.01"
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Add payment line button */}
            <button
              type="button"
              onClick={addPaymentLine}
              className="w-full py-2 border-2 border-dashed border-slate-700 rounded-xl text-xs font-medium text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-all"
            >
              + Add Payment Line
            </button>
          </>
        ) : (
          /* Single payment mode */
          <div className="flex items-center gap-2">
            {/* Payment Method */}
            <select
              value={paymentLines[0]?.method || "CASH"}
              onChange={(e) =>
                updatePaymentLine(paymentLines[0]?.id, "method", e.target.value)
              }
              className="flex-1 min-w-0 bg-slate-800/80 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-violet-500 transition-colors"
            >
              {paymentMethods.map((pm) => (
                <option key={pm.code} value={pm.code}>
                  {pm.label}
                </option>
              ))}
            </select>

            {/* Currency */}
            <select
              value={paymentLines[0]?.currencyCode || currency}
              onChange={(e) =>
                updatePaymentLine(
                  paymentLines[0]?.id,
                  "currencyCode",
                  e.target.value,
                )
              }
              className="w-20 bg-slate-800/80 border border-slate-600 rounded-lg px-2 py-2.5 text-white text-sm focus:outline-none focus:border-violet-500 transition-colors"
            >
              {currencies.map((curr) => (
                <option key={curr.code} value={curr.code}>
                  {curr.code}
                </option>
              ))}
            </select>

            {/* Amount */}
            <div className="relative w-36">
              {["$", "€", "£"].includes(
                getSymbol(paymentLines[0]?.currencyCode || currency),
              ) && (
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
                  {getSymbol(paymentLines[0]?.currencyCode || currency)}
                </span>
              )}
              <input
                type="text"
                inputMode="decimal"
                value={fmtNum(paymentLines[0]?.amount)}
                onChange={(e) =>
                  updatePaymentLine(
                    paymentLines[0]?.id,
                    "amount",
                    parseNum(e.target.value),
                  )
                }
                className={`w-full bg-slate-800/80 border border-slate-600 rounded-lg pr-3 py-2.5 text-white text-sm font-mono focus:outline-none focus:border-violet-500 transition-colors ${
                  ["$", "€", "£"].includes(
                    getSymbol(paymentLines[0]?.currencyCode || currency),
                  )
                    ? "pl-7"
                    : "pl-3"
                }`}
                placeholder="0"
              />
            </div>
          </div>
        )}
      </div>

      {/* Summary */}
      <div className="px-4 py-3 bg-slate-800/30 border-t border-slate-700/40 space-y-1.5">
        {/* Provider fee breakdown */}
        {providerFee > 0 && (
          <>
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">Send Amount</span>
              <span className="font-mono text-white">
                {fmtTarget(toDisplayCurrency(totalAmount - providerFee))}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-amber-400">Provider Fee</span>
              <span className="font-mono text-amber-300">
                +{fmtTarget(toDisplayCurrency(providerFee))}
              </span>
            </div>
            <div className="flex justify-between text-xs pt-1 border-t border-slate-700/30">
              <span className="text-slate-300 font-medium">Subtotal</span>
              <span className="font-mono text-slate-200 font-medium">
                {fmtTarget(toDisplayCurrency(totalAmount))}
              </span>
            </div>
          </>
        )}
        {providerFee === 0 && (
          <div className="flex justify-between text-xs">
            <span className="text-slate-400">Total Amount</span>
            <span className="font-mono text-white">
              {fmtTarget(toDisplayCurrency(totalAmount))}
            </span>
          </div>
        )}

        {/* Discount */}
        {showDiscount && (
          <div className="flex items-center justify-between gap-2 py-1">
            <span className="text-xs text-emerald-400 font-medium">
              Discount
            </span>
            <div className="flex items-center gap-1.5">
              {isSplitMode && currencies.length > 1 && (
                <select
                  value={discountCurrency}
                  onChange={(e) => setDiscountCurrency(e.target.value)}
                  className="bg-slate-900 border border-emerald-700/40 rounded-md px-1.5 py-0.5 text-emerald-300 text-[11px] focus:outline-none focus:border-emerald-500"
                >
                  {currencies.map((curr) => (
                    <option key={curr.code} value={curr.code}>
                      {curr.code}
                    </option>
                  ))}
                </select>
              )}
              {!isSplitMode && (
                <span className="text-[11px] text-emerald-400/60">
                  {discountCurrency}
                </span>
              )}
              <div className="relative">
                {["$", "€", "£"].includes(getSymbol(discountCurrency)) && (
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-emerald-400 text-xs">
                    {getSymbol(discountCurrency)}
                  </span>
                )}
                <input
                  type="text"
                  inputMode="decimal"
                  value={discountRaw}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/,/g, "");
                    if (raw === "" || /^\d*\.?\d*$/.test(raw)) {
                      setDiscountRaw(raw);
                    }
                  }}
                  className={`w-24 bg-emerald-950/30 border rounded-md px-2 py-1 text-emerald-200 text-xs font-mono focus:outline-none focus:border-emerald-500 transition-colors ${
                    maxDiscount !== undefined &&
                    discountNormalized > maxDiscount
                      ? "border-red-500"
                      : "border-emerald-700/40"
                  } ${
                    ["$", "€", "£"].includes(getSymbol(discountCurrency))
                      ? "pl-5"
                      : "pl-2"
                  }`}
                  placeholder="0"
                />
              </div>
              {discountAmount > 0 && (
                <span className="font-mono text-emerald-400 text-xs">
                  -{fmtTarget(toDisplayCurrency(clampedDiscount))}
                </span>
              )}
            </div>
          </div>
        )}

        {/* After discount */}
        {showDiscount && clampedDiscount > 0 && (
          <div className="flex justify-between text-xs pt-1 border-t border-emerald-700/20">
            <span className="text-emerald-300 font-medium">After Discount</span>
            <span className="font-mono text-emerald-200 font-medium">
              {fmtTarget(toDisplayCurrency(effectiveTotalAmount))}
            </span>
          </div>
        )}

        {/* Discount cap warning */}
        {showDiscount &&
          maxDiscount !== undefined &&
          discountNormalized > maxDiscount && (
            <div className="text-[11px] text-red-400">
              Capped to max ({fmtTarget(toDisplayCurrency(maxDiscount))})
            </div>
          )}

        {/* Total Paid */}
        <div className="flex justify-between items-center text-xs pt-1.5 border-t border-slate-700/40">
          <span className="text-slate-300 font-medium">Paid</span>
          <span className="flex items-center gap-1.5">
            {Math.abs(totalPaid - effectiveTotalAmount) < matchTolerance ? (
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                className="text-emerald-400"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                className="text-red-400"
              >
                <circle cx="12" cy="12" r="10" strokeWidth="2" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            )}
            <span
              className={`font-mono font-semibold ${
                Math.abs(totalPaid - effectiveTotalAmount) < matchTolerance
                  ? "text-emerald-400"
                  : "text-red-400"
              }`}
            >
              {fmtTarget(toDisplayCurrency(totalPaid))}
            </span>
          </span>
        </div>

        {/* Remaining / Overpaid warning */}
        {Math.abs(totalPaid - effectiveTotalAmount) > matchTolerance && (
          <div
            className={`flex justify-between text-xs px-2 py-1 rounded-md ${
              totalPaid < effectiveTotalAmount
                ? "bg-red-500/10 border border-red-500/20"
                : "bg-amber-500/10 border border-amber-500/20"
            }`}
          >
            <span
              className={
                totalPaid < effectiveTotalAmount
                  ? "text-red-400"
                  : "text-amber-400"
              }
            >
              {totalPaid < effectiveTotalAmount
                ? "Remaining (Debt)"
                : "Overpaid"}
            </span>
            <span
              className={`font-mono font-bold ${
                totalPaid < effectiveTotalAmount
                  ? "text-red-400"
                  : "text-amber-400"
              }`}
            >
              {fmtTarget(
                toDisplayCurrency(Math.abs(totalPaid - effectiveTotalAmount)),
              )}
            </span>
          </div>
        )}

        {/* PM Fees & Grand Total */}
        {showPmFee && totalPmFees > 0 && (
          <div className="pt-1.5 mt-1 border-t border-violet-700/30 space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-violet-400">Wallet Surcharge</span>
              <span className="font-mono text-violet-300">
                +{fmtTarget(toDisplayCurrency(totalPmFees))}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-white font-semibold">Grand Total</span>
              <span className="font-mono text-white font-bold">
                {fmtTarget(toDisplayCurrency(totalPaid + totalPmFees))}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Validation Messages */}
      {hasDebt && requiresClientForDebt && !hasClient && totalAmount > 0 && (
        <div className="mx-4 mb-3 text-xs text-red-400 bg-red-500/10 px-3 py-2 rounded-lg border border-red-500/20 flex items-center gap-2">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          Client is required when using DEBT payment method
        </div>
      )}
    </div>
  );
}
