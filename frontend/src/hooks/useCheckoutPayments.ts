import { useState, useCallback, useMemo } from "react";
import { useDynamicExchangeRate } from "@/hooks/useDynamicExchangeRate";
import { convertLBPToUSD } from "@/utils/paymentUtils";

type PaymentCurrencyCode = "USD" | "LBP";

export interface PaymentLine {
  id: string;
  method: string;
  currency_code: PaymentCurrencyCode;
  amount: number;
}

interface UseCheckoutPaymentsProps {
  totalAmount: number;
}

interface UseCheckoutPaymentsReturn {
  // State
  paymentLines: PaymentLine[];
  discount: number;
  customExchangeRate: string;
  exchangeRate: number;
  selectedCurrency: "USD" | "LBP";

  // Computed values
  paidUSD: number;
  paidLBP: number;
  finalAmount: number;
  effectiveExchangeRate: number;
  totalPaidInUSD: number;
  remaining: number;
  change: number;

  // Actions
  setDiscount: (discount: number) => void;
  setCustomExchangeRate: (rate: string) => void;
  addPaymentLine: () => void;
  updatePaymentLine: (index: number, updates: Partial<PaymentLine>) => void;
  removePaymentLine: (index: number) => void;
  setPaymentLines: React.Dispatch<React.SetStateAction<PaymentLine[]>>;
  resetPayments: () => void;
}

/**
 * Custom hook for managing checkout payment state and calculations
 */
export function useCheckoutPayments({
  totalAmount,
}: UseCheckoutPaymentsProps): UseCheckoutPaymentsReturn {
  // Payment State
  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([
    {
      id: crypto.randomUUID(),
      method: "CASH",
      currency_code: "USD",
      amount: 0,
    },
  ]);

  const [discountLocal, setDiscountLocal] = useState(0);
  const [customExchangeRate, setCustomExchangeRate] = useState<string>("");

  // Determine selected currency from payment lines
  const selectedCurrency = useMemo(() => {
    const hasLBPPayment = paymentLines.some(
      (line) => line.currency_code === "LBP",
    );
    return hasLBPPayment ? "LBP" : "USD";
  }, [paymentLines]);

  // Dynamic exchange rate for SALE transaction (Money IN = We Sell USD rate)
  const {
    rate: exchangeRate,
    rateInfo: _rateInfo,
    isBaseCurrency: _isBaseCurrency,
  } = useDynamicExchangeRate({
    selectedCurrency,
    transactionType: "SALE",
  });

  // Update custom rate when auto rate changes
  const [lastExchangeRate, setLastExchangeRate] = useState(exchangeRate);
  if (exchangeRate !== lastExchangeRate && !customExchangeRate) {
    setCustomExchangeRate(exchangeRate.toString());
    setLastExchangeRate(exchangeRate);
  }

  // Calculate totals
  const paidUSD = useMemo(
    () =>
      paymentLines
        .filter((p) => p.currency_code === "USD")
        .reduce((acc, p) => acc + (p.amount || 0), 0),
    [paymentLines],
  );

  const paidLBP = useMemo(
    () =>
      paymentLines
        .filter((p) => p.currency_code === "LBP")
        .reduce((acc, p) => acc + (p.amount || 0), 0),
    [paymentLines],
  );

  const finalAmount = Math.max(0, totalAmount - discountLocal);
  const effectiveExchangeRate = parseFloat(customExchangeRate) || exchangeRate;
  const totalPaidInUSD =
    paidUSD + convertLBPToUSD(paidLBP, effectiveExchangeRate);
  const remaining = Math.max(0, finalAmount - totalPaidInUSD);
  const change = Math.max(0, totalPaidInUSD - finalAmount);

  // Actions
  const addPaymentLine = useCallback(() => {
    setPaymentLines((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        method: "CASH",
        currency_code: "USD",
        amount: 0,
      },
    ]);
  }, []);

  const updatePaymentLine = useCallback(
    (index: number, updates: Partial<PaymentLine>) => {
      setPaymentLines((prev) =>
        prev.map((line, i) => (i === index ? { ...line, ...updates } : line)),
      );
    },
    [],
  );

  const removePaymentLine = useCallback((index: number) => {
    setPaymentLines((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const resetPayments = useCallback(() => {
    setPaymentLines([
      {
        id: crypto.randomUUID(),
        method: "CASH",
        currency_code: "USD",
        amount: 0,
      },
    ]);
    setDiscountLocal(0);
    setCustomExchangeRate("");
  }, []);

  return {
    // State
    paymentLines,
    discount: discountLocal,
    customExchangeRate,
    exchangeRate,
    selectedCurrency,

    // Computed values
    paidUSD,
    paidLBP,
    finalAmount,
    effectiveExchangeRate,
    totalPaidInUSD,
    remaining,
    change,

    // Actions
    setDiscount: setDiscountLocal,
    setCustomExchangeRate,
    addPaymentLine,
    updatePaymentLine,
    removePaymentLine,
    setPaymentLines,
    resetPayments,
  };
}
