/**
 * Exchange Repository
 *
 * Handles all exchange_transactions table operations.
 * Supports per-leg rate and profit tracking (v30+).
 */

import { BaseRepository } from "./BaseRepository.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";

// =============================================================================
// Entity Types
// =============================================================================

export interface ExchangeTransactionEntity {
  id: number;
  type: string;
  from_currency: string;
  to_currency: string;
  amount_in: number;
  amount_out: number;
  rate: number;
  base_rate: number | null;
  profit_usd: number | null;
  // Leg tracking (v30+)
  leg1_rate: number | null;
  leg1_market_rate: number | null;
  leg1_profit_usd: number | null;
  leg2_rate: number | null;
  leg2_market_rate: number | null;
  leg2_profit_usd: number | null;
  via_currency: string | null;
  client_name: string | null;
  note: string | null;
  created_at: string;
  created_by: number | null;
}

export interface CreateExchangeData {
  fromCurrency: string;
  toCurrency: string;
  amountIn: number;
  amountOut: number;
  // Leg 1 (always present)
  leg1Rate: number;
  leg1MarketRate: number;
  leg1ProfitUsd: number;
  // Leg 2 (cross-currency only)
  leg2Rate?: number;
  leg2MarketRate?: number;
  leg2ProfitUsd?: number;
  viaCurrency?: string; // 'USD' for cross-currency, undefined for direct
  // Totals
  totalProfitUsd: number;
  clientName?: string;
  note?: string;
}

// =============================================================================
// Exchange Repository Class
// =============================================================================

export class ExchangeRepository extends BaseRepository<ExchangeTransactionEntity> {
  constructor() {
    super("exchange_transactions", { softDelete: false });
  }

  protected getColumns(): string {
    return [
      "id",
      "type",
      "from_currency",
      "to_currency",
      "amount_in",
      "amount_out",
      "rate",
      "base_rate",
      "profit_usd",
      "leg1_rate",
      "leg1_market_rate",
      "leg1_profit_usd",
      "leg2_rate",
      "leg2_market_rate",
      "leg2_profit_usd",
      "via_currency",
      "client_name",
      "note",
      "created_at",
      "created_by",
    ].join(", ");
  }

  // ---------------------------------------------------------------------------
  // Transaction Operations
  // ---------------------------------------------------------------------------

  /**
   * Create a new exchange transaction with full leg tracking.
   */
  createTransaction(data: CreateExchangeData): { id: number } {
    const drawerName = "General";
    const createdBy = 1;
    const note = data.note ?? null;

    // Derive type for display: SELL if customer receives USD, BUY otherwise
    const BASE_CURRENCY = "USD";
    const type = data.toCurrency === BASE_CURRENCY ? "SELL" : "BUY";

    // For backward compat: store leg1 rate as the top-level rate field
    const rate = data.leg1Rate;
    const baseRate = data.leg1MarketRate;
    const profitUsd = data.totalProfitUsd;

    return this.db.transaction(() => {
      const result = this.db
        .prepare(
          `INSERT INTO exchange_transactions (
            type, from_currency, to_currency,
            amount_in, amount_out, rate, base_rate, profit_usd,
            leg1_rate, leg1_market_rate, leg1_profit_usd,
            leg2_rate, leg2_market_rate, leg2_profit_usd,
            via_currency, client_name, note
          ) VALUES (
            ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?
          )`,
        )
        .run(
          type,
          data.fromCurrency,
          data.toCurrency,
          data.amountIn,
          data.amountOut,
          rate,
          baseRate,
          profitUsd,
          data.leg1Rate,
          data.leg1MarketRate,
          data.leg1ProfitUsd,
          data.leg2Rate ?? null,
          data.leg2MarketRate ?? null,
          data.leg2ProfitUsd ?? null,
          data.viaCurrency ?? null,
          data.clientName ?? null,
          note,
        );

      const id = Number(result.lastInsertRowid);

      // Compute amount_usd and amount_lbp for the unified transactions ledger.
      // amount_usd: represents USD flow (negative = outflow, positive = inflow)
      // amount_lbp: represents LBP flow
      // For non-USD/non-LBP currencies (e.g. EUR), we only track the USD leg value.
      let amount_usd = 0;
      let amount_lbp = 0;

      if (data.fromCurrency === BASE_CURRENCY) {
        // USD → X: we give out USD
        amount_usd = -data.amountIn;
      } else if (data.toCurrency === BASE_CURRENCY) {
        // X → USD: we receive USD
        amount_usd = data.amountOut;
      } else if (data.fromCurrency === "LBP") {
        // LBP → X (cross-currency): outflow LBP, track USD received internally (leg1 amountOut)
        amount_lbp = -data.amountIn;
        amount_usd = data.leg1ProfitUsd; // net profit in USD (informational)
      } else if (data.toCurrency === "LBP") {
        // X → LBP (cross-currency): inflow LBP, track USD spent internally
        amount_lbp = data.amountOut;
        amount_usd = -(data.leg1ProfitUsd ?? 0); // informational
      }
      // EUR → USD or USD → EUR already handled by the USD cases above.
      // EUR → LBP or LBP → EUR handled by LBP cases above.

      const txnId = getTransactionRepository().createTransaction({
        type: TRANSACTION_TYPES.EXCHANGE,
        source_table: "exchange_transactions",
        source_id: id,
        user_id: createdBy,
        amount_usd,
        amount_lbp,
        exchange_rate: rate,
        summary: `Exchange: ${data.amountIn} ${data.fromCurrency} → ${data.amountOut} ${data.toCurrency}${data.viaCurrency ? ` (via ${data.viaCurrency})` : ""}`,
        metadata_json: {
          type,
          from_currency: data.fromCurrency,
          to_currency: data.toCurrency,
          amount_in: data.amountIn,
          amount_out: data.amountOut,
          leg1_rate: data.leg1Rate,
          leg2_rate: data.leg2Rate ?? null,
          via_currency: data.viaCurrency ?? null,
          total_profit_usd: data.totalProfitUsd,
        },
      });

      const insertPayment = this.db.prepare(
        `INSERT INTO payments (transaction_id, method, drawer_name, currency_code, amount, note, created_by)
         VALUES (?, 'CASH', ?, ?, ?, ?, ?)`,
      );

      const upsertBalance = this.db.prepare(
        `INSERT INTO drawer_balances (drawer_name, currency_code, balance)
         VALUES (?, ?, ?)
         ON CONFLICT(drawer_name, currency_code) DO UPDATE SET
           balance    = drawer_balances.balance + excluded.balance,
           updated_at = CURRENT_TIMESTAMP`,
      );

      // Outflow: customer gives fromCurrency
      const fromDelta = -Math.abs(data.amountIn);
      insertPayment.run(
        txnId,
        drawerName,
        data.fromCurrency,
        fromDelta,
        note,
        createdBy,
      );
      upsertBalance.run(drawerName, data.fromCurrency, fromDelta);

      // Inflow: customer receives toCurrency
      const toDelta = Math.abs(data.amountOut);
      insertPayment.run(
        txnId,
        drawerName,
        data.toCurrency,
        toDelta,
        note,
        createdBy,
      );
      upsertBalance.run(drawerName, data.toCurrency, toDelta);

      return { id };
    })();
  }

  // ---------------------------------------------------------------------------
  // Query Operations
  // ---------------------------------------------------------------------------

  /**
   * Get recent exchange history (last N transactions)
   */
  getHistory(limit: number = 50): ExchangeTransactionEntity[] {
    return this.db
      .prepare(
        `SELECT ${this.getColumns()} FROM exchange_transactions
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(limit) as ExchangeTransactionEntity[];
  }

  /**
   * Get today's exchange transactions
   */
  getTodayTransactions(): ExchangeTransactionEntity[] {
    return this.db
      .prepare(
        `SELECT ${this.getColumns()} FROM exchange_transactions
         WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime')
         ORDER BY created_at DESC`,
      )
      .all() as ExchangeTransactionEntity[];
  }

  /**
   * Get exchange statistics for today
   */
  getTodayStats(): { totalIn: number; totalOut: number; count: number } {
    const result = this.db
      .prepare(
        `SELECT
           COALESCE(SUM(amount_in), 0)  AS total_in,
           COALESCE(SUM(amount_out), 0) AS total_out,
           COUNT(*)                      AS count
         FROM exchange_transactions
         WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime')`,
      )
      .get() as { total_in: number; total_out: number; count: number };
    return {
      totalIn: result.total_in,
      totalOut: result.total_out,
      count: result.count,
    };
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let exchangeRepositoryInstance: ExchangeRepository | null = null;

export function getExchangeRepository(): ExchangeRepository {
  if (!exchangeRepositoryInstance) {
    exchangeRepositoryInstance = new ExchangeRepository();
  }
  return exchangeRepositoryInstance;
}

/** Reset the singleton (for testing) */
export function resetExchangeRepository(): void {
  exchangeRepositoryInstance = null;
}
