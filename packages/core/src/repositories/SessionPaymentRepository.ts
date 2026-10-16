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
import { requestNow } from "../utils/requestNow.js";
import { applyDrawerDelta, insertPaymentRow } from "./moneyPosting.js";
import { getSettingsRepository } from "./SettingsRepository.js";
import type { BaseSystem } from "../utils/payments.js";
import { isPrimarySystemProvider } from "../utils/payments.js";
import { allocateBasketMemberOwed } from "../utils/sessionMemberOwed.js";
import { closingLogger } from "../utils/logger.js";
import { SESSION_DEBT_TYPE } from "../constants/transactionTypes.js";

export interface InsertSessionLegInput {
  sessionId: number;
  method: string;
  drawerName: string;
  currencyCode: string;
  /** Signed amount: positive for IN, negative for OUT/change. */
  amount: number;
  note: string;
  userId: number;
  /** Bug #4 — a backdated checkout's time (SQLite UTC text). Omitted = now. */
  createdAt?: string;
}

export interface InsertBasketDebtInput {
  sessionId: number;
  clientId: number;
  amountUsd: number;
  amountLbp: number;
  /** LIRA-258 / G17 — the part of the charge that is NOT waiting for a
   *  repayment at checkout (sales-first share, tracked by sales.paid_usd,
   *  plus the gift-card share), written as the row's initial
   *  covered_usd/covered_lbp. Defaults to 0. */
  coveredUsd?: number;
  coveredLbp?: number;
  userId: number;
  /** Bug #4 — a backdated checkout's time (SQLite UTC text); the due date
   *  is 30 days after it. Omitted = now. */
  createdAt?: string;
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
  /**
   * Owner decision #11-A (2026-09-24) / fix-round finding #2. Payout total
   * restricted to items backed by an OMT/WHISH `financial_services` row
   * (`fs.provider IS NOT NULL` below) — i.e. EXCLUDES a General-drawer payout
   * (loto prize, wallet/Binance cash-out), which is never financial_services-
   * backed. A basket's `payoutOrigin: "SYSTEM"` leg (binanceCart.ts's
   * `SYSTEM_PAYOUT_MODULES` = omt_system + whish_system combined into ONE
   * cross-provider number) needs THIS as its ratio denominator, not
   * `payoutTotalUsd` — that one also contains any General payout in the same
   * basket, which would wrongly shrink the SYSTEM leg's PCD share whenever a
   * loto/wallet payout rides along (see `ratioForCurrency`'s `SYSTEM` branch
   * in SessionPaymentService.ts).
   */
  systemPayoutTotalUsd: number;
  systemPayoutTotalLbp: number;
  /**
   * LIRA-270 — true only on the fail-soft all-zero context returned when the
   * lookup threw. Zeros there mean "unknown", not "nothing due", so the
   * nothing-to-collect check must skip rather than refuse every leg.
   */
  lookupFailed?: boolean;
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
  system_payout_usd: number;
  system_payout_lbp: number;
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
      createdAt: input.createdAt,
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
   * CUSTOMER_ACCOUNT (+ GIFT_CARD) portion, due in 30 days. Its initial
   * `covered_*` is the caller-computed pre-coverage (LIRA-258 / G17); the
   * rest is covered by client repayments (DebtRepository
   * ._coverServiceDebtsFIFO), which releases the basket items' profit.
   */
  insertBasketDebt(input: InsertBasketDebtInput): void {
    const now = input.createdAt ?? requestNow();
    this.db
      .prepare(
        `INSERT INTO debt_ledger (
          client_id, transaction_type, amount_usd, amount_lbp, covered_usd, covered_lbp, transaction_id, note, created_by, due_date, session_id, tenant_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, datetime(?, '+30 days'), ?, ?, ?)`,
      )
      .run(
        input.clientId,
        SESSION_DEBT_TYPE,
        input.amountUsd,
        input.amountLbp,
        input.coveredUsd ?? 0,
        input.coveredLbp ?? 0,
        `Session #${input.sessionId} basket`,
        input.userId,
        now, // due date = business time + 30 days (LIRA-306 FR-021)
        input.sessionId,
        getCurrentTenantId(),
        now,
      );
  }

  /**
   * LIRA-304 — record which basket items the on-account part belongs to
   * (`customer_session_transactions.owed_*`), right after the basket's
   * 'Session Debt' row is booked. The row's non-sale debt (its amount minus
   * the checkout pre-cover) is spread over the non-sale charge members by
   * `allocateBasketMemberOwed` — "OMT first": the debt lands on the other
   * items first and on the shop's primary-system transfers last (owner
   * decision 2026-10-10). Keeps invariant I1: Σ member open = row outstanding.
   * No-op when the basket has no debt row.
   */
  writeBasketMemberOwed(sessionId: number, rate: number): void {
    // A database from before migration v209 (or a hand-rolled test schema
    // holding only the tables its own test touches) has no member share
    // columns to write — nothing to keep in step there. On every migrated
    // database this always runs, and its errors propagate.
    if (!this.hasMemberShareColumns()) return;
    const tenantId = getCurrentTenantId();
    const row = this.db
      .prepare(
        `SELECT amount_usd - covered_usd AS out_usd, amount_lbp - covered_lbp AS out_lbp
         FROM debt_ledger
         WHERE session_id = ? AND tenant_id = ? AND transaction_type = ?
           AND transaction_id IS NULL
         ORDER BY id DESC LIMIT 1`,
      )
      .get(sessionId, tenantId, SESSION_DEBT_TYPE) as
      | { out_usd: number; out_lbp: number }
      | undefined;
    if (!row) return;
    const members = this.db
      .prepare(
        `SELECT cst.id, cst.amount_usd, cst.amount_lbp, fs.provider
         FROM customer_session_transactions cst
         JOIN transactions t ON t.id = cst.unified_transaction_id AND t.tenant_id = cst.tenant_id
         LEFT JOIN financial_services fs ON t.source_table = 'financial_services'
           AND fs.id = t.source_id AND fs.tenant_id = t.tenant_id
         WHERE cst.session_id = ? AND cst.tenant_id = ?
           AND cst.transaction_type <> 'session_item_refund'
           AND t.type <> 'SALE'
           AND (cst.amount_usd > 0 OR cst.amount_lbp > 0)
         ORDER BY cst.id ASC`,
      )
      .all(sessionId, tenantId) as Array<{
      id: number;
      amount_usd: number;
      amount_lbp: number;
      provider: string | null;
    }>;
    if (members.length === 0) return;
    const baseSystem = this.resolveBaseSystem();
    const owed = allocateBasketMemberOwed({
      outstandingUsd: row.out_usd,
      outstandingLbp: row.out_lbp,
      members: members.map((m) => ({
        id: m.id,
        amountUsd: m.amount_usd,
        amountLbp: m.amount_lbp,
        isPrimary: isPrimarySystemProvider(m.provider, baseSystem),
      })),
      rate,
    });
    const upd = this.db.prepare(
      `UPDATE customer_session_transactions
       SET owed_usd = ?, owed_lbp = ?, updated_at = datetime('now')
       WHERE id = ? AND tenant_id = ?`,
    );
    for (const o of owed) upd.run(o.owedUsd, o.owedLbp, o.id, tenantId);
  }

  private hasMemberShareColumns(): boolean {
    const cols = this.db
      .prepare(`PRAGMA table_info(customer_session_transactions)`)
      .all() as Array<{ name: string }>;
    const fs = this.db
      .prepare(
        `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'financial_services'`,
      )
      .get();
    return !!fs && cols.some((c) => c.name === "owed_usd");
  }

  /**
   * REFUND_EXCHANGE_RATE_PLAN.md / SESSION_ITEM_REFUND_PLAN.md round-3
   * review, finding F3 — stamp the rate the basket was ACTUALLY checked out
   * at onto every one of its members (`customer_session_transactions
   * .paid_exchange_rate`, migration v186). A SALE member already has its own
   * correct column for this (`sales.exchange_rate_snapshot`, back-filled by
   * `SalesRepository.markSalePaid` with this SAME rate) — this stamps EVERY
   * member uniformly anyway (rule 14: one write, no per-type branching), so
   * a RECHARGE/CUSTOM_SERVICE/FINANCIAL_SERVICE member — which has no
   * snapshot column of its own — gets the same fix. Must run AFTER every
   * cart item is linked (same ordering requirement as
   * `getSessionCashSplitContext` — `SessionPaymentService.recordBasketPayment`
   * runs last, inside the checkout's own db.transaction).
   */
  stampMemberExchangeRate(sessionId: number, rate: number): void {
    if (!(rate > 0)) return;
    try {
      this.db
        .prepare(
          `UPDATE customer_session_transactions SET paid_exchange_rate = ?
           WHERE session_id = ? AND tenant_id = ?`,
        )
        .run(rate, sessionId, getCurrentTenantId());
    } catch {
      // Defensive only (mirrors this file's other minimal-schema fallbacks,
      // e.g. TransactionRepository._financialServiceCashDrawerCtx): a
      // connection that predates migration v186 (a mid-upgrade edge case,
      // or a test fixture that doesn't carry every column) must not fail
      // the whole checkout over an audit-only column. The refund-rate
      // reader falls back to transactions.exchange_rate when this column
      // was never stamped, so this is a pure no-op there, not silent data
      // loss.
    }
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
      systemPayoutTotalUsd: 0,
      systemPayoutTotalLbp: 0,
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
             COALESCE(SUM(CASE WHEN fs.provider = ? AND cst.amount_lbp < 0 THEN -cst.amount_lbp ELSE 0 END), 0) AS primary_payout_lbp,
             COALESCE(SUM(CASE WHEN fs.provider IS NOT NULL AND cst.amount_usd < 0 THEN -cst.amount_usd ELSE 0 END), 0) AS system_payout_usd,
             COALESCE(SUM(CASE WHEN fs.provider IS NOT NULL AND cst.amount_lbp < 0 THEN -cst.amount_lbp ELSE 0 END), 0) AS system_payout_lbp
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
        // D1 cutover (OWNER_NOTES_2026-09-21.md §2b): the fee source is now
        // PROVIDER-gated, not just column-coalesced — two reasons, one fix:
        //
        //   1. OMT system RECEIVE never takes a fee at all, in a session
        //      basket exactly as everywhere else. `createTransaction`'s own
        //      hard-reject guards (includingFees/feePayments) don't reach
        //      this path (the basket's pooled legs are posted by
        //      `recordBasketPayment`, a completely separate call), so this
        //      query is the one place that must independently refuse to
        //      fold an OMT row's `omt_fee` into the charge bucket — even
        //      when a stale/mistaken caller still lists its fsId here.
        //      `omt_fee` stays informational (it drove the commission
        //      calculation at creation time); it must never become real
        //      collected cash.
        //   2. The OLD `COALESCE(omt_fee, whish_fee, 0)` was ALSO latently
        //      broken for a genuine Whish fee-on-top session item, before
        //      D1 and unrelated to it: `omt_fee` carries `DEFAULT 0` (never
        //      NULL), so COALESCE always resolved to 0 for a WHISH row
        //      regardless of `whish_fee` — this mechanism never actually
        //      folded a Whish session fee in, in practice. Provider-gating
        //      the SELECT fixes both issues with one change instead of
        //      leaving the bug and bolting a JS-side skip in front of it.
        const feeRows = this.db
          .prepare(
            `SELECT provider, currency,
                    CASE WHEN provider = 'WHISH' THEN COALESCE(whish_fee, 0) ELSE 0 END AS fee
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
        systemPayoutTotalUsd: row?.system_payout_usd ?? 0,
        systemPayoutTotalLbp: row?.system_payout_lbp ?? 0,
      };
    } catch (error) {
      closingLogger.error(
        { error, sessionId },
        "getSessionCashSplitContext failed — defaulting to no PCD split (cash stays in General)",
      );
      return { ...zeroContext, lookupFailed: true };
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
