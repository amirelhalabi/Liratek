/**
 * Exchange Service
 *
 * Business logic layer for currency exchange operations.
 * Uses the universal CurrencyConverter (calculateExchange) for all calculations.
 * USD is the base/pivot currency — all cross-currency exchanges route through USD.
 */

import {
  ExchangeRepository,
  getExchangeRepository,
  type ExchangeTransactionEntity,
  type CreateExchangeData,
} from "../repositories/index.js";
import { getRateRepository } from "../repositories/index.js";
import { calculateExchange } from "../utils/currencyConverter.js";
import { exchangeLogger } from "../utils/logger.js";

// =============================================================================
// Types
// =============================================================================

export interface ExchangeOpResult {
  success: boolean;
  id?: number;
  error?: string;
}

/** @deprecated Use ExchangeOpResult */
export type ExchangeResult = ExchangeOpResult;

export interface AddExchangeInput {
  fromCurrency: string;
  toCurrency: string;
  amountIn: number;
  clientName?: string;
  note?: string;
}

// =============================================================================
// Exchange Service Class
// =============================================================================

export class ExchangeService {
  private exchangeRepo: ExchangeRepository;

  constructor(exchangeRepo?: ExchangeRepository) {
    this.exchangeRepo = exchangeRepo ?? getExchangeRepository();
  }

  // ---------------------------------------------------------------------------
  // Transaction Operations
  // ---------------------------------------------------------------------------

  /**
   * Add a new exchange transaction.
   *
   * Loads rates from DB, runs the universal calculator, then stores
   * full leg breakdown (leg1/leg2 rates and profits).
   */
  addTransaction(input: AddExchangeInput): ExchangeOpResult {
    try {
      // 1. Load rates from DB
      const rates = getRateRepository().findAllAsCurrencyRates();

      // 2. Run the universal calculator (1 or 2 legs, any currency pair)
      const result = calculateExchange(
        input.fromCurrency,
        input.toCurrency,
        input.amountIn,
        rates,
      );

      const leg1 = result.legs[0];
      const leg2 = result.legs[1]; // undefined for direct exchanges

      // 3. Build repository input with full leg data
      const txData: CreateExchangeData = {
        fromCurrency: input.fromCurrency,
        toCurrency: input.toCurrency,
        amountIn: input.amountIn,
        amountOut: result.totalAmountOut,
        leg1Rate: leg1.rate,
        leg1MarketRate: leg1.marketRate,
        leg1ProfitUsd: leg1.profitUsd,
        leg2Rate: leg2?.rate,
        leg2MarketRate: leg2?.marketRate,
        leg2ProfitUsd: leg2?.profitUsd,
        viaCurrency: result.viaCurrency ?? undefined,
        totalProfitUsd: result.totalProfitUsd,
        clientName: input.clientName,
        note: input.note,
      };

      const { id } = this.exchangeRepo.createTransaction(txData);

      exchangeLogger.info(
        {
          id,
          fromCurrency: input.fromCurrency,
          toCurrency: input.toCurrency,
          amountIn: input.amountIn,
          amountOut: result.totalAmountOut,
          legs: result.legs.length,
          viaCurrency: result.viaCurrency,
          totalProfitUsd: result.totalProfitUsd,
        },
        `Exchange: ${input.amountIn} ${input.fromCurrency} → ${result.totalAmountOut} ${input.toCurrency}` +
          (result.viaCurrency ? ` via ${result.viaCurrency}` : "") +
          ` | Profit: $${result.totalProfitUsd.toFixed(4)}`,
      );

      return { success: true, id };
    } catch (error) {
      exchangeLogger.error(
        { error, input },
        "Failed to add exchange transaction",
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Query Operations
  // ---------------------------------------------------------------------------

  /**
   * Get exchange transaction history
   */
  getHistory(limit: number = 50): ExchangeTransactionEntity[] {
    try {
      return this.exchangeRepo.getHistory(limit);
    } catch (error) {
      exchangeLogger.error({ error, limit }, "Failed to get exchange history");
      return [];
    }
  }

  /**
   * Get today's exchange transactions
   */
  getTodayTransactions(): ExchangeTransactionEntity[] {
    return this.exchangeRepo.getTodayTransactions();
  }

  /**
   * Get today's exchange statistics
   */
  getTodayStats() {
    return this.exchangeRepo.getTodayStats();
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let exchangeServiceInstance: ExchangeService | null = null;

export function getExchangeService(): ExchangeService {
  if (!exchangeServiceInstance) {
    exchangeServiceInstance = new ExchangeService();
  }
  return exchangeServiceInstance;
}

/** Reset the singleton (for testing) */
export function resetExchangeService(): void {
  exchangeServiceInstance = null;
}
