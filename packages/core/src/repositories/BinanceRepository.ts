/**
 * Binance Repository
 *
 * Handles all binance_transactions table operations.
 * Uses BaseRepository for common functionality.
 */

import { BaseRepository } from "./BaseRepository.js";

// =============================================================================
// Entity Types
// =============================================================================

export interface BinanceTransactionEntity {
  id: number;
  type: "SEND" | "RECEIVE";
  amount: number;
  currency_code: string;
  description: string | null;
  client_name: string | null;
  created_at: string;
  created_by: number | null;
}

export interface CreateBinanceTransactionData {
  type: "SEND" | "RECEIVE";
  amount: number;
  currencyCode?: string;
  description?: string;
  clientName?: string;
  createdBy?: number;
}

export interface BinanceTodayStats {
  totalSent: number;
  totalReceived: number;
  count: number;
}

// =============================================================================
// Binance Repository Class
// =============================================================================

export class BinanceRepository extends BaseRepository<BinanceTransactionEntity> {
  constructor() {
    super("binance_transactions", { softDelete: false });
  }

  // Override getColumns() to use explicit columns instead of SELECT *
  protected getColumns(): string {
    return "id, type, amount, currency_code, description, client_name, created_at, created_by";
  }

  // ---------------------------------------------------------------------------
  // Transaction Operations
  // ---------------------------------------------------------------------------

  /**
   * Create a new Binance transaction and update drawer balances
   */
  createTransaction(data: CreateBinanceTransactionData): { id: number } {
    const drawerName = "Binance";
    const currencyCode = data.currencyCode || "USDT";
    const createdBy = data.createdBy || 1;

    return this.db.transaction(() => {
      // Insert the transaction
      const stmt = this.db.prepare(`
        INSERT INTO binance_transactions (
          type, amount, currency_code, description, client_name, created_by
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        data.type,
        data.amount,
        currencyCode,
        data.description || null,
        data.clientName || null,
        createdBy,
      );

      const id = Number(result.lastInsertRowid);

      // Record payment and update drawer balance
      const insertPayment = this.db.prepare(`
        INSERT INTO payments (
          source_type, source_id, method, drawer_name, currency_code, amount, note, created_by
        ) VALUES (
          'BINANCE', ?, 'BINANCE', ?, ?, ?, ?, ?
        )
      `);

      const upsertBalanceDelta = this.db.prepare(`
        INSERT INTO drawer_balances (drawer_name, currency_code, balance)
        VALUES (?, ?, ?)
        ON CONFLICT(drawer_name, currency_code) DO UPDATE SET
          balance = drawer_balances.balance + excluded.balance,
          updated_at = CURRENT_TIMESTAMP
      `);

      // RECEIVE = inflow (+), SEND = outflow (-)
      const delta =
        data.type === "RECEIVE"
          ? Math.abs(data.amount)
          : -Math.abs(data.amount);

      insertPayment.run(
        id,
        drawerName,
        currencyCode,
        delta,
        data.description || null,
        createdBy,
      );
      upsertBalanceDelta.run(drawerName, currencyCode, delta);

      return { id };
    })();
  }

  /**
   * Log binance activity
   */
  logActivity(data: CreateBinanceTransactionData): void {
    const logStmt = this.db.prepare(`
      INSERT INTO activity_logs (user_id, action, details_json, created_at)
      VALUES (?, 'Binance Transaction', ?, CURRENT_TIMESTAMP)
    `);
    logStmt.run(
      data.createdBy || 1,
      JSON.stringify({
        type: data.type,
        amount: data.amount,
        currencyCode: data.currencyCode || "USDT",
        description: data.description,
        clientName: data.clientName,
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // Query Operations
  // ---------------------------------------------------------------------------

  /**
   * Get transaction history (most recent first)
   */
  getHistory(limit: number = 50): BinanceTransactionEntity[] {
    const stmt = this.db.prepare(`
      SELECT ${this.getColumns()} FROM binance_transactions 
      ORDER BY created_at DESC 
      LIMIT ?
    `);
    return stmt.all(limit) as BinanceTransactionEntity[];
  }

  /**
   * Get today's transactions
   */
  getTodayTransactions(): BinanceTransactionEntity[] {
    const stmt = this.db.prepare(`
      SELECT ${this.getColumns()} FROM binance_transactions 
      WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime')
      ORDER BY created_at DESC
    `);
    return stmt.all() as BinanceTransactionEntity[];
  }

  /**
   * Get today's stats (total sent, received, count)
   */
  getTodayStats(): BinanceTodayStats {
    const stmt = this.db.prepare(`
      SELECT 
        COALESCE(SUM(CASE WHEN type = 'SEND' THEN amount ELSE 0 END), 0) as total_sent,
        COALESCE(SUM(CASE WHEN type = 'RECEIVE' THEN amount ELSE 0 END), 0) as total_received,
        COUNT(*) as count
      FROM binance_transactions 
      WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime')
    `);
    const result = stmt.get() as {
      total_sent: number;
      total_received: number;
      count: number;
    };
    return {
      totalSent: result.total_sent,
      totalReceived: result.total_received,
      count: result.count,
    };
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let binanceRepositoryInstance: BinanceRepository | null = null;

export function getBinanceRepository(): BinanceRepository {
  if (!binanceRepositoryInstance) {
    binanceRepositoryInstance = new BinanceRepository();
  }
  return binanceRepositoryInstance;
}

/** Reset the singleton (for testing) */
export function resetBinanceRepository(): void {
  binanceRepositoryInstance = null;
}
