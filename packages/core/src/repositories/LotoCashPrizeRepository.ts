/**
 * Loto Cash Prize Repository
 *
 * Handles all database operations for the loto_cash_prizes table.
 */

import type Database from "better-sqlite3";
import { getDatabase } from "../db/connection.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";
import {
  isDrawerAffectingMethod,
  paymentMethodToDrawerName,
} from "../utils/payments.js";

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
}

export class LotoCashPrizeRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  createCashPrize(data: LotoCashPrizeCreate): LotoCashPrize {
    const createInTxn = this.db.transaction(() => {
      // 1. Insert the cash prize record
      const stmt = this.db.prepare(`
        INSERT INTO loto_cash_prizes (
          ticket_number, prize_amount, prize_date
        ) VALUES (?, ?, ?)
      `);

      const result = stmt.run(
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
        exchange_rate: 100000,
        summary: data.ticket_number
          ? `Loto cash prize payout: ${data.ticket_number}`
          : "Loto cash prize payout",
        metadata_json: {
          ticket_number: data.ticket_number || null,
        },
      });

      // 3. Record payment and update drawer balance (money OUT = negative)
      const paymentMethod = "CASH";
      const drawerName = "General";
      const currency = "LBP";

      const insertPayment = this.db.prepare(`
        INSERT INTO payments (
          transaction_id, method, drawer_name, currency_code, amount, note, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      insertPayment.run(
        txnId,
        paymentMethod,
        drawerName,
        currency,
        -data.prize_amount,
        data.ticket_number
          ? `Loto cash prize: ${data.ticket_number}`
          : "Loto cash prize",
        data.userId,
      );

      const upsertBalance = this.db.prepare(`
        INSERT INTO drawer_balances (drawer_name, currency_code, balance)
        VALUES (?, ?, ?)
        ON CONFLICT(drawer_name, currency_code) DO UPDATE SET
          balance = drawer_balances.balance + excluded.balance,
          updated_at = CURRENT_TIMESTAMP
      `);
      upsertBalance.run(drawerName, currency, -data.prize_amount);

      // 4. Create supplier ledger entry (LOTO owes us this amount - reimbursable)
      const insertLedger = this.db.prepare(`
        INSERT INTO supplier_ledger (
          supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, transaction_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      // Get or create LOTO supplier
      let supplierStmt = this.db.prepare(
        `SELECT id FROM suppliers WHERE provider = 'LOTO' LIMIT 1`,
      );
      let supplier = supplierStmt.get() as { id: number } | undefined;

      if (!supplier) {
        const createSupplier = this.db.prepare(`
          INSERT INTO suppliers (name, provider, is_active, is_system)
          VALUES (?, ?, 1, 1)
        `);
        const result = createSupplier.run("Loto Liban", "LOTO");
        supplier = { id: result.lastInsertRowid as number };
      }

      const supplierId = supplier.id;

      // Positive amount = asset (they owe us / receivable)
      insertLedger.run(
        supplierId,
        "CASH_PRIZE",
        0,
        data.prize_amount,
        data.ticket_number
          ? `Cash prize payout: LOTO owes us ${data.prize_amount} LBP (ticket: ${data.ticket_number})`
          : `Cash prize payout: LOTO owes us ${data.prize_amount} LBP`,
        data.userId,
        txnId,
      );

      return prize;
    });

    return createInTxn();
  }

  getCashPrizeById(id: number): LotoCashPrize | null {
    const stmt = this.db.prepare(`
      SELECT * FROM loto_cash_prizes WHERE id = ?
    `);
    return stmt.get(id) as LotoCashPrize | null;
  }

  getCashPrizesByDateRange(from: string, to: string): LotoCashPrize[] {
    const stmt = this.db.prepare(`
      SELECT * FROM loto_cash_prizes 
      WHERE date(prize_date) BETWEEN date(?) AND date(?)
      ORDER BY prize_date DESC, id DESC
    `);
    return stmt.all(from, to) as LotoCashPrize[];
  }

  getUnreimbursedCashPrizes(): LotoCashPrize[] {
    const stmt = this.db.prepare(`
      SELECT * FROM loto_cash_prizes 
      WHERE is_reimbursed = 0
      ORDER BY prize_date DESC
    `);
    return stmt.all() as LotoCashPrize[];
  }

  markCashPrizeReimbursed(
    id: number,
    reimbursedDate?: string,
    settlementId?: number,
  ): LotoCashPrize | null {
    const stmt = this.db.prepare(`
      UPDATE loto_cash_prizes 
      SET is_reimbursed = 1, reimbursed_date = ?, reimbursed_in_settlement_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    const date = reimbursedDate || new Date().toISOString();
    stmt.run(date, settlementId || null, id);
    return this.getCashPrizeById(id);
  }

  getTotalCashPrizes(from: string, to: string): number {
    const stmt = this.db.prepare(`
      SELECT COALESCE(SUM(prize_amount), 0) as total FROM loto_cash_prizes
      WHERE date(prize_date) BETWEEN date(?) AND date(?)
    `);
    const result = stmt.get(from, to) as { total: number };
    return result.total;
  }

  getTotalUnreimbursedCashPrizes(): number {
    const stmt = this.db.prepare(`
      SELECT COALESCE(SUM(prize_amount), 0) as total FROM loto_cash_prizes
      WHERE is_reimbursed = 0
    `);
    const result = stmt.get() as { total: number };
    return result.total;
  }

  /**
   * Assign a cash prize to a checkpoint
   */
  assignToCheckpoint(prizeId: number, checkpointId: number): void {
    const stmt = this.db.prepare(`
      UPDATE loto_cash_prizes 
      SET checkpoint_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    stmt.run(checkpointId, prizeId);
  }

  /**
   * Unlink all cash prizes from a checkpoint (set checkpoint_id = NULL)
   */
  unlinkFromCheckpoint(checkpointId: number): number {
    const stmt = this.db.prepare(`
      UPDATE loto_cash_prizes 
      SET checkpoint_id = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE checkpoint_id = ?
    `);
    const result = stmt.run(checkpointId);
    return result.changes;
  }

  /**
   * Get all cash prizes linked to a checkpoint
   */
  getByCheckpointId(checkpointId: number): LotoCashPrize[] {
    const stmt = this.db.prepare(`
      SELECT * FROM loto_cash_prizes WHERE checkpoint_id = ? ORDER BY prize_date DESC
    `);
    return stmt.all(checkpointId) as LotoCashPrize[];
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
      ORDER BY prize_date DESC
    `);
    return stmt.all(from, to) as LotoCashPrize[];
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
      ORDER BY prize_date DESC
    `);
    return stmt.all() as LotoCashPrize[];
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
