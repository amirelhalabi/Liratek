import type Database from "better-sqlite3";
import { getDatabase } from "../db/connection.js";

export interface CustomerSession {
  id: number;
  customer_name?: string;
  customer_phone?: string;
  customer_notes?: string;
  started_at: string; // ISO datetime
  closed_at?: string; // ISO datetime
  started_by: string; // username
  closed_by?: string;
  is_active: 1 | 0;
}

export interface CreateCustomerSessionData {
  customer_name?: string;
  customer_phone?: string;
  customer_notes?: string;
  started_by: string;
}

export interface SessionTransaction {
  id: number;
  session_id: number;
  transaction_type: string; // 'sale', 'recharge', 'expense', 'omt', 'whish', 'exchange', 'maintenance'
  transaction_id: number;
  amount_usd: number;
  amount_lbp: number;
  created_at: string;
}

let repositoryInstance: CustomerSessionRepository | null = null;

export class CustomerSessionRepository {
  private db: Database.Database;
  private tableName = "customer_sessions";
  private transactionsTableName = "customer_session_transactions";

  constructor(db?: Database.Database) {
    this.db = db ?? getDatabase();
  }

  /**
   * Create a new customer visit session
   */
  createSession(data: CreateCustomerSessionData): number {
    const insert = this.db.prepare(`
      INSERT INTO ${this.tableName} (customer_name, customer_phone, customer_notes, started_by, started_at, is_active)
      VALUES (?, ?, ?, ?, datetime('now'), 1)
    `);

    const result = insert.run(
      data.customer_name ?? null,
      data.customer_phone ?? null,
      data.customer_notes ?? null,
      data.started_by,
    );

    return result.lastInsertRowid as number;
  }

  /**
   * Get session by ID
   */
  getSessionById(sessionId: number): CustomerSession | null {
    const query = this.db.prepare(`
      SELECT * FROM ${this.tableName} WHERE id = ?
    `);
    return (query.get(sessionId) as CustomerSession | undefined) ?? null;
  }

  /**
   * Get the currently active session (if any)
   */
  getActiveSession(): CustomerSession | null {
    const query = this.db.prepare(`
      SELECT * FROM ${this.tableName}
      WHERE is_active = 1
      ORDER BY started_at DESC
      LIMIT 1
    `);
    return (query.get() as CustomerSession | undefined) ?? null;
  }

  /**
   * Check if there's an active session for a specific customer (by name)
   */
  getActiveSessionByCustomerName(customerName: string): CustomerSession | null {
    const query = this.db.prepare(`
      SELECT * FROM ${this.tableName}
      WHERE is_active = 1 
        AND customer_name = ?
      ORDER BY started_at DESC
      LIMIT 1
    `);
    return (query.get(customerName) as CustomerSession | undefined) ?? null;
  }

  /**
   * Close a session
   */
  closeSession(sessionId: number, closedBy: string): void {
    const update = this.db.prepare(`
      UPDATE ${this.tableName}
      SET is_active = 0, closed_at = datetime('now'), closed_by = ?
      WHERE id = ?
    `);
    update.run(closedBy, sessionId);
  }

  /**
   * Link a transaction to a session
   */
  linkTransaction(
    sessionId: number,
    transactionType: string,
    transactionId: number,
    amountUsd: number,
    amountLbp: number,
  ): void {
    const insert = this.db.prepare(`
      INSERT INTO ${this.transactionsTableName} (session_id, transaction_type, transaction_id, amount_usd, amount_lbp, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `);
    insert.run(sessionId, transactionType, transactionId, amountUsd, amountLbp);
  }

  /**
   * Get all transactions for a session
   */
  getSessionTransactions(sessionId: number): SessionTransaction[] {
    const query = this.db.prepare(`
      SELECT * FROM ${this.transactionsTableName}
      WHERE session_id = ?
      ORDER BY created_at ASC
    `);
    return query.all(sessionId) as SessionTransaction[];
  }

  /**
   * Update session details (customer info, notes)
   */
  updateSession(
    sessionId: number,
    data: Partial<
      Pick<
        CustomerSession,
        "customer_name" | "customer_phone" | "customer_notes"
      >
    >,
  ): void {
    const fields: string[] = [];
    const values: any[] = [];

    if (data.customer_name !== undefined) {
      fields.push("customer_name = ?");
      values.push(data.customer_name);
    }
    if (data.customer_phone !== undefined) {
      fields.push("customer_phone = ?");
      values.push(data.customer_phone);
    }
    if (data.customer_notes !== undefined) {
      fields.push("customer_notes = ?");
      values.push(data.customer_notes);
    }

    if (fields.length === 0) return;

    values.push(sessionId);
    const sql = `UPDATE ${this.tableName} SET ${fields.join(", ")} WHERE id = ?`;
    this.db.prepare(sql).run(...values);
  }

  /**
   * List recent sessions (with pagination)
   */
  listSessions(limit = 50, offset = 0): CustomerSession[] {
    const query = this.db.prepare(`
      SELECT * FROM ${this.tableName}
      ORDER BY started_at DESC
      LIMIT ? OFFSET ?
    `);
    return query.all(limit, offset) as CustomerSession[];
  }
}

export function getCustomerSessionRepository(
  db?: Database.Database,
): CustomerSessionRepository {
  if (!repositoryInstance || db) {
    repositoryInstance = new CustomerSessionRepository(db);
  }
  return repositoryInstance;
}

export function resetCustomerSessionRepository(): void {
  repositoryInstance = null;
}
