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
  ExchangeLotRepository,
  getExchangeLotRepository,
  type SourceSummary,
  type SettlerSummary,
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
  /**
   * The FINAL persisted `profit_usd` on the created exchange row —
   * `ExchangeRepository.createTransaction`'s `bookedProfitUsd` (a re-read
   * of the row, never a recomputation). ALWAYS present when `success` is
   * true; absent on failure. Additive alongside `realizedProfitUsd` below —
   * that field keeps its EXACT existing semantics (only set on a to-side
   * FIFO consume; asserted by lira-web-022) and must not be conflated with
   * this one: `bookedProfitUsd` is "what got booked" on every exchange,
   * `realizedProfitUsd` is specifically "what FIFO realized on a consume".
   */
  bookedProfitUsd?: number;
  /**
   * EXCHANGE_LOT_SETTLEMENT.md Phase 3 — the SERVER-computed realized profit
   * from `ExchangeRepository.createTransaction`'s lot engine, present ONLY
   * when a to-side FIFO consume happened (an exotic `toCurrency`). The
   * frontend's `session.linkTransaction` must use THIS number, never its own
   * pre-submit preview (FEATURE_GUIDE §13 walkthrough item 9) — Phase 4/5
   * wiring, plumbed through here now so the contract exists end-to-end.
   */
  realizedProfitUsd?: number;
  lotCoveredQty?: number;
  lotMarketQty?: number;
}

/** @deprecated Use ExchangeOpResult */
export type ExchangeResult = ExchangeOpResult;

/**
 * EXCHANGE_LOT_SETTLEMENT.md Phase 4b — a history row enriched with its lot
 * data. `lot_summary` (from `ExchangeLotRepository.getSummaryForSources`) is
 * populated when THIS exchange created a lot (an exotic-currency BUY leg);
 * `settler_summary` (from `getSummaryForSettlers`) is populated when THIS
 * exchange consumed lot(s) (an exotic-currency SELL leg). Both are `null`
 * for a row that never touched a lot (USD<->LBP, or a lot lookup failure —
 * see `attachLotSummaries`'s doc). Reuses `SourceSummary`/`SettlerSummary`
 * verbatim (rule 14) rather than re-declaring the same shape here.
 */
export type ExchangeHistoryRow = ExchangeTransactionEntity & {
  lot_summary: SourceSummary | null;
  settler_summary: SettlerSummary | null;
};

export interface AddExchangeInput {
  fromCurrency: string;
  toCurrency: string;
  amountIn: number;
  clientName?: string;
  note?: string;
  transaction_time?: string;
  /** LIRA-081: for-partner exchange — see CreateExchangeData for the model. */
  partnerId?: number;
  partnerMode?: "FOR";
  /** Split payout — see CreateExchangeData.payments for the full contract. */
  payments?: CreateExchangeData["payments"];
  tender_exchange_rate?: number;
}

// =============================================================================
// Exchange Service Class
// =============================================================================

export class ExchangeService {
  private exchangeRepo: ExchangeRepository;
  private lotRepo: ExchangeLotRepository;

  constructor(exchangeRepo?: ExchangeRepository, lotRepo?: ExchangeLotRepository) {
    this.exchangeRepo = exchangeRepo ?? getExchangeRepository();
    this.lotRepo = lotRepo ?? getExchangeLotRepository();
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
      if (input.transaction_time) {
        const txTime = new Date(input.transaction_time);
        if (isNaN(txTime.getTime())) {
          throw new Error("Invalid transaction_time format");
        }
        if (txTime > new Date()) {
          throw new Error("transaction_time cannot be in the future");
        }
      }

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
        transaction_time: input.transaction_time,
        partnerId: input.partnerId,
        partnerMode: input.partnerMode,
        payments: input.payments,
        tender_exchange_rate: input.tender_exchange_rate,
      };

      const { id, bookedProfitUsd, realizedProfitUsd, lotCoveredQty, lotMarketQty } =
        this.exchangeRepo.createTransaction(txData);

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
          realizedProfitUsd,
        },
        `Exchange: ${input.amountIn} ${input.fromCurrency} → ${result.totalAmountOut} ${input.toCurrency}` +
          (result.viaCurrency ? ` via ${result.viaCurrency}` : "") +
          ` | Profit: $${result.totalProfitUsd.toFixed(4)}`,
      );

      return {
        success: true,
        id,
        bookedProfitUsd,
        ...(realizedProfitUsd !== undefined
          ? { realizedProfitUsd, lotCoveredQty, lotMarketQty }
          : {}),
      };
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

  /**
   * Add a pre-calculated exchange transaction directly.
   * Used for API-currency exchanges where rates come from external API
   * and are already calculated by the frontend.
   */
  addDirectTransaction(data: CreateExchangeData): ExchangeOpResult {
    try {
      if (data.transaction_time) {
        const txTime = new Date(data.transaction_time);
        if (isNaN(txTime.getTime())) {
          throw new Error("Invalid transaction_time format");
        }
        if (txTime > new Date()) {
          throw new Error("transaction_time cannot be in the future");
        }
      }

      const { id, bookedProfitUsd, realizedProfitUsd, lotCoveredQty, lotMarketQty } =
        this.exchangeRepo.createTransaction(data);
      exchangeLogger.info(
        {
          id,
          fromCurrency: data.fromCurrency,
          toCurrency: data.toCurrency,
          amountIn: data.amountIn,
          amountOut: data.amountOut,
          totalProfitUsd: data.totalProfitUsd,
          realizedProfitUsd,
        },
        "Direct exchange transaction created",
      );
      return {
        success: true,
        id,
        bookedProfitUsd,
        ...(realizedProfitUsd !== undefined
          ? { realizedProfitUsd, lotCoveredQty, lotMarketQty }
          : {}),
      };
    } catch (error) {
      exchangeLogger.error({ error }, "addDirectTransaction failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Exchange failed",
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Query Operations
  // ---------------------------------------------------------------------------

  /**
   * Get exchange transaction history, enriched with per-row lot data
   * (EXCHANGE_LOT_SETTLEMENT.md Phase 4b — the PINNED CONTRACT the frontend
   * builds against: `lot_summary`/`settler_summary`, both `SourceSummary`/
   * `SettlerSummary` | null). Cross-repo assembly belongs here, not in
   * `ExchangeRepository` (rule 13) — `getColumns()` stays untouched.
   */
  getHistory(limit: number = 50): ExchangeHistoryRow[] {
    try {
      const rows = this.exchangeRepo.getHistory(limit);
      return this.attachLotSummaries(rows);
    } catch (error) {
      exchangeLogger.error({ error, limit }, "Failed to get exchange history");
      return [];
    }
  }

  /**
   * Batches the two lot-repo aggregate calls (never N+1 — one call each for
   * ALL rows, keyed by id) and composes them onto each row. `rows.length
   * === 0` short-circuits before either call — an empty history never
   * touches the lot repo at all.
   *
   * A throw from either lot-repo call degrades to `null` for BOTH summaries
   * on every row (never a throw that breaks history endpoint entirely, and
   * never a partial mix of one real summary + one stale/missing one) — the
   * lot feature must not make the pre-existing history read fragile.
   */
  private attachLotSummaries(
    rows: ExchangeTransactionEntity[],
  ): ExchangeHistoryRow[] {
    if (rows.length === 0) return [];

    let sourceSummaries: Record<number, SourceSummary> = {};
    let settlerSummaries: Record<number, SettlerSummary> = {};
    try {
      const ids = rows.map((row) => row.id);
      sourceSummaries = this.lotRepo.getSummaryForSources(
        "exchange_transactions",
        ids,
      );
      settlerSummaries = this.lotRepo.getSummaryForSettlers(
        "exchange_transactions",
        ids,
      );
    } catch (error) {
      exchangeLogger.warn(
        { error },
        "Exchange lot summary lookup failed — returning history with null lot summaries",
      );
      sourceSummaries = {};
      settlerSummaries = {};
    }

    return rows.map((row) => ({
      ...row,
      lot_summary: sourceSummaries[row.id] ?? null,
      settler_summary: settlerSummaries[row.id] ?? null,
    }));
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

  /**
   * Update non-financial metadata on an exchange transaction.
   * Records old/new values for audit trail.
   */
  updateExchangeMetadata(
    id: number,
    data: { client_name?: string; note?: string },
    editedBy: string,
  ): {
    success: boolean;
    entity?: ExchangeTransactionEntity;
    oldValues?: Record<string, unknown>;
    error?: string;
  } {
    const existing = this.exchangeRepo.findById(id);
    if (!existing) {
      return { success: false, error: "Exchange transaction not found" };
    }

    const oldValues: Record<string, unknown> = {};
    const newValues: Record<string, unknown> = {};

    if (
      data.client_name !== undefined &&
      data.client_name !== existing.client_name
    ) {
      oldValues.client_name = existing.client_name;
      newValues.client_name = data.client_name;
    }
    if (data.note !== undefined && data.note !== existing.note) {
      oldValues.note = existing.note;
      newValues.note = data.note;
    }

    if (Object.keys(newValues).length === 0) {
      return { success: true, entity: existing };
    }

    const updated = this.exchangeRepo.updateMetadata(id, data, editedBy);
    if (!updated) {
      return { success: false, error: "Failed to update" };
    }

    exchangeLogger.info(
      { id, editedBy, oldValues, newValues },
      "Exchange metadata updated",
    );

    return { success: true, entity: updated, oldValues };
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
