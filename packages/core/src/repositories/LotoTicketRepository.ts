/**
 * Loto Ticket Repository
 *
 * Handles all database operations for the loto_tickets table.
 */

import type Database from "better-sqlite3";
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
  userId: number;
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

export class LotoTicketRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  createTicket(data: LotoTicketCreate): LotoTicket {
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
        type: TRANSACTION_TYPES.LOTO,
        source_table: "loto_tickets",
        source_id: ticketId,
        user_id: data.userId,
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
          data.userId,
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
        const createSupplier = this.db.prepare(`
          INSERT INTO suppliers (name, provider, is_active, is_system)
          VALUES (?, ?, 1, 1)
        `);
        const result = createSupplier.run("Loto Liban", "LOTO");
        supplier = { id: result.lastInsertRowid as number };
      }

      const supplierId = supplier.id;

      // Negative amount = liability (we owe them)
      insertLedger.run(
        supplierId,
        "PAYMENT", // We will pay them later
        0, // USD
        -amountWeOwe, // Negative LBP = we owe them
        `Ticket sale: we owe LOTO ${amountWeOwe} LBP (sale: ${data.sale_amount}, commission: ${data.commission_amount})`,
        data.userId,
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
    const values: (string | number | null)[] = [];

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
}

// =============================================================================
// Singleton Instance
// =============================================================================

let instance: LotoTicketRepository | null = null;

export function getLotoTicketRepository(): LotoTicketRepository {
  if (!instance) {
    instance = new LotoTicketRepository(getDatabase());
  }
  return instance;
}

/** Reset the singleton (for testing) */
export function resetLotoTicketRepository(): void {
  instance = null;
}

export default LotoTicketRepository;
