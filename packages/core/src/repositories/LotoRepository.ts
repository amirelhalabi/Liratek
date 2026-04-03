/**
 * Loto Repository
 *
 * Handles all database operations for the Loto module.
 */

import type Database from "better-sqlite3";
import logger from "../utils/logger.js";
import { getDatabase } from "../db/connection.js";

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

export class LotoRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  // ===========================================================================
  // Tickets
  // ===========================================================================

  createTicket(data: LotoTicketCreate): LotoTicket {
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

    return this.getTicketById(result.lastInsertRowid as number)!;
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
