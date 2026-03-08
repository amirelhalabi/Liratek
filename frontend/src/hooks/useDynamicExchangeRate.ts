/**
 * useDynamicExchangeRate Hook
 *
 * Provides dynamic exchange rate selection based on:
 * - Selected currency (USD/LBP/EUR etc.)
 * - Transaction type (SALE, DEBT_PAYMENT, EXPENSE, etc.)
 * - Automatic rate selection (buy vs sell)
 *
 * Features:
 * - Auto-updates when currency changes
 * - Allows manual override per transaction
 * - Validates against configured rates
 * - Shows appropriate rate type indicator
 *
 * Usage:
 *   const { rate, setRate, rateInfo, loading } = useDynamicExchangeRate({
 *     selectedCurrency: "LBP",
 *     transactionType: "SALE",
 *     baseCurrency: "USD"
 *   });
 */

import { useState, useEffect } from "react";
import { useApi } from "@liratek/ui";
import {
  getExchangeRates,
  getRateForTransaction,
  type TransactionType,
  type RateInfo,
} from "@/utils/exchangeRates";

interface UseDynamicExchangeRateOptions {
  /** The currency selected for payment/transaction (e.g., "LBP", "USD", "EUR") */
  selectedCurrency: string;

  /** Type of transaction to determine buy/sell rate */
  transactionType: TransactionType;

  /** Base currency (usually "USD") */
  baseCurrency?: string;

  /** Fallback rate if no rate is configured */
  fallbackRate?: number;
}

interface UseDynamicExchangeRateResult {
  /** Current exchange rate */
  rate: number;

  /** Update the rate (for manual overrides) */
  setRate: (rate: number) => void;

  /** Rate information (type, description) */
  rateInfo: RateInfo;

  /** Whether rates are still loading */
  loading: boolean;

  /** All available rates */
  rates: Array<{ from_code: string; to_code: string; rate: number }>;

  /** Whether the current rate is using base currency (no conversion needed) */
  isBaseCurrency: boolean;
}

export function useDynamicExchangeRate({
  selectedCurrency,
  transactionType,
  baseCurrency = "USD",
  fallbackRate = 89000,
}: UseDynamicExchangeRateOptions): UseDynamicExchangeRateResult {
  const api = useApi();

  const [rates, setRates] = useState<
    Array<{ from_code: string; to_code: string; rate: number }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [rate, setRate] = useState<number>(fallbackRate);

  // Check if selected currency is the base currency (no conversion needed)
  const isBaseCurrency = selectedCurrency === baseCurrency;

  // Load rates on mount
  useEffect(() => {
    const loadRates = async () => {
      try {
        const ratesList = await api.getRates();
        setRates(ratesList);
      } catch (error) {
        console.error("Failed to load rates:", error);
      } finally {
        setLoading(false);
      }
    };
    loadRates();
  }, [api]);

  // Update rate when currency or transaction type changes
  useEffect(() => {
    // Always get the appropriate rate based on transaction type
    // Even for base currency (USD), we show the rate for display/conversion purposes
    const exchangeRates = getExchangeRates(rates, fallbackRate);
    const rateInfo = getRateForTransaction(transactionType, exchangeRates);
    setRate(rateInfo.rate);
  }, [selectedCurrency, transactionType, rates, fallbackRate]);

  // Get current rate info for display
  const getRateInfo = (): RateInfo => {
    // Always show the rate info based on transaction type
    const exchangeRates = getExchangeRates(rates, fallbackRate);
    return getRateForTransaction(transactionType, exchangeRates);
  };

  return {
    rate,
    setRate,
    rateInfo: getRateInfo(),
    loading,
    rates,
    isBaseCurrency,
  };
}
