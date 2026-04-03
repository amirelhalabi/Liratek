/**
 * Loto Repository
 *
 * Handles all database operations for the Loto module.
 */
import { getDatabase } from "../db/connection.js";
export class LotoRepository {
  db;
  constructor(db) {
    this.db = db;
  }
  // ===========================================================================
  // Tickets
  // ===========================================================================
  createTicket(data) {
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
    return this.getTicketById(result.lastInsertRowid);
  }
  getTicketById(id) {
    const stmt = this.db.prepare(`
      SELECT * FROM loto_tickets WHERE id = ?
    `);
    return stmt.get(id);
  }
  getTicketsByDateRange(from, to) {
    const stmt = this.db.prepare(`
      SELECT * FROM loto_tickets 
      WHERE date(sale_date) BETWEEN date(?) AND date(?)
      ORDER BY sale_date DESC, id DESC
    `);
    return stmt.all(from, to);
  }
  updateTicket(id, data) {
    const fields = [];
    const values = [];
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
  getTotalSales(from, to) {
    const stmt = this.db.prepare(`
      SELECT COALESCE(SUM(sale_amount), 0) as total FROM loto_tickets
      WHERE date(sale_date) BETWEEN date(?) AND date(?)
    `);
    const result = stmt.get(from, to);
    return result.total;
  }
  getTotalCommission(from, to) {
    const stmt = this.db.prepare(`
      SELECT COALESCE(SUM(commission_amount), 0) as total FROM loto_tickets
      WHERE date(sale_date) BETWEEN date(?) AND date(?)
    `);
    const result = stmt.get(from, to);
    return result.total;
  }
  getTotalPrizes(from, to) {
    const stmt = this.db.prepare(`
      SELECT COALESCE(SUM(prize_amount), 0) as total FROM loto_tickets
      WHERE is_winner = 1 AND date(sale_date) BETWEEN date(?) AND date(?)
    `);
    const result = stmt.get(from, to);
    return result.total;
  }
  getOutstandingPrizes() {
    const stmt = this.db.prepare(`
      SELECT COALESCE(SUM(prize_amount), 0) as total FROM loto_tickets
      WHERE is_winner = 1 AND (prize_paid_date IS NULL OR prize_paid_date = '')
    `);
    const result = stmt.get();
    return result.total;
  }
  getTicketCount(from, to) {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM loto_tickets
      WHERE date(sale_date) BETWEEN date(?) AND date(?)
    `);
    const result = stmt.get(from, to);
    return result.count;
  }
  // ===========================================================================
  // Monthly Fees
  // ===========================================================================
  createMonthlyFee(data) {
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
    return this.getMonthlyFeeById(result.lastInsertRowid);
  }
  getMonthlyFeeById(id) {
    const stmt = this.db.prepare(
      `SELECT * FROM loto_monthly_fees WHERE id = ?`,
    );
    return stmt.get(id);
  }
  getMonthlyFeesByYear(year) {
    const stmt = this.db.prepare(`
      SELECT * FROM loto_monthly_fees
      WHERE fee_year = ?
      ORDER BY fee_month ASC
    `);
    return stmt.all(year);
  }
  markFeePaid(id, paidDate) {
    const stmt = this.db.prepare(`
      UPDATE loto_monthly_fees 
      SET is_paid = 1, paid_date = ?
      WHERE id = ?
    `);
    stmt.run(paidDate, id);
    return this.getMonthlyFeeById(id);
  }
  getTotalFees(from, to) {
    const stmt = this.db.prepare(`
      SELECT COALESCE(SUM(fee_amount), 0) as total FROM loto_monthly_fees
      WHERE date(recorded_date) BETWEEN date(?) AND date(?)
    `);
    const result = stmt.get(from, to);
    return result.total;
  }
  // ===========================================================================
  // Settings
  // ===========================================================================
  getSettings() {
    const stmt = this.db.prepare(`SELECT * FROM loto_settings`);
    const rows = stmt.all();
    const settings = new Map();
    rows.forEach((row) => {
      settings.set(row.key_name, row.value);
    });
    return settings;
  }
  updateSetting(key, value) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO loto_settings (key_name, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `);
    stmt.run(key, value);
    const getStmt = this.db.prepare(
      `SELECT * FROM loto_settings WHERE key_name = ?`,
    );
    return getStmt.get(key);
  }
  // ===========================================================================
  // Report Data
  // ===========================================================================
  getReportData(from, to) {
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
let lotoRepositoryInstance = null;
export function getLotoRepository() {
  if (!lotoRepositoryInstance) {
    lotoRepositoryInstance = new LotoRepository(getDatabase());
  }
  return lotoRepositoryInstance;
}
/** Reset the singleton (for testing) */
export function resetLotoRepository() {
  lotoRepositoryInstance = null;
}
export default LotoRepository;
