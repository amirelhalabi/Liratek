/**
 * Transaction Repository
 *
 * Provides the unified accounting journal for all financial operations.
 * Every module creates a `transactions` row as the canonical record of
 * "something happened." Downstream tables (payments, debt_ledger, etc.)
 * link back via `transaction_id` / `unified_transaction_id`.
 *
 * Key concepts:
 * - **Void**: Sets original status to VOIDED, creates reversal row with
 *   negated amounts and `reverses_id` pointing to the original.
 *   Reverses drawer balances, restores stock, and cancels debt.
 * - **Refund**: Creates a REFUND row with `reverses_id` pointing to the
 *   original. Original stays ACTIVE.
 *   Reverses drawer balances, restores stock, and cancels debt.
 * - **Exchange rate**: Immutable snapshot captured at creation time.
 */

import type {
  TransactionStatus,
  TransactionType,
} from "../constants/transactionTypes.js";
import { BaseRepository, type BaseEntity } from "./BaseRepository.js";
import { DatabaseError, NotFoundError } from "../utils/errors.js";

// =============================================================================
// Types
// =============================================================================

export interface TransactionEntity extends BaseEntity {
  type: TransactionType;
  status: TransactionStatus;
  source_table: string;
  source_id: number;
  user_id: number;
  amount_usd: number;
  amount_lbp: number;
  exchange_rate: number | null;
  client_id: number | null;
  reverses_id: number | null;
  summary: string | null;
  metadata_json: string | null;
  device_id: string | null;
  created_at: string;
}

export interface PaymentRow {
  id: number;
  method: string;
  drawer_name: string;
  currency_code: string;
  amount: number;
  note: string | null;
  created_at: string;
}

export interface CreateTransactionInput {
  type: TransactionType;
  source_table: string;
  source_id: number;
  user_id: number;
  amount_usd?: number;
  amount_lbp?: number;
  exchange_rate?: number | null;
  client_id?: number | null;
  summary?: string;
  metadata_json?: Record<string, unknown>;
  device_id?: string;
}

export interface TransactionFilters {
  type?: TransactionType;
  status?: TransactionStatus;
  user_id?: number;
  client_id?: number;
  source_table?: string;
  from?: string;
  to?: string;
}

export interface DailySummary {
  date: string;
  total_usd: number;
  total_lbp: number;
  by_type: Array<{
    type: string;
    count: number;
    total_usd: number;
    total_lbp: number;
  }>;
  void_count: number;
  void_usd: number;
  void_lbp: number;
}

export interface TransactionWithUser extends TransactionEntity {
  username: string;
  client_name: string | null;
}

export interface DebtAgingBuckets {
  client_id: number;
  current: { usd: number; lbp: number };
  days_31_60: { usd: number; lbp: number };
  days_61_90: { usd: number; lbp: number };
  over_90: { usd: number; lbp: number };
}

export interface OverdueDebtEntry {
  client_id: number;
  client_name: string;
  phone_number: string | null;
  total_usd: number;
  total_lbp: number;
  oldest_due_date: string;
  max_days_overdue: number;
  entry_count: number;
}

// =============================================================================
// Repository
// =============================================================================

export class TransactionRepository extends BaseRepository<TransactionEntity> {
  constructor() {
    super("transactions");
  }

  protected getColumns(): string {
    return [
      "id",
      "type",
      "status",
      "source_table",
      "source_id",
      "user_id",
      "amount_usd",
      "amount_lbp",
      "exchange_rate",
      "client_id",
      "reverses_id",
      "summary",
      "metadata_json",
      "device_id",
      "created_at",
    ].join(", ");
  }

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------

  /**
   * Create a new transaction record. Returns the new transaction ID.
   */
  createTransaction(data: CreateTransactionInput): number {
    const metadataStr = data.metadata_json
      ? JSON.stringify(data.metadata_json)
      : null;

    const result = this.execute(
      `INSERT INTO transactions
        (type, source_table, source_id, user_id, amount_usd, amount_lbp,
         exchange_rate, client_id, summary, metadata_json, device_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      data.type,
      data.source_table,
      data.source_id,
      data.user_id,
      data.amount_usd ?? 0,
      data.amount_lbp ?? 0,
      data.exchange_rate ?? null,
      data.client_id ?? null,
      data.summary ?? null,
      metadataStr,
      data.device_id ?? null,
    );

    return result.lastInsertRowid as number;
  }

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  /**
   * Get recent transactions with optional filters.
   */
  getRecent(limit = 50, filters?: TransactionFilters): TransactionWithUser[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters?.type) {
      conditions.push("t.type = ?");
      params.push(filters.type);
    }
    if (filters?.status) {
      conditions.push("t.status = ?");
      params.push(filters.status);
    }
    if (filters?.user_id) {
      conditions.push("t.user_id = ?");
      params.push(filters.user_id);
    }
    if (filters?.client_id) {
      conditions.push("t.client_id = ?");
      params.push(filters.client_id);
    }
    if (filters?.source_table) {
      conditions.push("t.source_table = ?");
      params.push(filters.source_table);
    }
    if (filters?.from) {
      conditions.push("t.created_at >= ?");
      params.push(filters.from);
    }
    if (filters?.to) {
      conditions.push("t.created_at <= ?");
      params.push(filters.to);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    params.push(limit);

    return this.query<TransactionWithUser>(
      `SELECT t.id, t.type, t.status, t.source_table, t.source_id,
              t.user_id, t.amount_usd, t.amount_lbp, t.exchange_rate,
              t.client_id, t.reverses_id, t.summary, t.metadata_json,
              t.device_id, t.created_at,
              u.username,
              c.full_name AS client_name
       FROM transactions t
       LEFT JOIN users u ON u.id = t.user_id
       LEFT JOIN clients c ON c.id = t.client_id
       ${where}
       ORDER BY t.created_at DESC
       LIMIT ?`,
      ...params,
    );
  }

  /**
   * Find the transaction row that corresponds to a specific source record.
   */
  getBySourceId(
    sourceTable: string,
    sourceId: number,
  ): TransactionEntity | null {
    return this.queryOne<TransactionEntity>(
      `SELECT ${this.getColumns()} FROM transactions
       WHERE source_table = ? AND source_id = ? AND status = 'ACTIVE'
       ORDER BY id DESC LIMIT 1`,
      sourceTable,
      sourceId,
    );
  }

  /**
   * Get all transactions for a given client.
   */
  getByClientId(clientId: number, limit = 100): TransactionEntity[] {
    return this.query<TransactionEntity>(
      `SELECT ${this.getColumns()} FROM transactions
       WHERE client_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      clientId,
      limit,
    );
  }

  /**
   * Get transactions in a date range with optional type filter.
   */
  getByDateRange(
    from: string,
    to: string,
    type?: TransactionType,
  ): TransactionEntity[] {
    if (type) {
      return this.query<TransactionEntity>(
        `SELECT ${this.getColumns()} FROM transactions
         WHERE created_at >= ? AND created_at <= ? AND type = ?
         ORDER BY created_at DESC`,
        from,
        to,
        type,
      );
    }
    return this.query<TransactionEntity>(
      `SELECT ${this.getColumns()} FROM transactions
       WHERE created_at >= ? AND created_at <= ?
       ORDER BY created_at DESC`,
      from,
      to,
    );
  }

  // ---------------------------------------------------------------------------
  // Accounting Journal Operations
  // ---------------------------------------------------------------------------

  /**
   * Void a transaction using the accounting journal pattern:
   * 1. Set original status to VOIDED
   * 2. Create a reversal row with negated amounts and reverses_id = original.id
   * 3. Reverse drawer balances via negated payment rows
   * 4. If SALE: mark sale as 'cancelled', restore stock, cancel debt
   *
   * Returns the reversal transaction's ID.
   */
  voidTransaction(id: number, userId: number): number {
    const original = this.findById(id);
    if (!original) {
      throw new NotFoundError("transactions", id);
    }
    if (original.status === "VOIDED") {
      throw new DatabaseError("Transaction is already voided", {
        entityId: id,
      });
    }

    return this.transaction(() => {
      // 1. Mark original as VOIDED
      this.execute(
        `UPDATE transactions SET status = 'VOIDED' WHERE id = ?`,
        id,
      );

      // 2. Create reversal row
      const result = this.execute(
        `INSERT INTO transactions
          (type, status, source_table, source_id, user_id,
           amount_usd, amount_lbp, exchange_rate,
           client_id, reverses_id, summary, metadata_json, device_id)
         VALUES (?, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        original.type,
        original.source_table,
        original.source_id,
        userId,
        -original.amount_usd,
        -original.amount_lbp,
        original.exchange_rate,
        original.client_id,
        id,
        `VOID: ${original.summary ?? original.type}`,
        original.metadata_json,
        original.device_id,
      );

      const reversalId = result.lastInsertRowid as number;

      // 3. Reverse drawer balances — negate every payment from the original
      this._reversePayments(id, reversalId, userId);

      // 4. If SALE: cancel sale, restore stock, cancel debt
      if (original.source_table === "sales" && original.source_id) {
        this.execute(
          `UPDATE sales SET status = 'cancelled' WHERE id = ?`,
          original.source_id,
        );
        this._restoreStock(original.source_id);
        this._cancelDebt(id, userId);
      }

      return reversalId;
    });
  }

  /**
   * Create a refund transaction:
   * 1. Guard against double-refund.
   * 2. Create a REFUND row with reverses_id = original.id and negated amounts.
   * 3. Reverse drawer balances via negated payment rows.
   * 4. If the original is a SALE, mark sale status = 'refunded',
   *    set sale_items.is_refunded = 1, restore stock, and cancel debt.
   *
   * Returns the refund transaction's ID.
   */
  refundTransaction(id: number, userId: number): number {
    const original = this.findById(id);
    if (!original) {
      throw new NotFoundError("transactions", id);
    }
    if (original.status === "VOIDED") {
      throw new DatabaseError("Cannot refund a voided transaction", {
        entityId: id,
      });
    }

    // Guard: prevent double-refund
    const existing = this.queryOne<{ id: number }>(
      `SELECT id FROM transactions WHERE reverses_id = ? AND type = 'REFUND'`,
      id,
    );
    if (existing) {
      throw new DatabaseError("Transaction has already been refunded", {
        entityId: id,
      });
    }

    return this.transaction(() => {
      // 1. Create refund transaction row
      const result = this.execute(
        `INSERT INTO transactions
          (type, status, source_table, source_id, user_id,
           amount_usd, amount_lbp, exchange_rate,
           client_id, reverses_id, summary, metadata_json, device_id)
         VALUES ('REFUND', 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        original.source_table,
        original.source_id,
        userId,
        -original.amount_usd,
        -original.amount_lbp,
        original.exchange_rate,
        original.client_id,
        id,
        `REFUND: ${original.summary ?? original.type}`,
        original.metadata_json,
        original.device_id,
      );

      const refundId = result.lastInsertRowid as number;

      // 2. Reverse drawer balances — negate every payment from the original
      this._reversePayments(id, refundId, userId);

      // 3. If SALE: mark sale & items as refunded, restore stock, cancel debt
      if (original.source_table === "sales" && original.source_id) {
        this.execute(
          `UPDATE sales SET status = 'refunded' WHERE id = ?`,
          original.source_id,
        );
        this.execute(
          `UPDATE sale_items SET is_refunded = 1 WHERE sale_id = ?`,
          original.source_id,
        );
        this._restoreStock(original.source_id);
        this._cancelDebt(id, userId);
      }

      return refundId;
    });
  }

  // ---------------------------------------------------------------------------
  // Private helpers for void / refund
  // ---------------------------------------------------------------------------

  /**
   * For each payment row linked to the original transaction, insert a negated
   * payment row linked to the reversal transaction and update drawer_balances.
   */
  /**
   * Get all payment rows linked to a transaction.
   * Used by the debt detail eye button to show a full payment breakdown
   * (Cash $50, WHISH $49.50 + PM fee $0.50, Debt $1.50, etc.)
   */
  getPaymentsByTransactionId(transactionId: number): PaymentRow[] {
    return this.query<PaymentRow>(
      `SELECT id, method, drawer_name, currency_code, amount, note, created_at
       FROM payments
       WHERE transaction_id = ?
       ORDER BY id ASC`,
      transactionId,
    );
  }

  private _reversePayments(
    originalTxnId: number,
    reversalTxnId: number,
    userId: number,
  ): void {
    const payments = this.query<{
      method: string;
      drawer_name: string;
      currency_code: string;
      amount: number;
    }>(
      `SELECT method, drawer_name, currency_code, amount
       FROM payments WHERE transaction_id = ?`,
      originalTxnId,
    );

    const insertPayment = this.db.prepare(`
      INSERT INTO payments (
        transaction_id, method, drawer_name, currency_code, amount, note, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const upsertBalance = this.db.prepare(`
      INSERT INTO drawer_balances (drawer_name, currency_code, balance)
      VALUES (?, ?, ?)
      ON CONFLICT(drawer_name, currency_code) DO UPDATE SET
        balance = drawer_balances.balance + excluded.balance,
        updated_at = CURRENT_TIMESTAMP
    `);

    for (const p of payments) {
      const negatedAmount = -p.amount;
      insertPayment.run(
        reversalTxnId,
        p.method,
        p.drawer_name,
        p.currency_code,
        negatedAmount,
        "Reversal",
        userId,
      );
      upsertBalance.run(p.drawer_name, p.currency_code, negatedAmount);
    }
  }

  /**
   * Restore stock for all items in a sale.
   */
  private _restoreStock(saleId: number): void {
    const items = this.query<{ product_id: number; quantity: number }>(
      `SELECT product_id, quantity FROM sale_items WHERE sale_id = ?`,
      saleId,
    );

    const restoreStmt = this.db.prepare(
      `UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?`,
    );

    for (const item of items) {
      restoreStmt.run(item.quantity, item.product_id);
    }
  }

  /**
   * Cancel any debt_ledger entries linked to a transaction.
   * Inserts a reversing "Refund Reversal" entry to zero out the debt.
   */
  private _cancelDebt(originalTxnId: number, userId: number): void {
    const debts = this.query<{
      id: number;
      client_id: number;
      amount_usd: number;
    }>(
      `SELECT id, client_id, amount_usd FROM debt_ledger
       WHERE transaction_id = ? AND transaction_type = 'Sale Debt'`,
      originalTxnId,
    );

    const insertReversal = this.db.prepare(`
      INSERT INTO debt_ledger (
        client_id, transaction_type, amount_usd, transaction_id, note, created_by
      ) VALUES (?, 'Refund Reversal', ?, ?, 'Debt cancelled by refund/void', ?)
    `);

    for (const d of debts) {
      insertReversal.run(d.client_id, -d.amount_usd, originalTxnId, userId);
    }
  }

  // ---------------------------------------------------------------------------
  // Analytics
  // ---------------------------------------------------------------------------

  /**
   * Get a summary of all transactions for a given date.
   */
  getDailySummary(date: string): DailySummary {
    const byType = this.query<{
      type: string;
      count: number;
      total_usd: number;
      total_lbp: number;
    }>(
      `SELECT type,
              COUNT(*) AS count,
              SUM(amount_usd) AS total_usd,
              SUM(amount_lbp) AS total_lbp
       FROM transactions
       WHERE DATE(created_at) = ? AND status = 'ACTIVE'
       GROUP BY type`,
      date,
    );

    const voids = this.queryOne<{
      void_count: number;
      void_usd: number;
      void_lbp: number;
    }>(
      `SELECT COUNT(*) AS void_count,
              COALESCE(SUM(amount_usd), 0) AS void_usd,
              COALESCE(SUM(amount_lbp), 0) AS void_lbp
       FROM transactions
       WHERE DATE(created_at) = ? AND status = 'VOIDED'`,
      date,
    );

    return {
      date,
      total_usd: byType.reduce((sum, r) => sum + r.total_usd, 0),
      total_lbp: byType.reduce((sum, r) => sum + r.total_lbp, 0),
      by_type: byType,
      void_count: voids?.void_count ?? 0,
      void_usd: voids?.void_usd ?? 0,
      void_lbp: voids?.void_lbp ?? 0,
    };
  }

  // ---------------------------------------------------------------------------
  // Debt Aging
  // ---------------------------------------------------------------------------

  /**
   * Get debt aging buckets for a specific client.
   * Buckets: current (0-30 days), 31-60, 61-90, over 90.
   */
  getClientDebtAging(clientId: number): DebtAgingBuckets {
    const row = this.queryOne<{
      current_usd: number;
      current_lbp: number;
      days_31_60_usd: number;
      days_31_60_lbp: number;
      days_61_90_usd: number;
      days_61_90_lbp: number;
      over_90_usd: number;
      over_90_lbp: number;
    }>(
      `SELECT
        COALESCE(SUM(CASE WHEN julianday('now') - julianday(due_date) <= 0 THEN amount_usd ELSE 0 END), 0) AS current_usd,
        COALESCE(SUM(CASE WHEN julianday('now') - julianday(due_date) <= 0 THEN amount_lbp ELSE 0 END), 0) AS current_lbp,
        COALESCE(SUM(CASE WHEN julianday('now') - julianday(due_date) BETWEEN 1 AND 30 THEN amount_usd ELSE 0 END), 0) AS days_31_60_usd,
        COALESCE(SUM(CASE WHEN julianday('now') - julianday(due_date) BETWEEN 1 AND 30 THEN amount_lbp ELSE 0 END), 0) AS days_31_60_lbp,
        COALESCE(SUM(CASE WHEN julianday('now') - julianday(due_date) BETWEEN 31 AND 60 THEN amount_usd ELSE 0 END), 0) AS days_61_90_usd,
        COALESCE(SUM(CASE WHEN julianday('now') - julianday(due_date) BETWEEN 31 AND 60 THEN amount_lbp ELSE 0 END), 0) AS days_61_90_lbp,
        COALESCE(SUM(CASE WHEN julianday('now') - julianday(due_date) > 60 THEN amount_usd ELSE 0 END), 0) AS over_90_usd,
        COALESCE(SUM(CASE WHEN julianday('now') - julianday(due_date) > 60 THEN amount_lbp ELSE 0 END), 0) AS over_90_lbp
      FROM debt_ledger
      WHERE client_id = ?
        AND due_date IS NOT NULL
        AND (amount_usd > 0 OR amount_lbp > 0)`,
      clientId,
    );

    return {
      client_id: clientId,
      current: { usd: row?.current_usd ?? 0, lbp: row?.current_lbp ?? 0 },
      days_31_60: {
        usd: row?.days_31_60_usd ?? 0,
        lbp: row?.days_31_60_lbp ?? 0,
      },
      days_61_90: {
        usd: row?.days_61_90_usd ?? 0,
        lbp: row?.days_61_90_lbp ?? 0,
      },
      over_90: { usd: row?.over_90_usd ?? 0, lbp: row?.over_90_lbp ?? 0 },
    };
  }

  /**
   * Get all clients with overdue debts (due_date < today AND net balance > 0).
   */
  getOverdueDebts(): OverdueDebtEntry[] {
    return this.query<OverdueDebtEntry>(
      `SELECT
        c.id AS client_id,
        c.full_name AS client_name,
        c.phone_number,
        SUM(d.amount_usd) AS total_usd,
        SUM(d.amount_lbp) AS total_lbp,
        MIN(d.due_date) AS oldest_due_date,
        CAST(MAX(julianday('now') - julianday(d.due_date)) AS INTEGER) AS max_days_overdue,
        COUNT(*) AS entry_count
      FROM debt_ledger d
      JOIN clients c ON c.id = d.client_id
      WHERE d.due_date < datetime('now')
        AND d.due_date IS NOT NULL
      GROUP BY d.client_id
      HAVING SUM(d.amount_usd) > 0 OR SUM(d.amount_lbp) > 0
      ORDER BY max_days_overdue DESC`,
    );
  }

  /**
   * Get revenue breakdown by module/type for a date range.
   */
  getRevenueByType(
    from: string,
    to: string,
  ): Array<{
    type: string;
    count: number;
    total_usd: number;
    total_lbp: number;
  }> {
    return this.query(
      `SELECT type,
              COUNT(*) AS count,
              SUM(amount_usd) AS total_usd,
              SUM(amount_lbp) AS total_lbp
       FROM transactions
       WHERE status = 'ACTIVE'
         AND created_at >= ? AND created_at <= ?
       GROUP BY type
       ORDER BY total_usd DESC`,
      from,
      to,
    );
  }

  /**
   * Get revenue breakdown by user for a date range.
   */
  getRevenueByUser(
    from: string,
    to: string,
  ): Array<{
    user_id: number;
    username: string;
    count: number;
    total_usd: number;
    total_lbp: number;
  }> {
    return this.query(
      `SELECT t.user_id,
              u.username,
              COUNT(*) AS count,
              SUM(t.amount_usd) AS total_usd,
              SUM(t.amount_lbp) AS total_lbp
       FROM transactions t
       LEFT JOIN users u ON u.id = t.user_id
       WHERE t.status = 'ACTIVE'
         AND t.created_at >= ? AND t.created_at <= ?
       GROUP BY t.user_id
       ORDER BY total_usd DESC`,
      from,
      to,
    );
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let transactionRepositoryInstance: TransactionRepository | null = null;

export function getTransactionRepository(): TransactionRepository {
  if (!transactionRepositoryInstance) {
    transactionRepositoryInstance = new TransactionRepository();
  }
  return transactionRepositoryInstance;
}

/** Reset the singleton (for testing) */
export function resetTransactionRepository(): void {
  transactionRepositoryInstance = null;
}
