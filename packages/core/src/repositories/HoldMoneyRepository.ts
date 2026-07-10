/**
 * Hold Money Repository
 *
 * Handles cash held on behalf of a named client. Holding cash credits the
 * General drawer; collecting (returning) it debits the General drawer. Each
 * hold and collection writes a unified `transactions` row + `payments` legs so
 * the movement is visible in transaction/audit history.
 *
 * Follows the transactional repository pattern used by CustomServiceRepository.
 */

import { BaseRepository } from "./BaseRepository.js";
import { customServiceLogger } from "../utils/logger.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";
import { getCurrentTenantId } from "../db/tenantContext.js";

// =============================================================================
// Entity Types
// =============================================================================

export type HoldMoneyStatus = "held" | "collected";

export interface HoldMoneyEntity {
  id: number;
  client_name: string;
  phone_number: string | null;
  usd_amount: number;
  lbp_amount: number;
  status: HoldMoneyStatus;
  notes: string | null;
  created_by: number | null;
  collected_by: number | null;
  collected_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateHoldMoneyInput {
  client_name: string;
  phone_number?: string;
  usd_amount?: number;
  lbp_amount?: number;
  notes?: string;
  transaction_time?: string;
}

export interface HoldMoneyResult {
  success: boolean;
  id?: number;
  error?: string;
}

const GENERAL_DRAWER = "General";
/** Category slug used for the Service History row written when a hold is collected. */
const HOLD_MONEY_CATEGORY = "hold_money";

// =============================================================================
// Hold Money Repository Class
// =============================================================================

export class HoldMoneyRepository extends BaseRepository<HoldMoneyEntity> {
  constructor() {
    super("hold_money", { softDelete: false });
  }

  protected getColumns(): string {
    return "id, client_name, phone_number, usd_amount, lbp_amount, status, notes, created_by, collected_by, collected_at, created_at, updated_at";
  }

  /**
   * Create a hold: record the held cash and credit the General drawer.
   * Runs inside a single DB transaction.
   */
  createHold(
    data: CreateHoldMoneyInput,
    createdBy: number = 1,
  ): HoldMoneyResult {
    try {
      const usd = Math.abs(data.usd_amount ?? 0);
      const lbp = Math.abs(data.lbp_amount ?? 0);

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
      const noteText = `Hold Money: ${clientName}`;

      const result = this.db.transaction(() => {
        // 1. Insert the hold record
        const insertHold = this.db.prepare(`
          INSERT INTO hold_money (
            client_name, phone_number, usd_amount, lbp_amount, status, notes, created_by, tenant_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'held', ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)
        `);
        const holdResult = insertHold.run(
          clientName,
          phone,
          usd,
          lbp,
          data.notes ?? null,
          createdBy,
          getCurrentTenantId(),
          data.transaction_time ?? null,
        );
        const holdId = Number(holdResult.lastInsertRowid);

        // 2. Unified transaction row (cash in, no profit)
        const txnId = getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.HOLD_MONEY,
          source_table: "hold_money",
          source_id: holdId,
          user_id: createdBy,
          amount_usd: usd,
          amount_lbp: lbp,
          profit_usd: 0,
          profit_lbp: 0,
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

        // 3. Cash in → General drawer (one leg per currency)
        this.postLegs(txnId, usd, lbp, 1, `${noteText} (held)`, createdBy);

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
   * Collect (return) a held amount: debit the General drawer and mark the
   * hold as collected. Idempotent guard: only a `held` record can be collected.
   */
  collectHold(
    id: number,
    collectedBy: number = 1,
  ): { success: boolean; error?: string } {
    try {
      this.db.transaction(() => {
        const hold = this.getById(id);
        if (!hold) throw new Error("Hold not found");
        if (hold.status !== "held") {
          throw new Error("Hold has already been collected");
        }

        const usd = Math.abs(hold.usd_amount);
        const lbp = Math.abs(hold.lbp_amount);
        const noteText = `Hold Collected: ${hold.client_name}`;

        // 1. Unified transaction row (cash out, no profit)
        const txnId = getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.HOLD_MONEY_COLLECT,
          source_table: "hold_money",
          source_id: id,
          user_id: collectedBy,
          amount_usd: usd,
          amount_lbp: lbp,
          profit_usd: 0,
          profit_lbp: 0,
          // Surface the customer in the Transactions/Audit viewer (rule 11).
          client_name: hold.client_name,
          client_phone: hold.phone_number,
          summary: noteText,
          metadata_json: {
            client_name: hold.client_name,
            phone_number: hold.phone_number,
            usd_amount: usd,
            lbp_amount: lbp,
            kind: "collect",
          },
        });

        // 2. Cash out ← General drawer (one leg per currency)
        this.postLegs(
          txnId,
          usd,
          lbp,
          -1,
          `${noteText} (returned)`,
          collectedBy,
        );

        // 3. Mark collected
        const tenantId = getCurrentTenantId();
        this.db
          .prepare(
            `UPDATE hold_money
             SET status = 'collected', collected_by = ?, collected_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND tenant_id = ?`,
          )
          .run(collectedBy, id, tenantId);

        // 4. Record the completed hold→collect as a Service History row so it
        // shows in the Services "History" table. Values are pulled from THIS
        // hold record (client/phone in real columns, amounts derived live, note
        // links back to hold #id) — never hardcoded. cost/price/profit stay 0
        // (a hold is not revenue) and no extra drawer/transaction legs are
        // booked here (those were posted above).
        const amountParts: string[] = [];
        if (usd > 0) amountParts.push(`$${usd.toFixed(2)}`);
        if (lbp > 0) amountParts.push(`${lbp.toLocaleString("en-US")} LBP`);
        const historyDesc = `Hold & collect money for ${hold.client_name} — ${amountParts.join(" + ")}`;
        this.db
          .prepare(
            `INSERT INTO custom_services (
               description, cost_usd, cost_lbp, price_usd, price_lbp,
               paid_by, status, client_id, client_name, phone_number, note, category, created_by, tenant_id, created_at
             ) VALUES (?, 0, 0, 0, 0, 'CASH', 'completed', NULL, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          )
          .run(
            historyDesc,
            hold.client_name,
            hold.phone_number,
            `Hold #${id}`,
            HOLD_MONEY_CATEGORY,
            collectedBy,
            tenantId,
          );
      })();

      customServiceLogger.info({ id }, `Hold money collected: #${id}`);
      return { success: true };
    } catch (error) {
      customServiceLogger.error({ error, id }, "Failed to collect hold money");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Active (uncollected) holds, newest first.
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
   * Post General-drawer payment legs + balance updates for both currencies.
   * `sign` is +1 for cash in (hold) or -1 for cash out (collect).
   */
  private postLegs(
    txnId: number,
    usd: number,
    lbp: number,
    sign: 1 | -1,
    note: string,
    userId: number,
  ): void {
    const tenantId = getCurrentTenantId();
    const insertPayment = this.db.prepare(`
      INSERT INTO payments (
        transaction_id, method, drawer_name, currency_code, amount, note, created_by, tenant_id
      ) VALUES (?, 'CASH', ?, ?, ?, ?, ?, ?)
    `);
    const upsertBalance = this.db.prepare(`
      INSERT INTO drawer_balances (drawer_name, currency_code, balance, tenant_id)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(tenant_id, drawer_name, currency_code) DO UPDATE SET
        balance = drawer_balances.balance + excluded.balance,
        updated_at = CURRENT_TIMESTAMP
    `);

    if (usd > 0) {
      insertPayment.run(
        txnId,
        GENERAL_DRAWER,
        "USD",
        sign * usd,
        note,
        userId,
        tenantId,
      );
      upsertBalance.run(GENERAL_DRAWER, "USD", sign * usd, tenantId);
    }
    if (lbp > 0) {
      insertPayment.run(
        txnId,
        GENERAL_DRAWER,
        "LBP",
        sign * lbp,
        note,
        userId,
        tenantId,
      );
      upsertBalance.run(GENERAL_DRAWER, "LBP", sign * lbp, tenantId);
    }
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
