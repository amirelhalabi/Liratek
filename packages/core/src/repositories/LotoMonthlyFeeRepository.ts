/**
 * Loto Monthly Fee Repository
 *
 * Handles all database operations for the loto_monthly_fees table.
 */

import type Database from "better-sqlite3";
import { getDatabase } from "../db/connection.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";

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

export class LotoMonthlyFeeRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

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

  markFeePaid(
    id: number,
    paidDate: string,
    userId: number,
  ): LotoMonthlyFee | null {
    const markPaidInTxn = this.db.transaction(() => {
      const fee = this.getMonthlyFeeById(id);
      if (!fee) return null;

      // 1. Mark as paid
      const stmt = this.db.prepare(`
        UPDATE loto_monthly_fees 
        SET is_paid = 1, paid_date = ?
        WHERE id = ?
      `);
      stmt.run(paidDate, id);

      // 2. Create unified transaction record (money OUT = negative)
      const txnRepo = getTransactionRepository();
      const txnId = txnRepo.createTransaction({
        type: TRANSACTION_TYPES.LOTO_MONTHLY_FEE,
        source_table: "loto_monthly_fees",
        source_id: id,
        user_id: userId,
        amount_usd: 0,
        amount_lbp: -fee.fee_amount, // Negative = money OUT (expense)
        exchange_rate: null,
        summary: `Loto monthly fee: ${fee.fee_month}/${fee.fee_year} - ${fee.fee_amount} LBP`,
        metadata_json: {
          fee_month: fee.fee_month,
          fee_year: fee.fee_year,
          fee_amount: fee.fee_amount,
        },
      });

      // 3. Debit drawer balance (money OUT from General/LBP)
      const insertPayment = this.db.prepare(`
        INSERT INTO payments (
          transaction_id, method, drawer_name, currency_code, amount, note, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      insertPayment.run(
        txnId,
        "CASH",
        "General",
        "LBP",
        -fee.fee_amount,
        `Loto monthly fee: ${fee.fee_month}/${fee.fee_year}`,
        userId,
      );

      const upsertBalance = this.db.prepare(`
        INSERT INTO drawer_balances (drawer_name, currency_code, balance)
        VALUES (?, ?, ?)
        ON CONFLICT(drawer_name, currency_code) DO UPDATE SET
          balance = drawer_balances.balance + excluded.balance,
          updated_at = CURRENT_TIMESTAMP
      `);
      upsertBalance.run("General", "LBP", -fee.fee_amount);

      return this.getMonthlyFeeById(id);
    });

    return markPaidInTxn();
  }

  getTotalFees(from: string, to: string): number {
    const stmt = this.db.prepare(`
      SELECT COALESCE(SUM(fee_amount), 0) as total FROM loto_monthly_fees
      WHERE date(recorded_date) BETWEEN date(?) AND date(?)
    `);
    const result = stmt.get(from, to) as { total: number };
    return result.total;
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let instance: LotoMonthlyFeeRepository | null = null;

export function getLotoMonthlyFeeRepository(): LotoMonthlyFeeRepository {
  if (!instance) {
    instance = new LotoMonthlyFeeRepository(getDatabase());
  }
  return instance;
}

/** Reset the singleton (for testing) */
export function resetLotoMonthlyFeeRepository(): void {
  instance = null;
}

export default LotoMonthlyFeeRepository;
