/**
 * Session Payment Repository
 *
 * Owns the raw SQL for the basket-payment recorder (SessionPaymentService):
 *   - insertSessionLeg   → one `payments` row tied to a session basket
 *   - postDrawerDelta    → upsert a signed delta into `drawer_balances`
 *   - insertBasketDebt   → the single `debt_ledger` entry for the basket
 *   - getSessionSaleRows → the session's SALE rows (customer_session_transactions
 *                          → transactions → sales) for settlement back-fill
 *
 * All methods run on the caller's connection (the same `getDatabase()` the
 * service's checkout transaction uses), so they remain atomic with item creation.
 */

import { BaseRepository } from "./BaseRepository.js";
import { getCurrentTenantId } from "../db/tenantContext.js";

export interface InsertSessionLegInput {
  sessionId: number;
  method: string;
  drawerName: string;
  currencyCode: string;
  /** Signed amount: positive for IN, negative for OUT/change. */
  amount: number;
  note: string;
  userId: number;
}

export interface InsertBasketDebtInput {
  sessionId: number;
  clientId: number;
  amountUsd: number;
  amountLbp: number;
  userId: number;
}

export interface SessionSaleRow {
  sale_id: number;
  final_usd: number;
}

export class SessionPaymentRepository extends BaseRepository<{ id: number }> {
  constructor() {
    super("payments", { softDelete: false });
  }

  protected getColumns(): string {
    return "id";
  }

  /**
   * Insert one customer-facing payment leg for a session basket.
   * `transaction_id` is left NULL — a payment row belongs to EITHER a
   * transaction OR a session basket, never both.
   */
  insertSessionLeg(input: InsertSessionLegInput): void {
    this.db
      .prepare(
        `INSERT INTO payments (
          session_id, method, drawer_name, currency_code, amount, note, created_by, tenant_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.sessionId,
        input.method,
        input.drawerName,
        input.currencyCode,
        input.amount,
        input.note,
        input.userId,
        getCurrentTenantId(),
      );
  }

  /**
   * Post a signed delta to a drawer balance (IN = +, OUT/change = −),
   * creating the (drawer_name, currency_code) row if it doesn't exist.
   */
  postDrawerDelta(
    drawerName: string,
    currencyCode: string,
    signedAmount: number,
  ): void {
    this.db
      .prepare(
        `INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(tenant_id, drawer_name, currency_code) DO UPDATE SET
           balance = drawer_balances.balance + excluded.balance,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(getCurrentTenantId(), drawerName, currencyCode, signedAmount);
  }

  /**
   * Insert the single basket debt-ledger entry for the whole
   * CUSTOMER_ACCOUNT (+ GIFT_CARD) portion, due in 30 days.
   */
  insertBasketDebt(input: InsertBasketDebtInput): void {
    this.db
      .prepare(
        `INSERT INTO debt_ledger (
          client_id, transaction_type, amount_usd, amount_lbp, transaction_id, note, created_by, due_date, session_id, tenant_id
        ) VALUES (?, 'Session Debt', ?, ?, NULL, ?, ?, datetime('now', '+30 days'), ?, ?)`,
      )
      .run(
        input.clientId,
        input.amountUsd,
        input.amountLbp,
        `Session #${input.sessionId} basket`,
        input.userId,
        input.sessionId,
        getCurrentTenantId(),
      );
  }

  /**
   * Resolve a session's SALE rows (unified txn → source sale id + amount),
   * ordered by transaction id ascending (creation order).
   */
  getSessionSaleRows(sessionId: number): SessionSaleRow[] {
    const tenantId = getCurrentTenantId();
    return this.db
      .prepare(
        `SELECT t.source_id AS sale_id, s.final_amount_usd AS final_usd
         FROM customer_session_transactions cst
         JOIN transactions t ON t.id = cst.unified_transaction_id AND t.tenant_id = ?
         JOIN sales s ON s.id = t.source_id AND s.tenant_id = ?
         WHERE cst.session_id = ?
           AND t.type = 'SALE'
           AND t.source_table = 'sales'
           AND cst.tenant_id = ?
         ORDER BY t.id ASC`,
      )
      .all(tenantId, tenantId, sessionId, tenantId) as SessionSaleRow[];
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: SessionPaymentRepository | null = null;

export function getSessionPaymentRepository(): SessionPaymentRepository {
  if (!instance) {
    instance = new SessionPaymentRepository();
  }
  return instance;
}

export function resetSessionPaymentRepository(): void {
  instance = null;
}
