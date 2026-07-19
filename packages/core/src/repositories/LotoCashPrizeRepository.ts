/**
 * Loto Cash Prize Repository
 *
 * Handles all database operations for the loto_cash_prizes table.
 */

import type Database from "better-sqlite3";
import { getDatabase } from "../db/connection.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { getSupplierRepository } from "./SupplierRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";
import {
  isDrawerAffectingMethod,
  paymentMethodToDrawerName,
} from "../utils/payments.js";
import { applyDrawerDelta, insertPaymentRow } from "./moneyPosting.js";

export interface LotoCashPrize {
  id: number;
  ticket_number: string | null;
  prize_amount: number;
  customer_name: string | null;
  prize_date: string;
  is_reimbursed: number;
  reimbursed_date: string | null;
  reimbursed_in_settlement_id: number | null;
  checkpoint_id: number | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface LotoCashPrizeCreate {
  ticket_number?: string;
  prize_amount: number;
  prize_date: string;
  userId: number;
  /**
   * Session-basket deferred payment mode. When true, the prize record + unified
   * transaction + supplier ledger are created but the customer cash-OUT payout
   * (General −prize_amount) is skipped — the basket recorder owns the net cash
   * to the customer. Non-session callers leave this falsy → behavior unchanged.
   */
  deferPayment?: boolean;
  /** Operator-edited USD↔LBP rate of record (session checkout); else default. */
  exchange_rate?: number;
}

export class LotoCashPrizeRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  createCashPrize(data: LotoCashPrizeCreate): LotoCashPrize {
    const tenantId = getCurrentTenantId();
    const createInTxn = this.db.transaction(() => {
      // 1. Insert the cash prize record
      const stmt = this.db.prepare(`
        INSERT INTO loto_cash_prizes (
          tenant_id, ticket_number, prize_amount, prize_date
        ) VALUES (?, ?, ?, ?)
      `);

      const result = stmt.run(
        tenantId,
        data.ticket_number || null,
        data.prize_amount,
        data.prize_date,
      );

      const prizeId = result.lastInsertRowid as number;
      const prize = this.getCashPrizeById(prizeId)!;

      // 2. Create unified transaction record (money OUT = negative amount)
      const txnRepo = getTransactionRepository();
      const txnId = txnRepo.createTransaction({
        type: TRANSACTION_TYPES.LOTO_CASH_PRIZE,
        source_table: "loto_cash_prizes",
        source_id: prizeId,
        user_id: data.userId,
        amount_usd: 0,
        amount_lbp: -data.prize_amount,
        exchange_rate: data.exchange_rate ?? 100000,
        summary: data.ticket_number
          ? `Loto cash prize payout: ${data.ticket_number}`
          : "Loto cash prize payout",
        metadata_json: {
          ticket_number: data.ticket_number || null,
        },
      });

      // 3. Record payment and update drawer balance (money OUT = negative).
      // Deferred (session basket): the prize is a NEGATIVE-LBP cart item, so the
      // checkout modal already nets it into the basket total and emits the net
      // cash-OUT leg the basket recorder posts. Skip the General payout here to
      // avoid double-counting it. Non-session callers post it normally.
      const currency = "LBP";
      if (!data.deferPayment) {
        const paymentMethod = "CASH";
        const drawerName = "General";

        insertPaymentRow(this.db, {
          transactionId: txnId,
          method: paymentMethod,
          drawerName,
          currencyCode: currency,
          amount: -data.prize_amount,
          note: data.ticket_number
            ? `Loto cash prize: ${data.ticket_number}`
            : "Loto cash prize",
          createdBy: data.userId,
          tenantId,
        });

        applyDrawerDelta(this.db, {
          drawerName,
          currencyCode: currency,
          delta: -data.prize_amount,
          tenantId,
        });
      }

      // 4. Create supplier ledger entry (LOTO owes us this amount - reimbursable)

      // Get or create LOTO supplier
      let supplierStmt = this.db.prepare(
        `SELECT id FROM suppliers WHERE tenant_id = ? AND provider = 'LOTO' LIMIT 1`,
      );
      let supplier = supplierStmt.get(tenantId) as { id: number } | undefined;

      if (!supplier) {
        const createSupplier = this.db.prepare(`
          INSERT INTO suppliers (tenant_id, name, provider, is_active, is_system)
          VALUES (?, ?, ?, 1, 1)
        `);
        const result = createSupplier.run(tenantId, "Loto Liban", "LOTO");
        supplier = { id: result.lastInsertRowid as number };
      }

      const supplierId = supplier.id;

      // Negative amount = LOTO owes us / reduces what we owe (standard
      // supplier convention: the Suppliers page reads <0 as "They owe you").
      //
      // CQ-7: routed through addLedgerEntry's link-mode instead of a raw
      // INSERT — same entry_type/amounts/note/is_auto(=0)/transaction_id
      // link as before.
      getSupplierRepository().addLedgerEntry({
        supplier_id: supplierId,
        entry_type: "CASH_PRIZE",
        amount_usd: 0,
        amount_lbp: -data.prize_amount,
        note: data.ticket_number
          ? `Cash prize payout: LOTO owes us ${data.prize_amount} LBP (ticket: ${data.ticket_number})`
          : `Cash prize payout: LOTO owes us ${data.prize_amount} LBP`,
        created_by: data.userId,
        transaction_id: txnId,
      });

      return prize;
    });

    return createInTxn();
  }

  getCashPrizeById(id: number): LotoCashPrize | null {
    const stmt = this.db.prepare(`
      SELECT * FROM loto_cash_prizes WHERE id = ? AND tenant_id = ?
    `);
    return stmt.get(id, getCurrentTenantId()) as LotoCashPrize | null;
  }

  getCashPrizesByDateRange(from: string, to: string): LotoCashPrize[] {
    const stmt = this.db.prepare(`
      SELECT * FROM loto_cash_prizes
      WHERE date(prize_date) BETWEEN date(?) AND date(?) AND tenant_id = ?
      ORDER BY prize_date DESC, id DESC
    `);
    return stmt.all(from, to, getCurrentTenantId()) as LotoCashPrize[];
  }

  getUnreimbursedCashPrizes(): LotoCashPrize[] {
    const stmt = this.db.prepare(`
      SELECT * FROM loto_cash_prizes
      WHERE is_reimbursed = 0 AND tenant_id = ?
      ORDER BY prize_date DESC
    `);
    return stmt.all(getCurrentTenantId()) as LotoCashPrize[];
  }

  markCashPrizeReimbursed(
    id: number,
    reimbursedDate?: string,
    settlementId?: number,
  ): LotoCashPrize | null {
    const stmt = this.db.prepare(`
      UPDATE loto_cash_prizes
      SET is_reimbursed = 1, reimbursed_date = ?, reimbursed_in_settlement_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND tenant_id = ?
    `);

    const date = reimbursedDate || new Date().toISOString();
    stmt.run(date, settlementId || null, id, getCurrentTenantId());
    return this.getCashPrizeById(id);
  }

  getTotalCashPrizes(from: string, to: string): number {
    const stmt = this.db.prepare(`
      SELECT COALESCE(SUM(prize_amount), 0) as total FROM loto_cash_prizes
      WHERE date(prize_date) BETWEEN date(?) AND date(?) AND tenant_id = ?
    `);
    const result = stmt.get(from, to, getCurrentTenantId()) as {
      total: number;
    };
    return result.total;
  }

  getTotalUnreimbursedCashPrizes(): number {
    const stmt = this.db.prepare(`
      SELECT COALESCE(SUM(prize_amount), 0) as total FROM loto_cash_prizes
      WHERE is_reimbursed = 0 AND tenant_id = ?
    `);
    const result = stmt.get(getCurrentTenantId()) as { total: number };
    return result.total;
  }

  /**
   * Assign a cash prize to a checkpoint
   */
  assignToCheckpoint(prizeId: number, checkpointId: number): void {
    const stmt = this.db.prepare(`
      UPDATE loto_cash_prizes
      SET checkpoint_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND tenant_id = ?
    `);
    stmt.run(checkpointId, prizeId, getCurrentTenantId());
  }

  /**
   * Unlink all cash prizes from a checkpoint (set checkpoint_id = NULL)
   */
  unlinkFromCheckpoint(checkpointId: number): number {
    const stmt = this.db.prepare(`
      UPDATE loto_cash_prizes
      SET checkpoint_id = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE checkpoint_id = ? AND tenant_id = ?
    `);
    const result = stmt.run(checkpointId, getCurrentTenantId());
    return result.changes;
  }

  /**
   * Get all cash prizes linked to a checkpoint
   */
  getByCheckpointId(checkpointId: number): LotoCashPrize[] {
    const stmt = this.db.prepare(`
      SELECT * FROM loto_cash_prizes WHERE checkpoint_id = ? AND tenant_id = ? ORDER BY prize_date DESC
    `);
    return stmt.all(checkpointId, getCurrentTenantId()) as LotoCashPrize[];
  }

  /**
   * Get unreimbursed cash prizes in a date range that have no checkpoint yet
   */
  getUnassignedByDateRange(from: string, to: string): LotoCashPrize[] {
    const stmt = this.db.prepare(`
      SELECT * FROM loto_cash_prizes
      WHERE checkpoint_id IS NULL
        AND is_reimbursed = 0
        AND date(prize_date) BETWEEN date(?) AND date(?)
        AND tenant_id = ?
      ORDER BY prize_date DESC
    `);
    return stmt.all(from, to, getCurrentTenantId()) as LotoCashPrize[];
  }

  /**
   * Get all unreimbursed cash prizes that have no checkpoint yet (no date filter).
   * This avoids the inverted date-range bug when two checkpoints happen on the same day.
   */
  getUnassigned(): LotoCashPrize[] {
    const stmt = this.db.prepare(`
      SELECT * FROM loto_cash_prizes
      WHERE checkpoint_id IS NULL
        AND is_reimbursed = 0
        AND tenant_id = ?
      ORDER BY prize_date DESC
    `);
    return stmt.all(getCurrentTenantId()) as LotoCashPrize[];
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let instance: LotoCashPrizeRepository | null = null;

export function getLotoCashPrizeRepository(): LotoCashPrizeRepository {
  if (!instance) {
    instance = new LotoCashPrizeRepository(getDatabase());
  }
  return instance;
}

/** Reset the singleton (for testing) */
export function resetLotoCashPrizeRepository(): void {
  instance = null;
}

export default LotoCashPrizeRepository;
