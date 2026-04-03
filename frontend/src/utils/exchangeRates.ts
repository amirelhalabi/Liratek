/**
 * Exchange Rate Selection Utilities
 *
 * Provides automatic rate selection based on transaction type and direction.
 * Follows industry standard: Money IN = Sell Rate (higher), Money OUT = Buy Rate (lower)
 */

export type RateType = "BUY" | "SELL" | "N/A";

export interface RateInfo {
  rate: number;
  rateType: RateType;
  description: string;
}

export type TransactionType =
  | "SALE"
  | "DEBT_PAYMENT"
  | "REFUND"
  | "EXCHANGE_BUY_USD" // Customer buys USD from us (we sell)
  | "EXCHANGE_SELL_USD" // Customer sells USD to us (we buy)
  | "EXPENSE"
  | "SERVICE_PAYMENT"
  | "CUSTOM_SERVICE";

export interface ExchangeRates {
  buyRate: number; // We Buy USD from customer - Lower rate (89,000 LBP per 1 USD)
  sellRate: number; // We Sell USD to customer - Higher rate (89,500 LBP per 1 USD)
}

export interface CurrencyPair {
  fromCurrency: string;
  toCurrency: string;
}

// Note: TransactionType is defined above. RateType ('BUY'|'SELL'|'N/A') is used for rate direction.

/**
 * Get exchange rates from rate list (USD/LBP).
 *
 * Supports TWO formats returned by api.getRates():
 *
 * **New 4-column schema** (current):
 *   { to_code, market_rate, delta, is_stronger }
 *   Formula: rate = market_rate + is_stronger × (action × delta)
 *     TAKE_USD (−1) → buyRate  (we buy USD from customer, lower rate)
 *     GIVE_USD (+1) → sellRate (we sell USD to customer, higher rate)
 *
 * **Legacy from/to schema** (fallback):
 *   { from_code, to_code, rate }
 *
 * @param rates - Array of exchange rate objects from database
 * @param fallbackRate - Default rate if not found (default: 89,000)
 * @returns Object with buyRate and sellRate for USD/LBP
 *
 * @example
 * const rates = await api.getRates();
 * const { buyRate, sellRate } = getExchangeRates(rates);
 * // buyRate: 89,000 (we buy USD — lower, favorable to us)
 * // sellRate: 90,000 (we sell USD — higher, favorable to us)
 */
export function getExchangeRates(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rates: Array<any>,
  fallbackRate: number = 89000,
): ExchangeRates {
  // ── New 4-column schema: { to_code, market_rate, delta, is_stronger } ──────
  const lbpRow = rates.find(
    (r) => r.to_code === "LBP" && r.market_rate !== undefined,
  );
  if (lbpRow) {
    const { market_rate, delta } = lbpRow;
    // buyRate = we pay customer less LBP per USD (lower, favorable to us)
    // sellRate = customer pays us more LBP per USD (higher, favorable to us)
    const buyRate = market_rate - delta;
    const sellRate = market_rate + delta;
    return { buyRate, sellRate };
  }

  // ── Legacy from/to schema: { from_code, to_code, rate } ───────────────────
  const buyRateEntry = rates.find(
    (r: { from_code?: string; to_code?: string }) =>
      r.from_code === "LBP" && r.to_code === "USD",
  );
  const sellRateEntry = rates.find(
    (r: { from_code?: string; to_code?: string }) =>
      r.from_code === "USD" && r.to_code === "LBP",
  );

  return {
    buyRate: buyRateEntry?.rate || fallbackRate,
    sellRate: sellRateEntry?.rate || fallbackRate + 500,
  };
}

/**
 * Get the appropriate rate for a transaction type
 *
 * Rules:
 * - Money IN (Revenue): Use SELL rate (higher) - customer pays us
 * - Money OUT (Expense): Use BUY rate (lower) - we pay customer/supplier
 */
export function getRateForTransaction(
  transactionType: TransactionType,
  rates: ExchangeRates,
): RateInfo {
  switch (transactionType) {
    case "SALE":
      return {
        rate: rates.sellRate,
        rateType: "SELL",
        description: "💰 We Sell USD rate (Customer pays us in LBP)",
      };

    case "DEBT_PAYMENT":
      return {
        rate: rates.sellRate,
        rateType: "SELL",
        description: "💰 We Sell USD rate (Money IN from customer)",
      };

    case "SERVICE_PAYMENT":
    case "CUSTOM_SERVICE":
      return {
        rate: rates.sellRate,
        rateType: "SELL",
        description: "💰 We Sell USD rate (Customer pays us)",
      };

    case "REFUND":
      return {
        rate: rates.buyRate,
        rateType: "BUY",
        description: "💸 We Buy USD rate (Money OUT to customer)",
      };

    case "EXPENSE":
      return {
        rate: rates.buyRate,
        rateType: "BUY",
        description: "💸 We Buy USD rate (Money OUT to supplier)",
      };

    case "EXCHANGE_BUY_USD":
      // Customer buys USD from us - we're selling USD to them
      return {
        rate: rates.sellRate,
        rateType: "SELL",
        description: "💰 We Sell USD rate (Customer buys USD)",
      };

    case "EXCHANGE_SELL_USD":
      // Customer sells USD to us - we're buying USD from them
      return {
        rate: rates.buyRate,
        rateType: "BUY",
        description: "💸 We Buy USD rate (Customer sells USD)",
      };

    default:
      return {
        rate: rates.sellRate,
        rateType: "SELL",
        description: "Default rate",
      };
  }
}

/**
 * Get rate label for display
 */
export function getRateLabel(rateType: RateType): string {
  switch (rateType) {
    case "BUY":
      return "We Buy USD (Lower)";
    case "SELL":
      return "We Sell USD (Higher)";
    case "N/A":
      return "N/A";
    default:
      return "";
  }
}

/**
 * Format rate for display
 */
export function formatRate(rate: number): string {
  return `1 USD = ${rate.toLocaleString()} LBP`;
}

// ============================================================================
// Multi-Currency Support (Phase 2 & 3)
// ============================================================================

/**
 * Get direct exchange rate between two currencies (if exists in database)
 *
 * Looks up the rate from the database for a specific currency pair and transaction type.
 * Returns null if no direct rate is configured.
 *
 * @param fromCurrency - Currency customer is giving us
 * @param toCurrency - Currency we are giving customer
 * @param rates - All available exchange rates from database
 * @param transactionType - 'BUY' = we buy FROM currency from customer, 'SELL' = we sell FROM currency to customer
 * @returns Exchange rate if found, null otherwise
 *
 * @example
 * // Get rate for buying EUR from customer
 * const rate = getDirectRate('EUR', 'USD', rates, 'BUY');
 * // Returns: 1.16 (we buy EUR at 1.16 USD per EUR)
 *
 * @example
 * // Get rate for selling EUR to customer
 * const rate = getDirectRate('USD', 'EUR', rates, 'BUY');
 * // Returns: 1.20 (customer pays 1.20 USD per EUR)
 */
export function getDirectRate(
  fromCurrency: string,
  toCurrency: string,
  rates: Array<{ from_code: string; to_code: string; rate: number }>,
  transactionType: "BUY" | "SELL",
): number | null {
  // For BUY: Customer gives FROM, we give TO → Use from→to rate (we buy FROM from customer)
  // For SELL: Customer gives TO, we give FROM → Use to→from rate (we sell FROM to customer)

  if (transactionType === "BUY") {
    // We are buying FROM currency from customer
    // Look for FROM → TO rate in database
    const rate = rates.find(
      (r) => r.from_code === fromCurrency && r.to_code === toCurrency,
    );
    return rate?.rate || null;
  } else {
    // We are selling FROM currency to customer (they're buying FROM from us)
    // Look for TO → FROM rate in database (the inverse direction)
    const rate = rates.find(
      (r) => r.from_code === toCurrency && r.to_code === fromCurrency,
    );
    return rate?.rate || null;
  }
}

/**
 * Calculate cross-currency rate through USD base currency
 *
 * For currency pairs without a direct rate (e.g., EUR ↔ LBP), this function
 * calculates the effective rate by converting through USD as an intermediary.
 *
 * **Example: EUR → LBP conversion**
 * - Customer gives: EUR, wants: LBP (we BUY EUR from them)
 * - Step 1: EUR → USD (sell their EUR at high rate: 1 EUR = 1.2 USD)
 * - Step 2: USD → LBP (buy USD cheap: 1 USD = 89,000 LBP)
 * - Result: 1 EUR = 106,800 LBP
 *
 * @param fromCurrency - Currency customer gives us
 * @param toCurrency - Currency we give customer
 * @param rates - All available exchange rates from database
 * @param transactionType - 'BUY' = we buy FROM currency from customer, 'SELL' = we sell FROM currency to customer
 * @returns Calculated cross-currency rate
 * @throws Error if required intermediate rates are not found
 *
 * @example
 * // Calculate EUR to LBP rate
 * const rate = getCrossCurrencyRate('EUR', 'LBP', rates, 'BUY');
 * // Returns: 106,800 (1 EUR = 106,800 LBP via USD)
 */
export function getCrossCurrencyRate(
  fromCurrency: string,
  toCurrency: string,
  rates: Array<{ from_code: string; to_code: string; rate: number }>,
  transactionType: "BUY" | "SELL",
): number {
  // Base currency for cross-currency calculations is USD

  // IMPORTANT: This function returns a rate that represents "1 FROM = X TO"
  // For LBP→EUR: Returns "1 LBP = X EUR" (a small number like 0.0000096)
  // For EUR→LBP: Returns "1 EUR = X LBP" (a large number like 106,800)

  // Step 1: Convert FROM to USD
  // We need to figure out: 1 FROM = ? USD

  let oneFromInUsd: number;

  if (fromCurrency === "LBP") {
    // LBP → USD: rates stored as "1 USD = X LBP", so 1 LBP = 1/X USD
    // For BUY transaction (we buy FROM from customer), we SELL USD to them
    const lbpToUsdRate =
      transactionType === "BUY"
        ? rates.find((r) => r.from_code === "USD" && r.to_code === "LBP")?.rate // SELL USD rate (89,500)
        : rates.find((r) => r.from_code === "LBP" && r.to_code === "USD")?.rate; // BUY USD rate (88,500)

    if (!lbpToUsdRate) throw new Error(`Cannot find LBP→USD rate`);
    oneFromInUsd = 1 / lbpToUsdRate; // 1 LBP = 1/89,500 USD
  } else if (fromCurrency === "EUR") {
    // EUR → USD: rates stored as "1 EUR = X USD"
    // For BUY transaction (we buy EUR from customer), we pay at BUY rate
    const eurToUsdRate =
      transactionType === "BUY"
        ? rates.find((r) => r.from_code === "EUR" && r.to_code === "USD")?.rate // BUY EUR rate (1.16)
        : rates.find((r) => r.from_code === "USD" && r.to_code === "EUR")?.rate; // SELL EUR rate (1.20)

    if (!eurToUsdRate) throw new Error(`Cannot find EUR→USD rate`);

    if (transactionType === "BUY") {
      oneFromInUsd = eurToUsdRate; // 1 EUR = 1.16 USD
    } else {
      oneFromInUsd = 1 / eurToUsdRate; // 1 EUR = 1/1.20 USD (if selling)
    }
  } else {
    throw new Error(`Unsupported FROM currency: ${fromCurrency}`);
  }

  // Step 2: Convert USD to TO
  // We need to figure out: 1 USD = ? TO

  let oneUsdInTo: number;

  if (toCurrency === "LBP") {
    // USD → LBP: rates stored as "1 USD = X LBP"
    const usdToLbpRate =
      transactionType === "BUY"
        ? rates.find((r) => r.from_code === "LBP" && r.to_code === "USD")?.rate // BUY USD rate (88,500)
        : rates.find((r) => r.from_code === "USD" && r.to_code === "LBP")?.rate; // SELL USD rate (89,500)

    if (!usdToLbpRate) throw new Error(`Cannot find USD→LBP rate`);
    oneUsdInTo = usdToLbpRate; // 1 USD = 88,500 or 89,500 LBP
  } else if (toCurrency === "EUR") {
    // USD → EUR: rates stored as "1 EUR = X USD", so 1 USD = 1/X EUR
    const usdToEurRate =
      transactionType === "BUY"
        ? rates.find((r) => r.from_code === "EUR" && r.to_code === "USD")?.rate // BUY EUR rate (1.16)
        : rates.find((r) => r.from_code === "USD" && r.to_code === "EUR")?.rate; // SELL EUR rate (1.20)

    if (!usdToEurRate) throw new Error(`Cannot find USD→EUR rate`);
    oneUsdInTo = 1 / usdToEurRate; // 1 USD = 1/1.16 EUR or 1/1.20 EUR
  } else {
    throw new Error(`Unsupported TO currency: ${toCurrency}`);
  }

  // Combine: 1 FROM = (1 FROM in USD) × (1 USD in TO)
  // Example LBP→EUR: (1/89,500) × (1/1.16) = 0.0000096 EUR per LBP
  // Example EUR→LBP: 1.16 × 88,500 = 102,660 LBP per EUR
  return oneFromInUsd * oneUsdInTo;
}

/**
 * Get exchange rate for any currency pair (direct or cross-currency)
 *
 * This is the main entry point for getting exchange rates. It automatically:
 * 1. Returns 1 if currencies are the same
 * 2. Tries to find a direct rate in the database
 * 3. Falls back to cross-currency calculation through USD if needed
 *
 * @param pair - Currency pair object with fromCurrency and toCurrency
 * @param rates - All available exchange rates from database
 * @param transactionType - 'BUY' = we buy FROM currency from customer, 'SELL' = we sell FROM currency to customer
 * @returns Exchange rate (always returns a number, throws if calculation fails)
 *
 * @example
 * // Get direct rate (EUR → USD)
 * const rate1 = getExchangeRateForPair(
 *   { fromCurrency: 'EUR', toCurrency: 'USD' },
 *   rates,
 *   'BUY'
 * );
 * // Returns: 1.16
 *
 * @example
 * // Get cross-currency rate (EUR → LBP via USD)
 * const rate2 = getExchangeRateForPair(
 *   { fromCurrency: 'EUR', toCurrency: 'LBP' },
 *   rates,
 *   'BUY'
 * );
 * // Returns: 106,800
 */
export function getExchangeRateForPair(
  pair: CurrencyPair,
  rates: Array<{ from_code: string; to_code: string; rate: number }>,
  transactionType: "BUY" | "SELL",
): number {
  const { fromCurrency, toCurrency } = pair;

  // Same currency - no conversion
  if (fromCurrency === toCurrency) return 1;

  // Try direct rate first
  const directRate = getDirectRate(
    fromCurrency,
    toCurrency,
    rates,
    transactionType,
  );
  if (directRate !== null) return directRate;

  // Fall back to cross-currency calculation through USD
  return getCrossCurrencyRate(fromCurrency, toCurrency, rates, transactionType);
}

/**
 * Determine if conversion should multiply or divide by rate
 *
 * OPTION B - MIXED BASE CURRENCIES (Stronger currency as base):
 * - **LBP (weaker)**: Rates stored as "1 USD = X LBP"
 *   - Example: 88,500 LBP (BUY), 89,500 LBP (SELL)
 * - **EUR (stronger)**: Rates stored as "1 EUR = X USD"
 *   - Example: 1.16 USD (BUY), 1.20 USD (SELL)
 *
 * **Conversion Rules:**
 * - LBP → USD: DIVIDE (89,500 LBP ÷ 89,500 = 1 USD)
 * - USD → LBP: MULTIPLY (1 USD × 89,500 = 89,500 LBP)
 * - EUR → USD: MULTIPLY (1 EUR × 1.16 = 1.16 USD)
 * - USD → EUR: DIVIDE (12 USD ÷ 1.20 = 10 EUR)
 *
 * @param fromCurrency - Source currency code
 * @param toCurrency - Target currency code
 * @param rate - The exchange rate value (not used in logic, kept for signature compatibility)
 * @returns 'MULTIPLY' or 'DIVIDE' operation to apply
 *
 * @example
 * const op = getConversionOperation('EUR', 'USD', 1.16);
 * // Returns: 'MULTIPLY'
 * const usd = 10 * 1.16; // = 11.6 USD
 */
export function getConversionOperation(
  fromCurrency: string,
  toCurrency: string,
  _rate: number,
): "MULTIPLY" | "DIVIDE" {
  // === LBP conversions (1 USD = X LBP format) ===

  // FROM LBP TO USD: DIVIDE
  // Example: 89,500 LBP ÷ 89,500 = 1 USD
  if (fromCurrency === "LBP" && toCurrency === "USD") {
    return "DIVIDE";
  }

  // FROM USD TO LBP: MULTIPLY
  // Example: 1 USD × 89,500 = 89,500 LBP
  if (fromCurrency === "USD" && toCurrency === "LBP") {
    return "MULTIPLY";
  }

  // === EUR conversions (1 EUR = X USD format) ===

  // FROM EUR TO USD: MULTIPLY
  // Example: 10 EUR × 1.16 = 11.6 USD
  if (fromCurrency === "EUR" && toCurrency === "USD") {
    return "MULTIPLY";
  }

  // FROM USD TO EUR: DIVIDE
  // Rate now stored directly as 1.20 (1 EUR = 1.20 USD)
  // To convert USD to EUR: divide USD by rate
  // Example: 12 USD ÷ 1.20 = 10 EUR
  if (fromCurrency === "USD" && toCurrency === "EUR") {
    return "DIVIDE";
  }

  // Cross-currency (e.g., EUR → LBP)
  // These use calculated rates, still multiply
  if (fromCurrency !== "USD" && toCurrency !== "USD") {
    return "MULTIPLY";
  }

  // Default: multiply
  return "MULTIPLY";
}
