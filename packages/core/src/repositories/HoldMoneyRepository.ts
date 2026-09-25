/**
 * Hold Money Repository
 *
 * Handles cash held on behalf of a named client. Holding cash credits a
 * drawer; collecting (returning) it debits one — every leg posted through
 * the same payment-form contract every other Services tab already uses
 * (LIRA-214, OWNER_NOTES_REMAINING_BUILD.md #24, migration v183). Each hold,
 * pickup and pickup-void writes a unified `transactions` row + `payments`
 * legs so the movement is visible in transaction/audit history.
 *
 * Follows the transactional repository pattern used by CustomServiceRepository
 * (rule 13 — no raw SQL business logic outside a repository; rule 16 — every
 * posting loop below is the ONE shared pass over a flow's legs, never a
 * second pass over `returnLegs`/`outLegs` that would double-post them).
 */

import { BaseRepository } from "./BaseRepository.js";
import { customServiceLogger } from "../utils/logger.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import {
  applyDrawerDelta,
  insertPaymentRow,
  reconcileLegs,
  resolveStampedExchangeRate,
  type ReconciliationLeg,
} from "./moneyPosting.js";
import { paymentMethodToDrawerName, partitionLegs } from "../utils/payments.js";
import { getUsdLbpSellRate } from "../utils/exchangeRate.js";
import type {
  HoldMoneyCreateInput,
  HoldMoneyCollectInput,
  HoldMoneyPaymentLegInput,
} from "../validators/holdMoney.js";

// =============================================================================
// Entity Types
// =============================================================================

export type HoldMoneyStatus = "held" | "collected";

export interface HoldMoneyEntity {
  id: number;
  client_name: string;
  phone_number: string | null;
  /** Rule 11 — the resolved client, when the operator picked one from the
   *  autocomplete. Null for a walk-in (name+phone only, no clients row). */
  client_id: number | null;
  usd_amount: number;
  lbp_amount: number;
  status: HoldMoneyStatus;
  notes: string | null;
  created_by: number | null;
  collected_by: number | null;
  collected_at: string | null;
  created_at: string;
  updated_at: string;
  /** DERIVED live (never persisted) — usd_amount/lbp_amount minus the SUM
   *  of this hold's non-voided `hold_money_pickups` rows. A hold with zero
   *  pickups reads its full original amount, so every pre-v183 hold is
   *  unaffected. */
  remaining_usd: number;
  remaining_lbp: number;
}

/** One pickup EVENT against a hold (migration v183 — the partial-pickup
 *  balance model). `is_voided` rows are excluded from the remaining-balance
 *  derivation everywhere it's computed (getColumns' correlated subquery). */
export interface HoldMoneyPickupEntity {
  id: number;
  hold_money_id: number;
  transaction_id: number | null;
  usd_amount: number;
  lbp_amount: number;
  is_voided: number;
  voided_by: number | null;
  voided_at: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

/** Kept for backward compatibility with existing callers/tests — identical
 *  shape to `HoldMoneyCreateInput` (the validated schema type), duplicated
 *  here only as a type alias so this file doesn't force every caller to
 *  import from `validators/holdMoney.js` directly. */
export type CreateHoldMoneyInput = HoldMoneyCreateInput;

export interface HoldMoneyResult {
  success: boolean;
  id?: number;
  error?: string;
}

/** Category slug used for the Service History row written on a pickup. */
const HOLD_MONEY_CATEGORY = "hold_money";

/** USD-equivalent / LBP-equivalent tolerances for "is the remaining balance
 *  effectively zero" and "does the requested portion exceed what remains"
 *  checks — same order of magnitude as `LEG_RECONCILIATION_EPSILON_USD`
 *  (moneyPosting.ts), expressed per-currency since this repo compares raw
 *  usd/lbp buckets rather than a single USD-equivalent figure. */
const USD_EPSILON = 0.01;
const LBP_EPSILON = 1;

/**
 * Derive a display-only `paid_by` label from a flow's ACTUAL legs (scout
 * finding — the pre-fix Hold Money history row hardcoded 'CASH' regardless
 * of what was really tendered). Same rule as the established frontend
 * helper `derivePaidByMethod` (frontend/src/utils/paymentUtils.ts) — one
 * leg's method, "MULTI" for 2+, `fallback` for zero — reimplemented here
 * (not imported: that module is frontend-only) because this repository is
 * the ONE place that needs the server-side echo of the same rule (rule 14
 * — one definition per LAYER, not a cross-layer import that would pull a
 * frontend module into `@liratek/core`).
 */
function derivePaidByLabel(
  legs: Array<{ method: string }>,
  fallback = "CASH",
): string {
  if (legs.length > 1) return "MULTI";
  if (legs.length === 1) return legs[0].method;
  return fallback;
}

/**
 * `HoldMoneyPaymentLegInput` (this module's own snake_case `currency_code`
 * wire shape, matching every other flow's leg validator) → `moneyPosting`'s
 * `ReconciliationLeg` (camelCase `currencyCode`) — needed ONLY for the
 * `reconcileLegs` check; the posting loops below read `leg.currency_code`
 * off the original array directly and never see this adapted shape.
 */
function toReconciliationLeg(
  leg: HoldMoneyPaymentLegInput,
): ReconciliationLeg {
  return {
    method: leg.method,
    currencyCode: leg.currency_code,
    amount: leg.amount,
    direction: leg.direction,
  };
}

// =============================================================================
// Hold Money Repository Class
// =============================================================================

export class HoldMoneyRepository extends BaseRepository<HoldMoneyEntity> {
  constructor() {
    super("hold_money", { softDelete: false });
  }

  protected getColumns(): string {
    // The correlated subqueries reference `hold_money.id` — safe because
    // every SELECT built from this method has a bare `FROM hold_money`
    // (no alias, no join), exactly like BaseRepository's own generic
    // getById/list helpers (which also call this method).
    return `
      id, client_name, phone_number, client_id, usd_amount, lbp_amount, status,
      notes, created_by, collected_by, collected_at, created_at, updated_at,
      (usd_amount - COALESCE((
        SELECT SUM(usd_amount) FROM hold_money_pickups p
        WHERE p.hold_money_id = hold_money.id AND p.is_voided = 0
      ), 0)) AS remaining_usd,
      (lbp_amount - COALESCE((
        SELECT SUM(lbp_amount) FROM hold_money_pickups p
        WHERE p.hold_money_id = hold_money.id AND p.is_voided = 0
      ), 0)) AS remaining_lbp
    `;
  }

  /**
   * Create a hold: record the held cash and post its payment legs.
   * Runs inside a single DB transaction.
   */
  createHold(
    data: CreateHoldMoneyInput,
    createdBy: number = 1,
  ): HoldMoneyResult {
    try {
      // `Number(...)` (not a bare `?? 0`) sidesteps a zod v4 typing quirk:
      // `z.input` on a `z.coerce.number().default(0)` field infers `{}` for
      // the `??`-narrowed expression (reproduced in isolation — the runtime
      // value is always a plain number or undefined; this is a static-type
      // artifact only).
      const usd = Math.abs(Number(data.usd_amount ?? 0));
      const lbp = Math.abs(Number(data.lbp_amount ?? 0));

      // Reject non-finite amounts (Infinity/NaN) at the data-layer boundary —
      // they slip past the `<= 0` guard and would irrecoverably corrupt the
      // drawer balance. Defense-in-depth for any caller that skips Zod.
      if (!Number.isFinite(usd) || !Number.isFinite(lbp)) {
        return { success: false, error: "Amounts must be finite numbers" };
      }
      if (usd <= 0 && lbp <= 0) {
        return {
          success: false,
          error: "At least one of USD or LBP amount is required",
        };
      }
      if (!data.client_name || !data.client_name.trim()) {
        return { success: false, error: "Client name is required" };
      }

      const clientName = data.client_name.trim();
      const phone = data.phone_number?.trim() || null;
      // note 14 — append the held amount+currency after the existing prefix
      // (prefix stays exact for any test/e2e matching "Hold Money: {name}").
      const amountParts: string[] = [];
      if (usd > 0) amountParts.push(`$${usd.toLocaleString()}`);
      if (lbp > 0) amountParts.push(`${lbp.toLocaleString()} LBP`);
      const noteText = `Hold Money: ${clientName} — ${amountParts.join(" + ")}`;

      const legs: HoldMoneyPaymentLegInput[] = data.payments ?? [];
      const { inLegs, outLegs } = partitionLegs(legs.map(toReconciliationLeg));
      const sellRate = getUsdLbpSellRate(this.db);
      const stampedRate = resolveStampedExchangeRate(
        sellRate,
        data.exchange_rate,
      );

      if (legs.length > 0) {
        reconcileLegs({
          inLegs,
          outLegs,
          expectedTotals: { usd, lbp },
          exchangeRate: sellRate,
          tenderExchangeRate: data.exchange_rate,
          context: "Hold Money",
        });
      }

      const result = this.db.transaction(() => {
        const tenantId = getCurrentTenantId();

        // 1. Insert the hold record
        const insertHold = this.db.prepare(`
          INSERT INTO hold_money (
            client_name, phone_number, client_id, usd_amount, lbp_amount, status, notes, created_by, tenant_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'held', ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)
        `);
        const holdResult = insertHold.run(
          clientName,
          phone,
          data.client_id ?? null,
          usd,
          lbp,
          data.notes ?? null,
          createdBy,
          tenantId,
          data.transaction_time ?? null,
        );
        const holdId = Number(holdResult.lastInsertRowid);

        // 2. Unified transaction row (cash in, no profit — Hold Money never
        // books a profit; see the validator's exchange_rate doc comment).
        const txnId = getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.HOLD_MONEY,
          source_table: "hold_money",
          source_id: holdId,
          user_id: createdBy,
          amount_usd: usd,
          amount_lbp: lbp,
          profit_usd: 0,
          profit_lbp: 0,
          exchange_rate: stampedRate,
          client_id: data.client_id ?? null,
          // Surface the captured customer in the Transactions/Audit viewer
          // (Client column) — otherwise it renders "—" (CLAUDE.md rule 11).
          client_name: clientName,
          client_phone: phone,
          summary: noteText,
          metadata_json: {
            client_name: clientName,
            phone_number: phone,
            usd_amount: usd,
            lbp_amount: lbp,
            kind: "hold",
          },
          transaction_time: data.transaction_time,
        });

        // 3. Post the legs — ONE pass over the raw (unpartitioned) array so
        // every leg is posted exactly once, direction decides the sign
        // (rule 16). Falls back to a single CASH leg for the full amount
        // when no legs were sent (backward compatibility — see the
        // validator's `payments` doc comment).
        if (legs.length > 0) {
          for (const leg of legs) {
            const amt = Math.abs(leg.amount);
            if (amt === 0) continue;
            const isOut = leg.direction === "OUT";
            const drawer = paymentMethodToDrawerName(leg.method);
            const signed = isOut ? -amt : amt;
            insertPaymentRow(this.db, {
              transactionId: txnId,
              method: leg.method,
              drawerName: drawer,
              currencyCode: leg.currency_code,
              amount: signed,
              note: isOut ? "Change returned" : noteText,
              createdBy,
              tenantId,
            });
            applyDrawerDelta(this.db, {
              drawerName: drawer,
              currencyCode: leg.currency_code,
              delta: signed,
              tenantId,
            });
          }
        } else {
          this.postFallbackCashLeg(txnId, usd, lbp, 1, noteText, createdBy, tenantId);
        }

        return holdId;
      })();

      customServiceLogger.info(
        { id: result, client_name: clientName, usd, lbp },
        `Hold money created: ${clientName}`,
      );

      return { success: true, id: result };
    } catch (error) {
      customServiceLogger.error({ error, data }, "Failed to create hold money");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Collect (return) part or all of a held amount — a PAYOUT: the shop pays
   * the customer, so a leg's default ("IN") direction is payout composition
   * (debits the drawer) and an "OUT"-tagged leg is money the customer hands
   * BACK to the shop (credits it back) — same convention `postPayoutLegs`
   * uses for a RECEIVE cashout. Supports a partial pickup (migration v183):
   * `data.usd_amount`/`data.lbp_amount` default to the hold's full
   * remaining balance in that currency when omitted.
   */
  collectHold(
    data: HoldMoneyCollectInput,
    collectedBy: number = 1,
  ): HoldMoneyResult {
    try {
      const legs: HoldMoneyPaymentLegInput[] = data.payments ?? [];
      const { inLegs, outLegs } = partitionLegs(legs.map(toReconciliationLeg));
      const sellRate = getUsdLbpSellRate(this.db);
      const stampedRate = resolveStampedExchangeRate(
        sellRate,
        data.exchange_rate,
      );

      const result = this.db.transaction(() => {
        const tenantId = getCurrentTenantId();
        const hold = this.getById(data.id);
        if (!hold) throw new Error("Hold not found");
        if (hold.status !== "held") {
          throw new Error("Hold has already been fully collected");
        }

        const remainingUsd = hold.remaining_usd;
        const remainingLbp = hold.remaining_lbp;
        const portionUsd = data.usd_amount ?? remainingUsd;
        const portionLbp = data.lbp_amount ?? remainingLbp;

        if (portionUsd < 0 || portionLbp < 0) {
          throw new Error("Amounts to return cannot be negative");
        }
        if (portionUsd > remainingUsd + USD_EPSILON) {
          throw new Error(
            `Cannot return $${portionUsd.toFixed(2)} — only $${remainingUsd.toFixed(2)} remains held`,
          );
        }
        if (portionLbp > remainingLbp + LBP_EPSILON) {
          throw new Error(
            `Cannot return ${Math.round(portionLbp).toLocaleString()} LBP — only ${Math.round(remainingLbp).toLocaleString()} LBP remains held`,
          );
        }
        if (portionUsd <= USD_EPSILON && portionLbp <= LBP_EPSILON) {
          throw new Error("Nothing to collect — the amount is zero");
        }

        if (legs.length > 0) {
          reconcileLegs({
            inLegs,
            outLegs,
            expectedTotals: { usd: portionUsd, lbp: portionLbp },
            exchangeRate: sellRate,
            tenderExchangeRate: data.exchange_rate,
            context: "Hold Money pickup",
          });
        }

        const noteText = `Hold Collected: ${hold.client_name}`;

        // 1. Unified transaction row (cash out, no profit)
        const txnId = getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.HOLD_MONEY_COLLECT,
          source_table: "hold_money",
          source_id: data.id,
          user_id: collectedBy,
          amount_usd: portionUsd,
          amount_lbp: portionLbp,
          profit_usd: 0,
          profit_lbp: 0,
          exchange_rate: stampedRate,
          client_id: hold.client_id,
          // Surface the customer in the Transactions/Audit viewer (rule 11).
          client_name: hold.client_name,
          client_phone: hold.phone_number,
          summary: noteText,
          metadata_json: {
            client_name: hold.client_name,
            phone_number: hold.phone_number,
            usd_amount: portionUsd,
            lbp_amount: portionLbp,
            kind: "collect",
            partial: portionUsd < remainingUsd - USD_EPSILON ||
              portionLbp < remainingLbp - LBP_EPSILON,
          },
          transaction_time: data.transaction_time,
        });

        // 2. Post the payout legs — ONE pass, same rule-16 shape as
        // createHold above. Falls back to a single CASH leg for the full
        // portion when no legs were sent.
        if (legs.length > 0) {
          for (const leg of legs) {
            const amt = Math.abs(leg.amount);
            if (amt === 0) continue;
            const isReturn = leg.direction === "OUT";
            const drawer = paymentMethodToDrawerName(leg.method);
            const signed = isReturn ? amt : -amt;
            insertPaymentRow(this.db, {
              transactionId: txnId,
              method: leg.method,
              drawerName: drawer,
              currencyCode: leg.currency_code,
              amount: signed,
              note: noteText,
              createdBy: collectedBy,
              tenantId,
            });
            applyDrawerDelta(this.db, {
              drawerName: drawer,
              currencyCode: leg.currency_code,
              delta: signed,
              tenantId,
            });
          }
        } else {
          this.postFallbackCashLeg(
            txnId,
            portionUsd,
            portionLbp,
            -1,
            noteText,
            collectedBy,
            tenantId,
          );
        }

        // 3. Record this pickup event (the v183 balance-model row).
        const pickupResult = this.db
          .prepare(
            `INSERT INTO hold_money_pickups (
               tenant_id, hold_money_id, transaction_id, usd_amount, lbp_amount, created_by, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          )
          .run(tenantId, hold.id, txnId, portionUsd, portionLbp, collectedBy);
        const pickupId = Number(pickupResult.lastInsertRowid);

        // 4. Flip status to 'collected' only once NOTHING remains in either
        // currency (partial pickups keep it 'held').
        const newRemainingUsd = remainingUsd - portionUsd;
        const newRemainingLbp = remainingLbp - portionLbp;
        if (newRemainingUsd <= USD_EPSILON && newRemainingLbp <= LBP_EPSILON) {
          this.db
            .prepare(
              `UPDATE hold_money
               SET status = 'collected', collected_by = ?, collected_at = COALESCE(?, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
               WHERE id = ? AND tenant_id = ?`,
            )
            .run(collectedBy, data.transaction_time ?? null, hold.id, tenantId);
        }

        // 5. Service History row — paid_by derived from the REAL legs
        // (scout finding: this used to hardcode 'CASH').
        const paidBy = derivePaidByLabel(legs);
        const amountParts: string[] = [];
        if (portionUsd > 0) amountParts.push(`$${portionUsd.toFixed(2)}`);
        if (portionLbp > 0)
          amountParts.push(`${portionLbp.toLocaleString("en-US")} LBP`);
        const historyDesc = `Hold pickup for ${hold.client_name} — ${amountParts.join(" + ")}`;
        this.db
          .prepare(
            `INSERT INTO custom_services (
               description, cost_usd, cost_lbp, price_usd, price_lbp,
               paid_by, status, client_id, client_name, phone_number, note, category, created_by, tenant_id, created_at
             ) VALUES (?, 0, 0, 0, 0, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          )
          .run(
            historyDesc,
            paidBy,
            hold.client_id,
            hold.client_name,
            hold.phone_number,
            `Hold #${hold.id} pickup #${pickupId}`,
            HOLD_MONEY_CATEGORY,
            collectedBy,
            tenantId,
          );

        return txnId;
      })();

      customServiceLogger.info(
        { id: data.id, usd: data.usd_amount, lbp: data.lbp_amount },
        `Hold money collected: #${data.id}`,
      );
      return { success: true, id: result };
    } catch (error) {
      customServiceLogger.error(
        { error, data },
        "Failed to collect hold money",
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Void (reverse) ONE pickup event — the rule-20 reversal owner for a
   * partial or full return recorded in error. Re-credits every drawer that
   * pickup's legs debited (a mirror-image posting from the pickup's OWN
   * `payments` rows, so it is correct even for a mixed CASH+wallet split),
   * writes a dedicated HOLD_MONEY_COLLECT_VOID row with `reverses_id`
   * pointing at the pickup's own HOLD_MONEY_COLLECT transaction, and marks
   * the pickup `is_voided` so the derived remaining balance goes back up —
   * flipping `hold_money.status` back to 'held' if it had reached
   * 'collected'. See TRANSACTION_TYPES.HOLD_MONEY_COLLECT_VOID's doc
   * comment for why this is a dedicated reversal rather than the generic
   * void/refund path.
   */
  voidPickup(pickupId: number, voidedBy: number = 1): HoldMoneyResult {
    try {
      const result = this.db.transaction(() => {
        const tenantId = getCurrentTenantId();
        const pickup = this.db
          .prepare(
            `SELECT id, hold_money_id, transaction_id, usd_amount, lbp_amount, is_voided
             FROM hold_money_pickups WHERE id = ? AND tenant_id = ?`,
          )
          .get(pickupId, tenantId) as
          | {
              id: number;
              hold_money_id: number;
              transaction_id: number | null;
              usd_amount: number;
              lbp_amount: number;
              is_voided: number;
            }
          | undefined;
        if (!pickup) throw new Error("Pickup not found");
        if (pickup.is_voided) throw new Error("Pickup already voided");

        const hold = this.getById(pickup.hold_money_id);
        if (!hold) throw new Error("Hold not found");

        const noteText = `Hold Pickup #${pickup.id} voided (${hold.client_name})`;

        const txnId = getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.HOLD_MONEY_COLLECT_VOID,
          source_table: "hold_money_pickups",
          source_id: pickup.id,
          user_id: voidedBy,
          amount_usd: pickup.usd_amount,
          amount_lbp: pickup.lbp_amount,
          profit_usd: 0,
          profit_lbp: 0,
          client_id: hold.client_id,
          client_name: hold.client_name,
          client_phone: hold.phone_number,
          summary: noteText,
          metadata_json: {
            hold_money_id: hold.id,
            pickup_id: pickup.id,
            usd_amount: pickup.usd_amount,
            lbp_amount: pickup.lbp_amount,
            kind: "collect_void",
          },
        });

        if (pickup.transaction_id != null) {
          // Accounting-journal convention (see TransactionRepository's own
          // reversal writers): the reversal row is created first, then
          // linked back via reverses_id.
          this.db
            .prepare(
              `UPDATE transactions SET reverses_id = ? WHERE id = ? AND tenant_id = ?`,
            )
            .run(pickup.transaction_id, txnId, tenantId);

          // Reverse EXACTLY the legs the pickup posted — a mirror-image
          // opposite-signed leg per row, so a mixed CASH+wallet pickup
          // reverses every drawer it touched, not just the primary one.
          const originalLegs = this.db
            .prepare(
              `SELECT method, drawer_name, currency_code, amount
               FROM payments WHERE transaction_id = ? AND tenant_id = ?`,
            )
            .all(pickup.transaction_id, tenantId) as Array<{
            method: string;
            drawer_name: string;
            currency_code: string;
            amount: number;
          }>;

          for (const leg of originalLegs) {
            insertPaymentRow(this.db, {
              transactionId: txnId,
              method: leg.method,
              drawerName: leg.drawer_name,
              currencyCode: leg.currency_code,
              amount: -leg.amount,
              note: noteText,
              createdBy: voidedBy,
              tenantId,
            });
            applyDrawerDelta(this.db, {
              drawerName: leg.drawer_name,
              currencyCode: leg.currency_code,
              delta: -leg.amount,
              tenantId,
            });
          }
        }

        this.db
          .prepare(
            `UPDATE hold_money_pickups
             SET is_voided = 1, voided_by = ?, voided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND tenant_id = ?`,
          )
          .run(voidedBy, pickup.id, tenantId);

        // The derived remaining balance just went back up — reopen the hold
        // if it had reached 'collected'.
        if (hold.status === "collected") {
          this.db
            .prepare(
              `UPDATE hold_money SET status = 'held', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?`,
            )
            .run(hold.id, tenantId);
        }

        return txnId;
      })();

      customServiceLogger.info({ pickupId }, `Hold pickup voided: #${pickupId}`);
      return { success: true, id: result };
    } catch (error) {
      customServiceLogger.error(
        { error, pickupId },
        "Failed to void hold money pickup",
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Every pickup event (voided or not) for one hold, newest first — the
   * Active Holds detail view and the void action's source list.
   */
  getPickups(holdMoneyId: number): HoldMoneyPickupEntity[] {
    return this.db
      .prepare(
        `SELECT id, hold_money_id, transaction_id, usd_amount, lbp_amount, is_voided,
                voided_by, voided_at, created_by, created_at, updated_at
         FROM hold_money_pickups WHERE hold_money_id = ? AND tenant_id = ?
         ORDER BY created_at DESC, id DESC`,
      )
      .all(holdMoneyId, getCurrentTenantId()) as HoldMoneyPickupEntity[];
  }

  /**
   * Active (uncollected — i.e. remaining > 0 in either currency) holds,
   * newest first.
   */
  getActiveHolds(): HoldMoneyEntity[] {
    return this.db
      .prepare(
        `SELECT ${this.getColumns()} FROM hold_money WHERE status = 'held' AND tenant_id = ? ORDER BY created_at DESC`,
      )
      .all(getCurrentTenantId()) as HoldMoneyEntity[];
  }

  /**
   * All holds, optionally filtered by status, newest first.
   */
  getAll(filter?: { status?: HoldMoneyStatus }): HoldMoneyEntity[] {
    let query = `SELECT ${this.getColumns()} FROM hold_money WHERE tenant_id = ?`;
    const params: unknown[] = [getCurrentTenantId()];
    if (filter?.status) {
      query += ` AND status = ?`;
      params.push(filter.status);
    }
    query += ` ORDER BY created_at DESC`;
    return this.db.prepare(query).all(...params) as HoldMoneyEntity[];
  }

  /**
   * Single hold by ID.
   */
  getById(id: number): HoldMoneyEntity | null {
    return (
      (this.db
        .prepare(
          `SELECT ${this.getColumns()} FROM hold_money WHERE id = ? AND tenant_id = ?`,
        )
        .get(id, getCurrentTenantId()) as HoldMoneyEntity) ?? null
    );
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Legacy/scripted-caller fallback (no `payments[]` sent at all): a single
   * CASH leg for the full amount, posted to whichever drawer CASH resolves
   * to today via the standard resolver — no longer hardcoded to General.
   * `sign` is +1 for cash in (hold) or -1 for cash out (collect).
   */
  private postFallbackCashLeg(
    txnId: number,
    usd: number,
    lbp: number,
    sign: 1 | -1,
    note: string,
    userId: number,
    tenantId: number,
  ): void {
    const drawer = paymentMethodToDrawerName("CASH");

    const postLeg = (currencyCode: string, amount: number) => {
      insertPaymentRow(this.db, {
        transactionId: txnId,
        method: "CASH",
        drawerName: drawer,
        currencyCode,
        amount,
        note,
        createdBy: userId,
        tenantId,
      });
      applyDrawerDelta(this.db, {
        drawerName: drawer,
        currencyCode,
        delta: amount,
        tenantId,
      });
    };

    if (usd > 0) postLeg("USD", sign * usd);
    if (lbp > 0) postLeg("LBP", sign * lbp);
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let holdMoneyRepositoryInstance: HoldMoneyRepository | null = null;

export function getHoldMoneyRepository(): HoldMoneyRepository {
  if (!holdMoneyRepositoryInstance) {
    holdMoneyRepositoryInstance = new HoldMoneyRepository();
  }
  return holdMoneyRepositoryInstance;
}

/** Reset the singleton (for testing) */
export function resetHoldMoneyRepository(): void {
  holdMoneyRepositoryInstance = null;
}
