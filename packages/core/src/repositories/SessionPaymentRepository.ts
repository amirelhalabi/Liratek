/**
 * Session Payment Repository
 *
 * Owns the raw SQL for the basket-payment recorder (SessionPaymentService):
 *   - insertSessionLeg          → one `payments` row tied to a session basket
 *   - postDrawerDelta           → upsert a signed delta into `drawer_balances`
 *   - insertBasketDebt          → the single `debt_ledger` entry for the basket
 *   - getSessionSaleRows        → the session's SALE rows (customer_session_transactions
 *                                 → transactions → sales) for settlement back-fill
 *   - getSessionCashSplitContext → Primary Cash Drawer plan §3 Phase D: the
 *                                 primary-system financial-service item subtotal
 *                                 vs. the whole basket total, by currency —
 *                                 the pro-rata inputs SessionPaymentService
 *                                 needs to split a cash leg between the PCD
 *                                 and General (decision #7).
 *
 * All methods run on the caller's connection (the same `getDatabase()` the
 * service's checkout transaction uses), so they remain atomic with item creation.
 */

import { BaseRepository } from "./BaseRepository.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { applyDrawerDelta, insertPaymentRow } from "./moneyPosting.js";
import { getSettingsRepository } from "./SettingsRepository.js";
import type { BaseSystem } from "../utils/payments.js";
import { closingLogger } from "../utils/logger.js";

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

/**
 * Pro-rata inputs for the session-basket cash split (Primary Cash Drawer plan
 * §3 Phase D, decision #7). `basketTotal*` is every basket item linked to the
 * session so far (all types); `primarySystem*` is the subset of that total
 * contributed by financial-service items whose `provider` equals the shop's
 * `baseSystem` — the portion of a cash leg proportional to
 * `primarySystem / basketTotal` (per currency) belongs in the PCD, the rest
 * in General.
 */
export interface SessionCashSplitContext {
  baseSystem: BaseSystem;
  basketTotalUsd: number;
  basketTotalLbp: number;
  primarySystemUsd: number;
  primarySystemLbp: number;
}

interface SessionCashSplitRow {
  basket_usd: number;
  basket_lbp: number;
  primary_usd: number;
  primary_lbp: number;
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
    insertPaymentRow(this.db, {
      sessionId: input.sessionId,
      method: input.method,
      drawerName: input.drawerName,
      currencyCode: input.currencyCode,
      amount: input.amount,
      note: input.note,
      createdBy: input.userId,
      tenantId: getCurrentTenantId(),
    });
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
    applyDrawerDelta(this.db, {
      drawerName,
      currencyCode,
      delta: signedAmount,
      tenantId: getCurrentTenantId(),
    });
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

  /**
   * Pro-rata inputs for the session-basket cash split (Primary Cash Drawer
   * plan §3 Phase D / decision #7). Reads every basket item linked to the
   * session SO FAR (this must run after all cart items are processed —
   * SessionCheckoutService calls recordBasketPayment last, inside the same
   * db.transaction, so every item's customer_session_transactions row already
   * exists when this query runs) and sums, per currency:
   *   - basketTotal*    → every linked item's amount (all types)
   *   - primarySystem*  → the subset whose unified transaction is a
   *                       financial_services row with provider === baseSystem
   *
   * Fails soft (logs + returns an all-zero context, i.e. "no PCD split") on
   * any error — a resolution failure must never block the basket payment
   * itself; it only means the cash stays in General, which is the
   * pre-existing (safe) behavior, not a money-loss bug.
   */
  getSessionCashSplitContext(sessionId: number): SessionCashSplitContext {
    const baseSystem = this.resolveBaseSystem();
    try {
      const tenantId = getCurrentTenantId();
      const row = this.db
        .prepare(
          `SELECT
             COALESCE(SUM(cst.amount_usd), 0) AS basket_usd,
             COALESCE(SUM(cst.amount_lbp), 0) AS basket_lbp,
             COALESCE(SUM(CASE WHEN fs.provider = ? THEN cst.amount_usd ELSE 0 END), 0) AS primary_usd,
             COALESCE(SUM(CASE WHEN fs.provider = ? THEN cst.amount_lbp ELSE 0 END), 0) AS primary_lbp
           FROM customer_session_transactions cst
           LEFT JOIN transactions t
             ON t.id = cst.unified_transaction_id
            AND t.tenant_id = ?
            AND t.source_table = 'financial_services'
           LEFT JOIN financial_services fs
             ON fs.id = t.source_id
            AND fs.tenant_id = ?
           WHERE cst.session_id = ?
             AND cst.tenant_id = ?`,
        )
        .get(
          baseSystem,
          baseSystem,
          tenantId,
          tenantId,
          sessionId,
          tenantId,
        ) as SessionCashSplitRow | undefined;

      return {
        baseSystem,
        basketTotalUsd: row?.basket_usd ?? 0,
        basketTotalLbp: row?.basket_lbp ?? 0,
        primarySystemUsd: row?.primary_usd ?? 0,
        primarySystemLbp: row?.primary_lbp ?? 0,
      };
    } catch (error) {
      closingLogger.error(
        { error, sessionId },
        "getSessionCashSplitContext failed — defaulting to no PCD split (cash stays in General)",
      );
      return {
        baseSystem,
        basketTotalUsd: 0,
        basketTotalLbp: 0,
        primarySystemUsd: 0,
        primarySystemLbp: 0,
      };
    }
  }

  /** Read `shop_base_system` (defaults to "OMT", matching
   *  FinancialServiceRepository's default) via the shared SettingsRepository —
   *  never re-declare this predicate (CLAUDE.md rule 14). */
  private resolveBaseSystem(): BaseSystem {
    try {
      const value = getSettingsRepository().getSettingValue("shop_base_system");
      return value === "WHISH" ? "WHISH" : "OMT";
    } catch {
      return "OMT";
    }
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
