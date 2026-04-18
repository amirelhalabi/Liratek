/**
 * Loto Checkpoint Repository
 *
 * Handles all database operations for loto_checkpoints and loto_settlements tables.
 * These stay together because settleCheckpoint() writes to both tables in one transaction.
 */

import type Database from "better-sqlite3";
import { getDatabase } from "../db/connection.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";
import {
  isDrawerAffectingMethod,
  paymentMethodToDrawerName,
} from "../utils/payments.js";

export interface LotoCheckpoint {
  id: number;
  checkpoint_date: string;
  period_start: string;
  period_end: string;
  total_sales: number;
  total_commission: number;
  total_tickets: number;
  total_prizes: number;
  total_cash_prizes: number;
  total_cash_prizes_count: number;
  is_settled: number;
  settled_at: string | null;
  settlement_id: number | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface LotoCheckpointCreate {
  checkpoint_date: string;
  period_start: string;
  period_end: string;
  total_sales?: number;
  total_commission?: number;
  total_tickets?: number;
  total_prizes?: number;
  total_cash_prizes?: number;
  total_cash_prizes_count?: number;
  note?: string;
}

export interface LotoCheckpointUpdate {
  checkpoint_date?: string;
  period_start?: string;
  period_end?: string;
  total_sales?: number;
  total_commission?: number;
  total_tickets?: number;
  total_prizes?: number;
  is_settled?: number;
  settled_at?: string;
  settlement_id?: number;
  note?: string;
}

export interface LotoSettlement {
  id: number;
  settlement_date: string;
  checkpoint_ids: string; // JSON array
  total_sales: number;
  total_commission: number;
  total_cash_prizes: number;
  net_settlement: number;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export class LotoCheckpointRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  createCheckpoint(data: LotoCheckpointCreate): LotoCheckpoint {
    const stmt = this.db.prepare(`
      INSERT INTO loto_checkpoints (
        checkpoint_date, period_start, period_end, 
        total_sales, total_commission, total_tickets, total_prizes,
        total_cash_prizes, total_cash_prizes_count, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      data.checkpoint_date,
      data.period_start,
      data.period_end,
      data.total_sales ?? 0,
      data.total_commission ?? 0,
      data.total_tickets ?? 0,
      data.total_prizes ?? 0,
      data.total_cash_prizes ?? 0,
      data.total_cash_prizes_count ?? 0,
      data.note || null,
    );

    return this.getCheckpointById(result.lastInsertRowid as number)!;
  }

  getCheckpointById(id: number): LotoCheckpoint | null {
    const stmt = this.db.prepare(`
      SELECT * FROM loto_checkpoints WHERE id = ?
    `);
    return stmt.get(id) as LotoCheckpoint | null;
  }

  getCheckpointByDate(date: string): LotoCheckpoint | null {
    const stmt = this.db.prepare(`
      SELECT * FROM loto_checkpoints WHERE date(checkpoint_date) = date(?)
      ORDER BY checkpoint_date DESC
      LIMIT 1
    `);
    return stmt.get(date) as LotoCheckpoint | null;
  }

  getCheckpointsByDateRange(from: string, to: string): LotoCheckpoint[] {
    const stmt = this.db.prepare(`
      SELECT * FROM loto_checkpoints 
      WHERE date(checkpoint_date) BETWEEN date(?) AND date(?)
      ORDER BY checkpoint_date DESC
    `);
    return stmt.all(from, to) as LotoCheckpoint[];
  }

  getUnsettledCheckpoints(): LotoCheckpoint[] {
    const stmt = this.db.prepare(`
      SELECT * FROM loto_checkpoints 
      WHERE is_settled = 0
      ORDER BY checkpoint_date DESC
    `);
    return stmt.all() as LotoCheckpoint[];
  }

  updateCheckpoint(
    id: number,
    data: LotoCheckpointUpdate,
  ): LotoCheckpoint | null {
    const fields: string[] = [];
    const values: (string | number | null)[] = [];

    if (data.checkpoint_date !== undefined) {
      fields.push("checkpoint_date = ?");
      values.push(data.checkpoint_date);
    }
    if (data.period_start !== undefined) {
      fields.push("period_start = ?");
      values.push(data.period_start);
    }
    if (data.period_end !== undefined) {
      fields.push("period_end = ?");
      values.push(data.period_end);
    }
    if (data.total_sales !== undefined) {
      fields.push("total_sales = ?");
      values.push(data.total_sales);
    }
    if (data.total_commission !== undefined) {
      fields.push("total_commission = ?");
      values.push(data.total_commission);
    }
    if (data.total_tickets !== undefined) {
      fields.push("total_tickets = ?");
      values.push(data.total_tickets);
    }
    if (data.total_prizes !== undefined) {
      fields.push("total_prizes = ?");
      values.push(data.total_prizes);
    }
    if (data.is_settled !== undefined) {
      fields.push("is_settled = ?");
      values.push(data.is_settled);
    }
    if (data.settled_at !== undefined) {
      fields.push("settled_at = ?");
      values.push(data.settled_at);
    }
    if (data.settlement_id !== undefined) {
      fields.push("settlement_id = ?");
      values.push(data.settlement_id);
    }
    if (data.note !== undefined) {
      fields.push("note = ?");
      values.push(data.note);
    }

    if (fields.length === 0) {
      return this.getCheckpointById(id);
    }

    fields.push("updated_at = CURRENT_TIMESTAMP");
    values.push(id);

    const stmt = this.db.prepare(`
      UPDATE loto_checkpoints SET ${fields.join(", ")} WHERE id = ?
    `);

    stmt.run(...values);
    return this.getCheckpointById(id);
  }

  markCheckpointAsSettled(
    id: number,
    settledAt?: string,
    settlementId?: number,
  ): LotoCheckpoint | null {
    const stmt = this.db.prepare(`
      UPDATE loto_checkpoints 
      SET is_settled = 1, settled_at = ?, settlement_id = ?
      WHERE id = ?
    `);

    const settledDate = settledAt || new Date().toISOString();
    stmt.run(settledDate, settlementId || null, id);
    return this.getCheckpointById(id);
  }

  /**
   * Settle a checkpoint with full accounting:
   * 1. Create SETTLEMENT entry in supplier_ledger
   * 2. Credit commission to General drawer
   * 3. Handle net payment (either we pay LOTO or they pay us)
   * 4. Mark linked cash prizes as reimbursed
   * 5. Mark checkpoint as settled
   */
  settleCheckpoint(
    id: number,
    totalSales: number,
    totalCommission: number,
    totalPrizes: number,
    _totalCashPrizes: number, // DEPRECATED — read from checkpoint instead
    settledAt: string | undefined,
    userId: number,
    payments?: Array<{ method: string; currency_code: string; amount: number }>,
  ): LotoCheckpoint {
    const settleInTxn = this.db.transaction(() => {
      const settledDate = settledAt || new Date().toISOString();

      // Read cash prizes from the checkpoint itself (authoritative source)
      const checkpoint = this.getCheckpointById(id);
      if (!checkpoint) throw new Error(`Checkpoint ${id} not found`);
      const totalCashPrizes = checkpoint.total_cash_prizes;

      // Calculate settlement amounts
      const shopPaysSupplier = totalSales;
      const supplierPaysShop = totalCommission + totalCashPrizes;
      const netSettlement = supplierPaysShop - shopPaysSupplier;

      // Get LOTO supplier ID
      const supplierStmt = this.db.prepare(
        `SELECT id FROM suppliers WHERE provider = 'LOTO' LIMIT 1`,
      );
      const supplier = supplierStmt.get() as { id: number } | undefined;
      const supplierId = supplier?.id || 1;

      // 1. Create unified transaction for settlement
      const txnRepo = getTransactionRepository();
      const txnId = txnRepo.createTransaction({
        type: TRANSACTION_TYPES.LOTO_SETTLEMENT,
        source_table: "loto_checkpoints",
        source_id: id,
        user_id: userId,
        amount_usd: 0,
        amount_lbp: netSettlement,
        exchange_rate: 100000,
        summary: `Loto settlement for checkpoint #${id}`,
        metadata_json: {
          total_sales: totalSales,
          total_commission: totalCommission,
          total_prizes: totalPrizes,
          total_cash_prizes: totalCashPrizes,
          shop_pays_supplier: shopPaysSupplier,
          supplier_pays_shop: supplierPaysShop,
          net_settlement: netSettlement,
        },
      });

      // 2. Create loto_settlements record
      const insertSettlement = this.db.prepare(`
        INSERT INTO loto_settlements (
          settlement_date, checkpoint_ids, total_sales, total_commission,
          total_cash_prizes, net_settlement, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      const settlementNote = `Settled: sales=${totalSales}, commission=${totalCommission}, prizes=${totalCashPrizes}`;
      const checkpointIdsJson = JSON.stringify([id]);

      const settlementResult = insertSettlement.run(
        settledDate,
        checkpointIdsJson,
        totalSales,
        totalCommission,
        totalCashPrizes,
        netSettlement,
        settlementNote,
      );

      const settlementId = settlementResult.lastInsertRowid as number;

      // 3. Create SETTLEMENT entry in supplier_ledger
      const insertLedger = this.db.prepare(`
        INSERT INTO supplier_ledger (
          supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, transaction_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      insertLedger.run(
        supplierId,
        "SETTLEMENT",
        0,
        netSettlement,
        `Settlement for checkpoint #${id}: ${settlementNote}`,
        userId,
        null,
      );

      // 4. Credit commission to General drawer
      const upsertBalance = this.db.prepare(`
        INSERT INTO drawer_balances (drawer_name, currency_code, balance)
        VALUES (?, ?, ?)
        ON CONFLICT(drawer_name, currency_code) DO UPDATE SET
          balance = drawer_balances.balance + excluded.balance,
          updated_at = CURRENT_TIMESTAMP
      `);

      if (totalCommission > 0) {
        upsertBalance.run("General", "LBP", totalCommission);
      }

      // 5. Record payment legs and update drawer balances
      if (payments && payments.length > 0) {
        const insertPayment = this.db.prepare(`
          INSERT INTO payments (transaction_id, method, drawer_name, currency_code, amount, note, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const p of payments) {
          if (!isDrawerAffectingMethod(p.method)) continue;
          const drawerName = paymentMethodToDrawerName(p.method);
          insertPayment.run(
            txnId,
            p.method,
            drawerName,
            p.currency_code,
            p.amount,
            `Loto settlement #${id}`,
            userId,
          );
          upsertBalance.run(drawerName, p.currency_code, p.amount);
        }
      }

      // 6. Mark linked cash prizes as reimbursed
      const markReimbursed = this.db.prepare(`
        UPDATE loto_cash_prizes 
        SET is_reimbursed = 1, reimbursed_date = ?, reimbursed_in_settlement_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE checkpoint_id = ? AND is_reimbursed = 0
      `);
      markReimbursed.run(settledDate, settlementId, id);

      // 7. Mark checkpoint as settled
      const updateCheckpoint = this.db.prepare(`
        UPDATE loto_checkpoints 
        SET is_settled = 1, settled_at = ?, settlement_id = ?
        WHERE id = ?
      `);
      updateCheckpoint.run(settledDate, settlementId, id);

      return this.getCheckpointById(id)!;
    });

    return settleInTxn();
  }

  getTotalSalesFromUnsettledCheckpoints(): number {
    const stmt = this.db.prepare(`
      SELECT COALESCE(SUM(total_sales), 0) as total FROM loto_checkpoints
      WHERE is_settled = 0
    `);
    const result = stmt.get() as { total: number };
    return result.total;
  }

  getTotalCommissionFromUnsettledCheckpoints(): number {
    const stmt = this.db.prepare(`
      SELECT COALESCE(SUM(total_commission), 0) as total FROM loto_checkpoints
      WHERE is_settled = 0
    `);
    const result = stmt.get() as { total: number };
    return result.total;
  }

  getLastCheckpoint(): LotoCheckpoint | null {
    const stmt = this.db.prepare(`
      SELECT * FROM loto_checkpoints 
      ORDER BY checkpoint_date DESC
      LIMIT 1
    `);
    return stmt.get() as LotoCheckpoint | null;
  }

  /**
   * Delete an unsettled checkpoint. Settled checkpoints cannot be deleted.
   * Returns true if deleted, false if not found or already settled.
   */
  deleteCheckpoint(id: number): boolean {
    const stmt = this.db.prepare(`
      DELETE FROM loto_checkpoints WHERE id = ? AND is_settled = 0
    `);
    const result = stmt.run(id);
    return result.changes > 0;
  }

  getSettlementHistory(limit?: number): LotoSettlement[] {
    const limitClause = limit ? `LIMIT ${limit}` : "";
    const stmt = this.db.prepare(`
      SELECT * FROM loto_settlements 
      ORDER BY settlement_date DESC, id DESC
      ${limitClause}
    `);
    return stmt.all() as LotoSettlement[];
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let instance: LotoCheckpointRepository | null = null;

export function getLotoCheckpointRepository(): LotoCheckpointRepository {
  if (!instance) {
    instance = new LotoCheckpointRepository(getDatabase());
  }
  return instance;
}

/** Reset the singleton (for testing) */
export function resetLotoCheckpointRepository(): void {
  instance = null;
}

export default LotoCheckpointRepository;
