import type Database from "better-sqlite3";
import { getDatabase } from "../db/connection.js";

export interface CustomerSession {
  id: number;
  customer_name?: string;
  customer_phone?: string;
  customer_notes?: string;
  user_id?: number;
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
  user_id?: number;
}

export interface SessionCartItem {
  id: number;
  session_id: number;
  item_id: string; // UUID from frontend
  module: string;
  label: string;
  amount: number;
  currency: string;
  form_data: string; // JSON string
  ipc_channel: string;
  user_id?: number;
  created_at: string;
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
  private cartTableName = "session_cart_items";

  // Define explicit columns instead of SELECT *
  private readonly columns =
    "id, customer_name, customer_phone, customer_notes, user_id, started_at, closed_at, started_by, closed_by, is_active";
  private readonly transactionColumns =
    "id, session_id, transaction_type, transaction_id, amount_usd, amount_lbp, created_at";
  private readonly cartColumns =
    "id, session_id, item_id, module, label, amount, currency, form_data, ipc_channel, user_id, created_at";

  constructor(db?: Database.Database) {
    this.db = db ?? getDatabase();
  }

  /**
   * Create a new customer visit session
   */
  createSession(data: CreateCustomerSessionData): number {
    const insert = this.db.prepare(`
      INSERT INTO ${this.tableName} (customer_name, customer_phone, customer_notes, user_id, started_by, started_at, is_active)
      VALUES (?, ?, ?, ?, ?, datetime('now'), 1)
    `);

    const result = insert.run(
      data.customer_name ?? null,
      data.customer_phone ?? null,
      data.customer_notes ?? null,
      data.user_id ?? null,
      data.started_by,
    );

    return result.lastInsertRowid as number;
  }

  /**
   * Atomically check for duplicate active session and create if none exists.
   * Returns { sessionId } on success, or { error } if a duplicate is found.
   */
  createSessionIfNotActive(
    data: CreateCustomerSessionData,
  ): { sessionId: number } | { error: string } {
    return this.db.transaction(() => {
      if (data.customer_name) {
        const existing = this.getActiveSessionByCustomerName(
          data.customer_name,
        );
        if (existing) {
          return {
            error: `An active session already exists for "${data.customer_name}". Please close or switch to that session first.`,
          };
        }
      }
      const sessionId = this.createSession(data);
      return { sessionId };
    })();
  }

  /**
   * Get session by ID
   */
  getSessionById(sessionId: number): CustomerSession | null {
    const query = this.db.prepare(`
      SELECT ${this.columns} FROM ${this.tableName} WHERE id = ?
    `);
    return (query.get(sessionId) as CustomerSession | undefined) ?? null;
  }

  /**
   * Get the currently active session (if any)
   */
  getActiveSession(): CustomerSession | null {
    const query = this.db.prepare(`
      SELECT ${this.columns} FROM ${this.tableName}
      WHERE is_active = 1
      ORDER BY started_at DESC
      LIMIT 1
    `);
    return (query.get() as CustomerSession | undefined) ?? null;
  }

  /**
   * Get all active sessions (for multi-PC polling)
   */
  getActiveSessions(): CustomerSession[] {
    const query = this.db.prepare(`
      SELECT ${this.columns} FROM ${this.tableName}
      WHERE is_active = 1
      ORDER BY started_at DESC
    `);
    return query.all() as CustomerSession[];
  }

  /**
   * Check if there's an active session for a specific customer (by name)
   */
  getActiveSessionByCustomerName(customerName: string): CustomerSession | null {
    const query = this.db.prepare(`
      SELECT ${this.columns} FROM ${this.tableName}
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
   * Permanently delete a session and all related data (cart items, transactions)
   */
  deleteSession(sessionId: number): void {
    this.db.transaction(() => {
      this.db
        .prepare(`DELETE FROM ${this.cartTableName} WHERE session_id = ?`)
        .run(sessionId);
      this.db
        .prepare(
          `DELETE FROM ${this.transactionsTableName} WHERE session_id = ?`,
        )
        .run(sessionId);
      this.db
        .prepare(`DELETE FROM ${this.tableName} WHERE id = ?`)
        .run(sessionId);
    })();
  }

  /**
   * Get today's sessions (both active and closed) for the session list UI
   */
  getTodayAllSessions(): CustomerSession[] {
    const query = this.db.prepare(`
      SELECT ${this.columns} FROM ${this.tableName}
      WHERE date(started_at, 'localtime') = date('now', 'localtime')
      ORDER BY is_active DESC, started_at DESC
    `);
    return query.all() as CustomerSession[];
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
    profitUsd: number = 0,
    profitLbp: number = 0,
  ): void {
    const insert = this.db.prepare(`
      INSERT INTO ${this.transactionsTableName} (session_id, transaction_type, transaction_id, amount_usd, amount_lbp, profit_usd, profit_lbp, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);
    insert.run(
      sessionId,
      transactionType,
      transactionId,
      amountUsd,
      amountLbp,
      profitUsd,
      profitLbp,
    );
  }

  /**
   * Get all transactions for a session
   */
  getSessionTransactions(sessionId: number): SessionTransaction[] {
    const query = this.db.prepare(`
      SELECT ${this.transactionColumns} FROM ${this.transactionsTableName}
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
      SELECT ${this.columns} FROM ${this.tableName}
      ORDER BY started_at DESC
      LIMIT ? OFFSET ?
    `);
    return query.all(limit, offset) as CustomerSession[];
  }

  /**
   * Get sessions within a date range, with checkout/cart summary data
   */
  getSessionsByDateRange(
    from: string,
    to: string,
  ): Array<
    CustomerSession & {
      checkout_total_usd: number;
      checkout_total_lbp: number;
      checkout_profit_usd: number;
      checkout_profit_lbp: number;
      item_count: number;
      total_usd: number;
      total_lbp: number;
      total_profit_usd: number;
      total_profit_lbp: number;
    }
  > {
    const query = this.db.prepare(`
      SELECT cs.${this.columns},
             COALESCE(cs.checkout_total_usd, 0) as checkout_total_usd,
             COALESCE(cs.checkout_total_lbp, 0) as checkout_total_lbp,
             COALESCE(cs.checkout_profit_usd, 0) as checkout_profit_usd,
             COALESCE(cs.checkout_profit_lbp, 0) as checkout_profit_lbp,
             COALESCE(cart.item_count, 0) as item_count,
             COALESCE(t.total_usd, 0) as total_usd,
             COALESCE(t.total_lbp, 0) as total_lbp,
             COALESCE(t.total_profit_usd, 0) as total_profit_usd,
             COALESCE(t.total_profit_lbp, 0) as total_profit_lbp
      FROM ${this.tableName} cs
      LEFT JOIN (
        SELECT session_id, COUNT(*) as item_count
        FROM ${this.cartTableName}
        GROUP BY session_id
      ) cart ON cart.session_id = cs.id
      LEFT JOIN (
        SELECT session_id,
               SUM(amount_usd) as total_usd,
               SUM(amount_lbp) as total_lbp,
               SUM(profit_usd) as total_profit_usd,
               SUM(profit_lbp) as total_profit_lbp
        FROM ${this.transactionsTableName}
        GROUP BY session_id
      ) t ON t.session_id = cs.id
      WHERE date(cs.started_at, 'localtime') >= ?
        AND date(cs.started_at, 'localtime') <= ?
      ORDER BY cs.started_at DESC
    `);
    return query.all(from, to) as Array<
      CustomerSession & {
        checkout_total_usd: number;
        checkout_total_lbp: number;
        checkout_profit_usd: number;
        checkout_profit_lbp: number;
        item_count: number;
        total_usd: number;
        total_lbp: number;
        total_profit_usd: number;
        total_profit_lbp: number;
      }
    >;
  }

  /**
   * Get all sessions started today (both active and closed), with their transactions and cart totals
   */
  getTodaySessions(): Array<
    CustomerSession & {
      checkout_total_usd: number;
      checkout_total_lbp: number;
      checkout_profit_usd: number;
      checkout_profit_lbp: number;
      item_count: number;
      total_usd: number;
      total_lbp: number;
      total_profit_usd: number;
      total_profit_lbp: number;
    }
  > {
    const query = this.db.prepare(`
      SELECT cs.${this.columns},
             COALESCE(cs.checkout_total_usd, 0) as checkout_total_usd,
             COALESCE(cs.checkout_total_lbp, 0) as checkout_total_lbp,
             COALESCE(cs.checkout_profit_usd, 0) as checkout_profit_usd,
             COALESCE(cs.checkout_profit_lbp, 0) as checkout_profit_lbp,
             COALESCE(cart.item_count, 0) as item_count,
             COALESCE(t.total_usd, 0) as total_usd,
             COALESCE(t.total_lbp, 0) as total_lbp,
             COALESCE(t.total_profit_usd, 0) as total_profit_usd,
             COALESCE(t.total_profit_lbp, 0) as total_profit_lbp
      FROM ${this.tableName} cs
      LEFT JOIN (
        SELECT session_id, COUNT(*) as item_count
        FROM ${this.cartTableName}
        GROUP BY session_id
      ) cart ON cart.session_id = cs.id
      LEFT JOIN (
        SELECT session_id,
               SUM(amount_usd) as total_usd,
               SUM(amount_lbp) as total_lbp,
               SUM(profit_usd) as total_profit_usd,
               SUM(profit_lbp) as total_profit_lbp
        FROM ${this.transactionsTableName}
        GROUP BY session_id
      ) t ON t.session_id = cs.id
      WHERE date(cs.started_at, 'localtime') = date('now', 'localtime')
      ORDER BY cs.started_at DESC
    `);
    return query.all() as Array<
      CustomerSession & {
        checkout_total_usd: number;
        checkout_total_lbp: number;
        checkout_profit_usd: number;
        checkout_profit_lbp: number;
        item_count: number;
        total_usd: number;
        total_lbp: number;
        total_profit_usd: number;
        total_profit_lbp: number;
      }
    >;
  }

  /**
   * Get all sessions for a specific customer (by name or phone)
   */
  getSessionsByCustomer(
    customerName: string,
    customerPhone?: string,
  ): CustomerSession[] {
    let sql = `
      SELECT ${this.columns} FROM ${this.tableName}
      WHERE customer_name = ?
    `;
    const params: any[] = [customerName];

    if (customerPhone) {
      sql += ` OR customer_phone = ?`;
      params.push(customerPhone);
    }

    sql += ` ORDER BY started_at DESC`;

    const query = this.db.prepare(sql);
    return query.all(...params) as CustomerSession[];
  }

  /**
   * Get session with its transactions
   */
  getSessionWithTransactions(sessionId: number): {
    session: CustomerSession;
    transactions: SessionTransaction[];
    total_usd: number;
    total_lbp: number;
  } {
    const session = this.getSessionById(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const transactions = this.getSessionTransactions(sessionId);
    const total_usd = transactions.reduce(
      (sum, t) => sum + Math.abs(t.amount_usd),
      0,
    );
    const total_lbp = transactions.reduce(
      (sum, t) => sum + Math.abs(t.amount_lbp),
      0,
    );

    return { session, transactions, total_usd, total_lbp };
  }

  // ---------------------------------------------------------------------------
  // Cart methods
  // ---------------------------------------------------------------------------

  /**
   * Add an item to the session cart
   */
  addCartItem(
    sessionId: number,
    item: {
      item_id: string;
      module: string;
      label: string;
      amount: number;
      currency: string;
      form_data: string;
      ipc_channel: string;
      user_id?: number;
    },
  ): number {
    const stmt = this.db.prepare(`
      INSERT INTO ${this.cartTableName} (session_id, item_id, module, label, amount, currency, form_data, ipc_channel, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      sessionId,
      item.item_id,
      item.module,
      item.label,
      item.amount,
      item.currency,
      item.form_data,
      item.ipc_channel,
      item.user_id ?? null,
    );
    return result.lastInsertRowid as number;
  }

  /**
   * Get all cart items for a session
   */
  getCartItems(sessionId: number): SessionCartItem[] {
    const stmt = this.db.prepare(`
      SELECT ${this.cartColumns} FROM ${this.cartTableName}
      WHERE session_id = ?
      ORDER BY created_at ASC
    `);
    return stmt.all(sessionId) as SessionCartItem[];
  }

  /**
   * Remove a specific cart item by its frontend UUID
   */
  removeCartItem(sessionId: number, itemId: string): void {
    this.db
      .prepare(
        `DELETE FROM ${this.cartTableName} WHERE session_id = ? AND item_id = ?`,
      )
      .run(sessionId, itemId);
  }

  /**
   * Remove all cart items for a session
   */
  clearCart(sessionId: number): void {
    this.db
      .prepare(`DELETE FROM ${this.cartTableName} WHERE session_id = ?`)
      .run(sessionId);
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
