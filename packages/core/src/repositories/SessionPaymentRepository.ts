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
 *                                 vs. the whole basket total, by currency AND
 *                                 by DIRECTION (charge vs payout — bug 7 fix,
 *                                 BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4 Phase
 *                                 F) — the pro-rata inputs SessionPaymentService
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
 * §3 Phase D, decision #7; bug 7 fix — BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4
 * Phase F).
 *
 * Two independent buckets, gross per DIRECTION (never a signed net — a
 * basket item's `customer_session_transactions.amount_usd`/`amount_lbp` is
 * SIGNED: positive for a charge item, NEGATIVE for a payout item such as a
 * session RECEIVE/Loto-prize cashout. Summing the signed total let a payout
 * item shrink or invert the ratio that drives the split — bug 7):
 *  - `chargeTotal*` / `primarySystemCharge*` — every charge-side (positive)
 *    item, plus any fee-on-top RECEIVE item's fee (see
 *    `getSessionCashSplitContext`'s `feeOnTopReceiveFsIds` param); the CHARGE
 *    ratio (`primarySystemCharge* / chargeTotal*`) drives an IN cash leg's
 *    (and a kind-less/CHANGE OUT leg's) PCD/General split.
 *  - `payoutTotal*` / `primarySystemPayout*` — every payout-side (negative)
 *    item's magnitude; the PAYOUT ratio (`primarySystemPayout* / payoutTotal*`)
 *    drives a `kind: "PAYOUT"` OUT leg's PCD/General split — the mirror of
 *    the charge-side ratio, so a primary-system RECEIVE's cash payout debits
 *    the PCD in proportion to ITS share of the basket's payout total.
 */
export interface SessionCashSplitContext {
  baseSystem: BaseSystem;
  chargeTotalUsd: number;
  chargeTotalLbp: number;
  primarySystemChargeUsd: number;
  primarySystemChargeLbp: number;
  payoutTotalUsd: number;
  payoutTotalLbp: number;
  primarySystemPayoutUsd: number;
  primarySystemPayoutLbp: number;
}

interface SessionCashSplitRow {
  charge_usd: number;
  charge_lbp: number;
  payout_usd: number;
  payout_lbp: number;
  primary_charge_usd: number;
  primary_charge_lbp: number;
  primary_payout_usd: number;
  primary_payout_lbp: number;
}

/** One `financial_services` row's persisted fee, resolved for the fee-on-top
 *  RECEIVE charge-bucket attribution (bug 7's third component). */
interface SessionFeeRow {
  provider: string;
  currency: string;
  fee: number;
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
   * plan §3 Phase D / decision #7; bug 7 fix — BIDIRECTIONAL_PAYMENT_LEGS_
   * PLAN.md §4 Phase F). Reads every basket item linked to the session SO
   * FAR (this must run after all cart items are processed —
   * SessionCheckoutService calls recordBasketPayment last, inside the same
   * db.transaction, so every item's customer_session_transactions row already
   * exists when this query runs) and sums, per currency, per DIRECTION:
   *   - chargeTotal* / primarySystemCharge*  → every item whose linked amount
   *     is POSITIVE (a charge), and the primary-system (shop_base_system)
   *     subset of it — see `SessionCashSplitContext`'s doc.
   *   - payoutTotal* / primarySystemPayout*  → every item whose linked amount
   *     is NEGATIVE (a payout — session RECEIVE/Loto-prize cashout), summed
   *     as a positive magnitude, and the primary-system subset of it.
   *
   * Bug 7 (this was the defect): summing the SIGNED total (one number mixing
   * both directions) let a negative payout item shrink or invert the ratio
   * that drives the whole basket's cash split. Gross per-direction sums fix
   * that; `SessionPaymentService.ratioForCurrency` picks the matching bucket
   * per leg (IN/kind-less-OUT → charge, kind-PAYOUT-OUT → payout).
   *
   * `feeOnTopReceiveFsIds` (bug 7's third component): the ids of every
   * fee-on-top RECEIVE item in this basket (`includingFees !== true`) —
   * SessionCheckoutService resolves this gate from each cart item's
   * formData (the ONLY place that flag is ever available; it is never
   * persisted on the financial_services row) and hands the ids down. The
   * fee VALUE itself is read here, once, from the persisted
   * `financial_services.omt_fee`/`whish_fee` columns (rule 14 — the single
   * source of truth, already resolved by FinancialServiceRepository's WHISH
   * tier lookup at create time) and folded into the CHARGE bucket: the fee
   * is real cash collected via the pooled charge legs even though the
   * RECEIVE item's OWN linked amount is negative (payout-side).
   *
   * Fails soft (logs + returns an all-zero context, i.e. "no PCD split") on
   * any error — a resolution failure must never block the basket payment
   * itself; it only means the cash stays in General, which is the
   * pre-existing (safe) behavior, not a money-loss bug.
   */
  getSessionCashSplitContext(
    sessionId: number,
    feeOnTopReceiveFsIds: number[] = [],
  ): SessionCashSplitContext {
    const baseSystem = this.resolveBaseSystem();
    const zeroContext: SessionCashSplitContext = {
      baseSystem,
      chargeTotalUsd: 0,
      chargeTotalLbp: 0,
      primarySystemChargeUsd: 0,
      primarySystemChargeLbp: 0,
      payoutTotalUsd: 0,
      payoutTotalLbp: 0,
      primarySystemPayoutUsd: 0,
      primarySystemPayoutLbp: 0,
    };
    try {
      const tenantId = getCurrentTenantId();
      const row = this.db
        .prepare(
          `SELECT
             COALESCE(SUM(CASE WHEN cst.amount_usd > 0 THEN cst.amount_usd ELSE 0 END), 0) AS charge_usd,
             COALESCE(SUM(CASE WHEN cst.amount_lbp > 0 THEN cst.amount_lbp ELSE 0 END), 0) AS charge_lbp,
             COALESCE(SUM(CASE WHEN cst.amount_usd < 0 THEN -cst.amount_usd ELSE 0 END), 0) AS payout_usd,
             COALESCE(SUM(CASE WHEN cst.amount_lbp < 0 THEN -cst.amount_lbp ELSE 0 END), 0) AS payout_lbp,
             COALESCE(SUM(CASE WHEN fs.provider = ? AND cst.amount_usd > 0 THEN cst.amount_usd ELSE 0 END), 0) AS primary_charge_usd,
             COALESCE(SUM(CASE WHEN fs.provider = ? AND cst.amount_lbp > 0 THEN cst.amount_lbp ELSE 0 END), 0) AS primary_charge_lbp,
             COALESCE(SUM(CASE WHEN fs.provider = ? AND cst.amount_usd < 0 THEN -cst.amount_usd ELSE 0 END), 0) AS primary_payout_usd,
             COALESCE(SUM(CASE WHEN fs.provider = ? AND cst.amount_lbp < 0 THEN -cst.amount_lbp ELSE 0 END), 0) AS primary_payout_lbp
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
          baseSystem,
          baseSystem,
          tenantId,
          tenantId,
          sessionId,
          tenantId,
        ) as SessionCashSplitRow | undefined;

      let feeChargeUsd = 0;
      let feeChargeLbp = 0;
      let feePrimaryChargeUsd = 0;
      let feePrimaryChargeLbp = 0;

      if (feeOnTopReceiveFsIds.length > 0) {
        const placeholders = feeOnTopReceiveFsIds.map(() => "?").join(",");
        const feeRows = this.db
          .prepare(
            `SELECT provider, currency, COALESCE(omt_fee, whish_fee, 0) AS fee
             FROM financial_services
             WHERE tenant_id = ? AND id IN (${placeholders})`,
          )
          .all(tenantId, ...feeOnTopReceiveFsIds) as SessionFeeRow[];

        for (const feeRow of feeRows) {
          const fee = feeRow.fee ?? 0;
          if (fee <= 0) continue;
          if (feeRow.currency === "LBP") {
            feeChargeLbp += fee;
            if (feeRow.provider === baseSystem) feePrimaryChargeLbp += fee;
          } else {
            feeChargeUsd += fee;
            if (feeRow.provider === baseSystem) feePrimaryChargeUsd += fee;
          }
        }
      }

      return {
        baseSystem,
        chargeTotalUsd: (row?.charge_usd ?? 0) + feeChargeUsd,
        chargeTotalLbp: (row?.charge_lbp ?? 0) + feeChargeLbp,
        primarySystemChargeUsd:
          (row?.primary_charge_usd ?? 0) + feePrimaryChargeUsd,
        primarySystemChargeLbp:
          (row?.primary_charge_lbp ?? 0) + feePrimaryChargeLbp,
        payoutTotalUsd: row?.payout_usd ?? 0,
        payoutTotalLbp: row?.payout_lbp ?? 0,
        primarySystemPayoutUsd: row?.primary_payout_usd ?? 0,
        primarySystemPayoutLbp: row?.primary_payout_lbp ?? 0,
      };
    } catch (error) {
      closingLogger.error(
        { error, sessionId },
        "getSessionCashSplitContext failed — defaulting to no PCD split (cash stays in General)",
      );
      return zeroContext;
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
