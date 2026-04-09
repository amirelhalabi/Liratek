/**
 * Loto Repository
 *
 * Handles all database operations for the Loto module.
 */

import type Database from "better-sqlite3";
import logger from "../utils/logger.js";
import { getDatabase } from "../db/connection.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";
import {
  isDrawerAffectingMethod,
  paymentMethodToDrawerName,
} from "../utils/payments.js";

export interface LotoTicket {
  id: number;
  ticket_number: string | null;
  sale_amount: number;
  commission_rate: number;
  commission_amount: number;
  is_winner: number;
  prize_amount: number;
  prize_paid_date: string | null;
  sale_date: string;
  payment_method: string | null;
  currency: string;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface LotoTicketCreate {
  ticket_number?: string;
  sale_amount: number;
  commission_rate?: number;
  commission_amount: number;
  is_winner?: number;
  prize_amount?: number;
  sale_date: string;
  payment_method?: string;
  currency?: string;
  note?: string;
}

export interface LotoTicketUpdate {
  ticket_number?: string;
  sale_amount?: number;
  commission_rate?: number;
  commission_amount?: number;
  is_winner?: number;
  prize_amount?: number;
  prize_paid_date?: string;
  payment_method?: string;
  currency?: string;
  note?: string;
}

export interface LotoMonthlyFee {
  id: number;
  fee_amount: number;
  fee_month: string;
  fee_year: number;
  recorded_date: string;
  is_paid: number;
  paid_date: string | null;
  note: string | null;
  created_at: string;
}

export interface LotoMonthlyFeeCreate {
  fee_amount: number;
  fee_month: string;
  fee_year: number;
  recorded_date: string;
  is_paid?: number;
  paid_date?: string;
  note?: string;
}

export interface LotoSetting {
  key_name: string;
  value: string;
  description: string | null;
  updated_at: string;
}

export interface LotoReportData {
  total_tickets: number;
  total_sales: number;
  total_commission: number;
  total_prizes: number;
  outstanding_prizes: number;
  total_fees: number;
}

export interface LotoCheckpoint {
  id: number;
  checkpoint_date: string;
  period_start: string;
  period_end: string;
  total_sales: number;
  total_commission: number;
  total_tickets: number;
  total_prizes: number;
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

export interface LotoCashPrize {
  id: number;
  ticket_number: string | null;
  prize_amount: number;
  customer_name: string | null;
  prize_date: string;
  is_reimbursed: number;
  reimbursed_date: string | null;
  reimbursed_in_settlement_id: number | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface LotoCashPrizeCreate {
  ticket_number: string;
  prize_amount: number;
  prize_date: string;
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

export class LotoRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  // ===========================================================================
  // Tickets
  // ===========================================================================

  createTicket(data: LotoTicketCreate): LotoTicket {
    // Wrap in a transaction to ensure all operations succeed or fail together
    const createInTxn = this.db.transaction(() => {
      // 1. Insert the ticket record
      const stmt = this.db.prepare(`
        INSERT INTO loto_tickets (
          ticket_number, sale_amount, commission_rate, commission_amount,
          is_winner, prize_amount, sale_date, payment_method, currency, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        data.ticket_number || null,
        data.sale_amount,
        data.commission_rate ?? 0.0445,
        data.commission_amount,
        data.is_winner ?? 0,
        data.prize_amount ?? 0,
        data.sale_date,
        data.payment_method || null,
        data.currency || "LBP",
        data.note || null,
      );

      const ticketId = result.lastInsertRowid as number;
      const ticket = this.getTicketById(ticketId)!;

      // 2. Create unified transaction record
      const txnRepo = getTransactionRepository();
      const txnId = txnRepo.createTransaction({
        type: TRANSACTION_TYPES.CUSTOM_SERVICE,
        source_table: "loto_tickets",
        source_id: ticketId,
        user_id: 1, // TODO: Get from session
        amount_usd: 0, // Loto is LBP only for now
        amount_lbp: data.sale_amount,
        exchange_rate: 100000, // Default rate
        summary: `Loto ticket sale: ${data.ticket_number || "#" + ticketId}`,
        metadata_json: {
          commission_amount: data.commission_amount,
          commission_rate: data.commission_rate ?? 0.0445,
          payment_method: data.payment_method,
        },
      });

      // 3. Record payment and update drawer balance
      const paymentMethod = data.payment_method || "CASH";
      if (isDrawerAffectingMethod(paymentMethod)) {
        const drawerName = paymentMethodToDrawerName(paymentMethod);
        const currency = data.currency || "LBP";

        // Insert payment record (positive = money IN)
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
          data.sale_amount,
          data.note ||
            `Loto ticket sale: ${data.ticket_number || "#" + ticketId}`,
          1, // TODO: Get from session
        );

        // Update drawer balance (positive delta = money IN)
        const upsertBalance = this.db.prepare(`
          INSERT INTO drawer_balances (drawer_name, currency_code, balance)
          VALUES (?, ?, ?)
          ON CONFLICT(drawer_name, currency_code) DO UPDATE SET
            balance = drawer_balances.balance + excluded.balance,
            updated_at = CURRENT_TIMESTAMP
        `);
        upsertBalance.run(drawerName, currency, data.sale_amount);
      }

      // 4. Create supplier ledger entry (we owe LOTO: sale_amount - commission)
      // The shop owes the supplier the sale amount minus our commission
      const amountWeOwe = data.sale_amount - data.commission_amount;
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
        // Create LOTO supplier if it doesn't exist
        const createSupplier = this.db.prepare(`
          INSERT INTO suppliers (name, provider, is_active, is_system)
          VALUES (?, ?, 1, 1)
        `);
        const result = createSupplier.run("Loto Liban", "LOTO");
        supplier = { id: result.lastInsertRowid as number };
      }

      const supplierId = supplier.id;

      // Negative amount = liability (we owe them)
      const ledgerResult = insertLedger.run(
        supplierId,
        "PAYMENT", // We will pay them later
        0, // USD
        -amountWeOwe, // Negative LBP = we owe them
        `Ticket sale: we owe LOTO ${amountWeOwe} LBP (sale: ${data.sale_amount}, commission: ${data.commission_amount})`,
        1, // TODO: Get from session
        null, // Pass null to avoid FK constraint issues
      );

      return ticket;
    });

    return createInTxn();
  }

  getTicketById(id: number): LotoTicket | null {
    const stmt = this.db.prepare(`
      SELECT * FROM loto_tickets WHERE id = ?
    `);
    return stmt.get(id) as LotoTicket | null;
  }

  getTicketsByDateRange(from: string, to: string): LotoTicket[] {
    const stmt = this.db.prepare(`
      SELECT * FROM loto_tickets 
      WHERE date(sale_date) BETWEEN date(?) AND date(?)
      ORDER BY sale_date DESC, id DESC
    `);
    return stmt.all(from, to) as LotoTicket[];
  }

  updateTicket(id: number, data: LotoTicketUpdate): LotoTicket | null {
    const fields: string[] = [];
    const values: any[] = [];

    if (data.ticket_number !== undefined) {
      fields.push("ticket_number = ?");
      values.push(data.ticket_number);
    }
    if (data.sale_amount !== undefined) {
      fields.push("sale_amount = ?");
      values.push(data.sale_amount);
    }
    if (data.commission_rate !== undefined) {
      fields.push("commission_rate = ?");
      values.push(data.commission_rate);
    }
    if (data.commission_amount !== undefined) {
      fields.push("commission_amount = ?");
      values.push(data.commission_amount);
    }
    if (data.is_winner !== undefined) {
      fields.push("is_winner = ?");
      values.push(data.is_winner);
    }
    if (data.prize_amount !== undefined) {
      fields.push("prize_amount = ?");
      values.push(data.prize_amount);
    }
    if (data.prize_paid_date !== undefined) {
      fields.push("prize_paid_date = ?");
      values.push(data.prize_paid_date);
    }
    if (data.payment_method !== undefined) {
      fields.push("payment_method = ?");
      values.push(data.payment_method);
    }
    if (data.currency !== undefined) {
      fields.push("currency = ?");
      values.push(data.currency);
    }
    if (data.note !== undefined) {
      fields.push("note = ?");
      values.push(data.note);
    }

    if (fields.length === 0) {
      return this.getTicketById(id);
    }

    fields.push("updated_at = CURRENT_TIMESTAMP");
    values.push(id);

    const stmt = this.db.prepare(`
      UPDATE loto_tickets SET ${fields.join(", ")} WHERE id = ?
    `);

    stmt.run(...values);
    return this.getTicketById(id);
  }

  // ===========================================================================
  // Aggregations
  // ===========================================================================

  getTotalSales(from: string, to: string): number {
    const stmt = this.db.prepare(`
      SELECT COALESCE(SUM(sale_amount), 0) as total FROM loto_tickets
      WHERE date(sale_date) BETWEEN date(?) AND date(?)
    `);
    const result = stmt.get(from, to) as { total: number };
    return result.total;
  }

  getTotalCommission(from: string, to: string): number {
    const stmt = this.db.prepare(`
      SELECT COALESCE(SUM(commission_amount), 0) as total FROM loto_tickets
      WHERE date(sale_date) BETWEEN date(?) AND date(?)
    `);
    const result = stmt.get(from, to) as { total: number };
    return result.total;
  }

  getTotalPrizes(from: string, to: string): number {
    const stmt = this.db.prepare(`
      SELECT COALESCE(SUM(prize_amount), 0) as total FROM loto_tickets
      WHERE is_winner = 1 AND date(sale_date) BETWEEN date(?) AND date(?)
    `);
    const result = stmt.get(from, to) as { total: number };
    return result.total;
  }

  getOutstandingPrizes(): number {
    const stmt = this.db.prepare(`
      SELECT COALESCE(SUM(prize_amount), 0) as total FROM loto_tickets
      WHERE is_winner = 1 AND (prize_paid_date IS NULL OR prize_paid_date = '')
    `);
    const result = stmt.get() as { total: number };
    return result.total;
  }

  getTicketCount(from: string, to: string): number {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM loto_tickets
      WHERE date(sale_date) BETWEEN date(?) AND date(?)
    `);
    const result = stmt.get(from, to) as { count: number };
    return result.count;
  }

  // ===========================================================================
  // Monthly Fees
  // ===========================================================================

  createMonthlyFee(data: LotoMonthlyFeeCreate): LotoMonthlyFee {
    const stmt = this.db.prepare(`
      INSERT INTO loto_monthly_fees (
        fee_amount, fee_month, fee_year, recorded_date, is_paid, paid_date, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      data.fee_amount,
      data.fee_month,
      data.fee_year,
      data.recorded_date,
      data.is_paid ?? 0,
      data.paid_date || null,
      data.note || null,
    );

    return this.getMonthlyFeeById(result.lastInsertRowid as number)!;
  }

  getMonthlyFeeById(id: number): LotoMonthlyFee | null {
    const stmt = this.db.prepare(
      `SELECT * FROM loto_monthly_fees WHERE id = ?`,
    );
    return stmt.get(id) as LotoMonthlyFee | null;
  }

  getMonthlyFeesByYear(year: number): LotoMonthlyFee[] {
    const stmt = this.db.prepare(`
      SELECT * FROM loto_monthly_fees
      WHERE fee_year = ?
      ORDER BY fee_month ASC
    `);
    return stmt.all(year) as LotoMonthlyFee[];
  }

  markFeePaid(id: number, paidDate: string): LotoMonthlyFee | null {
    const stmt = this.db.prepare(`
      UPDATE loto_monthly_fees 
      SET is_paid = 1, paid_date = ?
      WHERE id = ?
    `);
    stmt.run(paidDate, id);
    return this.getMonthlyFeeById(id);
  }

  getTotalFees(from: string, to: string): number {
    const stmt = this.db.prepare(`
      SELECT COALESCE(SUM(fee_amount), 0) as total FROM loto_monthly_fees
      WHERE date(recorded_date) BETWEEN date(?) AND date(?)
    `);
    const result = stmt.get(from, to) as { total: number };
    return result.total;
  }

  // ===========================================================================
  // Settings
  // ===========================================================================

  getSettings(): Map<string, string> {
    const stmt = this.db.prepare(`SELECT * FROM loto_settings`);
    const rows = stmt.all() as LotoSetting[];
    const settings = new Map<string, string>();
    rows.forEach((row) => {
      settings.set(row.key_name, row.value);
    });
    return settings;
  }

  updateSetting(key: string, value: string): LotoSetting | null {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO loto_settings (key_name, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `);
    stmt.run(key, value);

    const getStmt = this.db.prepare(
      `SELECT * FROM loto_settings WHERE key_name = ?`,
    );
    return getStmt.get(key) as LotoSetting | null;
  }

  // ===========================================================================
  // Report Data
  // ===========================================================================

  getReportData(from: string, to: string): LotoReportData {
    return {
      total_tickets: this.getTicketCount(from, to),
      total_sales: this.getTotalSales(from, to),
      total_commission: this.getTotalCommission(from, to),
      total_prizes: this.getTotalPrizes(from, to),
      outstanding_prizes: this.getOutstandingPrizes(),
      total_fees: this.getTotalFees(from, to),
    };
  }

  // ===========================================================================
  // Checkpoints
  // ===========================================================================

  createCheckpoint(data: LotoCheckpointCreate): LotoCheckpoint {
    // TODO: Enforce single checkpoint per day - currently disabled for testing
    // Check if a checkpoint already exists for this date
    // const existing = this.getCheckpointByDate(data.checkpoint_date);
    // if (existing) {
    //   throw new Error(
    //     `A checkpoint already exists for ${data.checkpoint_date}. Only one checkpoint per day is allowed.`,
    //   );
    // }

    const stmt = this.db.prepare(`
      INSERT INTO loto_checkpoints (
        checkpoint_date, period_start, period_end, 
        total_sales, total_commission, total_tickets, total_prizes, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      data.checkpoint_date,
      data.period_start,
      data.period_end,
      data.total_sales ?? 0,
      data.total_commission ?? 0,
      data.total_tickets ?? 0,
      data.total_prizes ?? 0,
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
    const values: any[] = [];

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
   * 4. Mark checkpoint as settled
   */
  settleCheckpoint(
    id: number,
    totalSales: number,
    totalCommission: number,
    totalPrizes: number,
    totalCashPrizes: number,
    settledAt?: string,
  ): LotoCheckpoint {
    const settleInTxn = this.db.transaction(() => {
      const settledDate = settledAt || new Date().toISOString();

      // Calculate settlement amounts
      // Shop pays supplier: total sales collected
      // Supplier pays shop: commission + cash prizes (prizes already paid to customers are reimbursable)
      const shopPaysSupplier = totalSales;
      const supplierPaysShop = totalCommission + totalCashPrizes;
      const netSettlement = supplierPaysShop - shopPaysSupplier;
      // Positive = supplier owes us (they pay us)
      // Negative = we owe supplier (we pay them)

      // Get LOTO supplier ID
      const supplierStmt = this.db.prepare(
        `SELECT id FROM suppliers WHERE provider = 'LOTO' LIMIT 1`,
      );
      const supplier = supplierStmt.get() as { id: number } | undefined;
      const supplierId = supplier?.id || 1;

      // 1. Create unified transaction for settlement
      const txnRepo = getTransactionRepository();
      const txnId = txnRepo.createTransaction({
        type: TRANSACTION_TYPES.CUSTOM_SERVICE,
        source_table: "loto_checkpoints",
        source_id: id,
        user_id: 1, // TODO: Get from session
        amount_usd: 0,
        amount_lbp: netSettlement, // Positive = we receive, Negative = we pay
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

      // 3. Create SETTLEMENT entry in supplier_ledger (separate ID, no transaction_id)
      const insertLedger = this.db.prepare(`
        INSERT INTO supplier_ledger (
          supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, transaction_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      insertLedger.run(
        supplierId,
        "SETTLEMENT",
        0, // USD
        netSettlement, // Positive = they owe us, Negative = we owe them
        `Settlement for checkpoint #${id}: ${settlementNote}`,
        1, // TODO: Get from session
        null, // Separate ID, not linked to transaction
      );

      // 4. Credit commission to General drawer (commission was pending until settlement)
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

      // 5. Mark checkpoint as settled
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

  getSettlementHistory(limit?: number): LotoSettlement[] {
    const limitClause = limit ? `LIMIT ${limit}` : "";
    const stmt = this.db.prepare(`
      SELECT * FROM loto_settlements 
      ORDER BY settlement_date DESC, id DESC
      ${limitClause}
    `);
    return stmt.all() as LotoSettlement[];
  }

  // ===========================================================================
  // Cash Prizes
  // ===========================================================================

  createCashPrize(data: LotoCashPrizeCreate): LotoCashPrize {
    // Wrap in a transaction to ensure all operations succeed or fail together
    const createInTxn = this.db.transaction(() => {
      // 1. Insert the cash prize record
      const stmt = this.db.prepare(`
        INSERT INTO loto_cash_prizes (
          ticket_number, prize_amount, prize_date
        ) VALUES (?, ?, ?)
      `);

      const result = stmt.run(
        data.ticket_number,
        data.prize_amount,
        data.prize_date,
      );

      const prizeId = result.lastInsertRowid as number;
      const prize = this.getCashPrizeById(prizeId)!;

      // 2. Create unified transaction record (money OUT = negative amount)
      const txnRepo = getTransactionRepository();
      const txnId = txnRepo.createTransaction({
        type: TRANSACTION_TYPES.CUSTOM_SERVICE,
        source_table: "loto_cash_prizes",
        source_id: prizeId,
        user_id: 1,
        amount_usd: 0,
        amount_lbp: -data.prize_amount,
        exchange_rate: 100000,
        summary: `Loto cash prize payout: ${data.ticket_number}`,
        metadata_json: {
          ticket_number: data.ticket_number,
        },
      });

      // 3. Record payment and update drawer balance (money OUT = negative)
      const paymentMethod = "CASH";
      const drawerName = "General";
      const currency = "LBP";

      // Insert payment record (negative = money OUT)
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
        `Loto cash prize: ${data.ticket_number}`,
        1,
      );

      // Update drawer balance (negative delta = money OUT)
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
      const ledgerResult = insertLedger.run(
        supplierId,
        "CASH_PRIZE",
        0,
        data.prize_amount,
        `Cash prize payout: LOTO owes us ${data.prize_amount} LBP (ticket: ${data.ticket_number})`,
        1,
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
}

// =============================================================================
// Singleton Instance
// =============================================================================

let lotoRepositoryInstance: LotoRepository | null = null;

export function getLotoRepository(): LotoRepository {
  if (!lotoRepositoryInstance) {
    lotoRepositoryInstance = new LotoRepository(getDatabase());
  }
  return lotoRepositoryInstance;
}

/** Reset the singleton (for testing) */
export function resetLotoRepository(): void {
  lotoRepositoryInstance = null;
}

export default LotoRepository;
