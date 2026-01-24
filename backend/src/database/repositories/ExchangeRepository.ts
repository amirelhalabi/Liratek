/**
 * Exchange Repository
 *
 * Handles all exchange_transactions table operations.
 * Uses BaseRepository for common functionality.
 */

import { BaseRepository } from "./BaseRepository";

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
  rate: number;
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

  // ---------------------------------------------------------------------------
  // Transaction Operations
  // ---------------------------------------------------------------------------

  /**
   * Create a new exchange transaction
   */
  createTransaction(data: CreateExchangeData): { id: number } {
    // Exchange is considered a movement inside the General cash drawer unless we add drawer selection later.
    const drawerName = "General";
    const createdBy = 1;
    const note = data.note || null;

    return this.db.transaction(() => {
      const stmt = this.db.prepare(`
        INSERT INTO exchange_transactions (
          type, from_currency, to_currency, amount_in, amount_out, rate, client_name, note
        ) VALUES ('EXCHANGE', ?, ?, ?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        data.fromCurrency,
        data.toCurrency,
        data.amountIn,
        data.amountOut,
        data.rate,
        data.clientName || null,
        data.note || null,
      );

      const id = Number(result.lastInsertRowid);

      const insertPayment = this.db.prepare(`
        INSERT INTO payments (
          source_type, source_id, method, drawer_name, currency_code, amount, note, created_by
        ) VALUES (
          'EXCHANGE', ?, 'CASH', ?, ?, ?, ?, ?
        )
      `);

      const upsertBalanceDelta = this.db.prepare(`
        INSERT INTO drawer_balances (drawer_name, currency_code, balance)
        VALUES (?, ?, ?)
        ON CONFLICT(drawer_name, currency_code) DO UPDATE SET
          balance = drawer_balances.balance + excluded.balance,
          updated_at = CURRENT_TIMESTAMP
      `);

      // Outflow in fromCurrency
      const fromDelta = -Math.abs(data.amountIn);
      insertPayment.run(id, drawerName, data.fromCurrency, fromDelta, note, createdBy);
      upsertBalanceDelta.run(drawerName, data.fromCurrency, fromDelta);

      // Inflow in toCurrency
      const toDelta = Math.abs(data.amountOut);
      insertPayment.run(id, drawerName, data.toCurrency, toDelta, note, createdBy);
      upsertBalanceDelta.run(drawerName, data.toCurrency, toDelta);

      return { id };
    })();
  }

  /**
   * Log the exchange activity
   */
  logActivity(data: CreateExchangeData): void {
    const logStmt = this.db.prepare(`
      INSERT INTO activity_logs (user_id, action, details_json, created_at)
      VALUES (1, 'Exchange Transaction', ?, CURRENT_TIMESTAMP)
    `);
    logStmt.run(
      JSON.stringify({
        drawer: "General_Drawer_B",
        from: data.fromCurrency,
        to: data.toCurrency,
        amountIn: data.amountIn,
        amountOut: data.amountOut,
        rate: data.rate,
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // Query Operations
  // ---------------------------------------------------------------------------

  /**
   * Get recent exchange history (last N transactions)
   */
  getHistory(limit: number = 50): ExchangeTransactionEntity[] {
    const stmt = this.db.prepare(`
      SELECT * FROM exchange_transactions 
      ORDER BY created_at DESC 
      LIMIT ?
    `);
    return stmt.all(limit) as ExchangeTransactionEntity[];
  }

  /**
   * Get today's exchange transactions
   */
  getTodayTransactions(): ExchangeTransactionEntity[] {
    const stmt = this.db.prepare(`
      SELECT * FROM exchange_transactions 
      WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime')
      ORDER BY created_at DESC
    `);
    return stmt.all() as ExchangeTransactionEntity[];
  }

  /**
   * Get exchange statistics for today
   */
  getTodayStats(): { totalIn: number; totalOut: number; count: number } {
    const stmt = this.db.prepare(`
      SELECT 
        COALESCE(SUM(amount_in), 0) as total_in,
        COALESCE(SUM(amount_out), 0) as total_out,
        COUNT(*) as count
      FROM exchange_transactions 
      WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime')
    `);
    const result = stmt.get() as {
      total_in: number;
      total_out: number;
      count: number;
    };
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
