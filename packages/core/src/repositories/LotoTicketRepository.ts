/**
 * Loto Ticket Repository
 *
 * Handles all database operations for the loto_tickets table.
 */

import type Database from "better-sqlite3";
import { getDatabase } from "../db/connection.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";
import {
  isDrawerAffectingMethod,
  paymentMethodToDrawerName,
} from "../utils/payments.js";

function fmtPaymentMethod(method: string): string {
  return method.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

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
  checkpoint_id: number | null;
  client_id: number | null;
  client_name: string | null;
  created_at: string;
  updated_at: string;
  edited_by: string | null;
  edited_at: string | null;
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
  transaction_time?: string;
  clientId?: number | null;
  clientName?: string | null;
  /**
   * Structured payment legs in the currency the customer ACTUALLY paid
   * (e.g. a 500,000 LBP ticket paid with $5). When present, each
   * drawer-affecting leg is booked in its own currency; the ticket's LBP
   * face value is never blindly credited. Legs without a direction are IN;
   * direction "OUT" legs are change returned (booked negative).
   */
  payments?: Array<{
    method: string;
    currencyCode: string;
    amount: number;
    direction?: "IN" | "OUT";
  }>;
  /**
   * Session-basket deferred payment mode. When true, the ticket + unified
   * transaction + supplier ledger are created but the customer-cash drawer post
   * is skipped — the basket recorder owns the customer payment. Non-session
   * callers leave this falsy → behavior is unchanged.
   */
  deferPayment?: boolean;
  /** Operator-edited USD↔LBP rate of record (session checkout); else default. */
  exchange_rate?: number;
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
    const tenantId = getCurrentTenantId();
    const createInTxn = this.db.transaction(() => {
      // 1. Insert the ticket record
      const stmt = this.db.prepare(`
        INSERT INTO loto_tickets (
          tenant_id, ticket_number, sale_amount, commission_rate, commission_amount,
          is_winner, prize_amount, sale_date, payment_method, currency, note,
          client_id, client_name, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
      `);

      const result = stmt.run(
        tenantId,
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
        data.clientId ?? null,
        data.clientName ?? null,
        data.transaction_time ?? null,
      );

      const ticketId = result.lastInsertRowid as number;
      const ticket = this.getTicketById(ticketId)!;

      const paymentMethod = data.payment_method || "CASH";
      const ticketLabel = data.ticket_number || `#${ticketId}`;
      const txnSummary = `Loto ticket sale: ${ticketLabel} ${fmtPaymentMethod(paymentMethod)}`;

      // 2. Create unified transaction record
      const txnRepo = getTransactionRepository();
      const txnId = txnRepo.createTransaction({
        type: TRANSACTION_TYPES.LOTO,
        source_table: "loto_tickets",
        source_id: ticketId,
        user_id: data.userId,
        amount_usd: 0, // Loto is LBP only for now
        amount_lbp: data.sale_amount,
        profit_lbp: data.commission_amount,
        exchange_rate: data.exchange_rate ?? 100000, // operator rate (session) else default
        client_id: data.clientId ?? null,
        client_name: data.clientName ?? null,
        summary: txnSummary,
        metadata_json: {
          commission_amount: data.commission_amount,
          commission_rate: data.commission_rate ?? 0.0445,
          payment_method: paymentMethod,
        },
        transaction_time: data.transaction_time,
      });

      // 3. Record payment and update drawer balance.
      // Deferred (session basket): the basket recorder owns the customer-cash
      // post, so skip the drawer movement here (the supplier ledger below stays).
      const insertPayment = this.db.prepare(`
        INSERT INTO payments (
          tenant_id, transaction_id, method, drawer_name, currency_code, amount, note, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      // drawer_balances' PRIMARY KEY is now (tenant_id, drawer_name,
      // currency_code) — the ON CONFLICT target must match it exactly.
      const upsertBalanceLeg = this.db.prepare(`
        INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(tenant_id, drawer_name, currency_code) DO UPDATE SET
          balance = drawer_balances.balance + excluded.balance,
          updated_at = CURRENT_TIMESTAMP
      `);

      // CUSTOMER_ACCOUNT (on-account) portion — accumulated from the legs and
      // booked to debt_ledger below. Pre-fix these legs were silently DROPPED:
      // the ticket sold and the supplier debt accrued, but the customer owed
      // nothing anywhere (found by the lira-093 customer-account sweep).
      let debtUsd = 0;
      let debtLbp = 0;

      if (!data.deferPayment && data.payments && data.payments.length > 0) {
        // Structured legs: book what the customer ACTUALLY handed over, each
        // leg in its own currency (a 500,000 LBP ticket paid with $5 books
        // General +5 USD — not a phantom +500,000 LBP). IN legs positive,
        // OUT (change) legs negative.
        for (const leg of data.payments) {
          if (!isDrawerAffectingMethod(leg.method)) {
            if (leg.method === "CUSTOMER_ACCOUNT" && leg.direction !== "OUT") {
              if (leg.currencyCode === "USD") debtUsd += Math.abs(leg.amount);
              else debtLbp += Math.abs(leg.amount);
            }
            continue;
          }
          const legDrawer = paymentMethodToDrawerName(leg.method);
          const signed =
            leg.direction === "OUT"
              ? -Math.abs(leg.amount)
              : Math.abs(leg.amount);
          insertPayment.run(
            tenantId,
            txnId,
            leg.method,
            legDrawer,
            leg.currencyCode,
            signed,
            data.note || txnSummary,
            data.userId,
          );
          upsertBalanceLeg.run(tenantId, legDrawer, leg.currencyCode, signed);
        }
      } else if (!data.deferPayment && paymentMethod === "CUSTOMER_ACCOUNT") {
        // Legacy single-payment on account: the full ticket value is debt.
        if ((data.currency || "LBP") === "USD") debtUsd += data.sale_amount;
        else debtLbp += data.sale_amount;
      } else if (!data.deferPayment && isDrawerAffectingMethod(paymentMethod)) {
        // Legacy fallback (no legs provided): single payment at the ticket's
        // denominated currency.
        const drawerName = paymentMethodToDrawerName(paymentMethod);
        const currency = data.currency || "LBP";

        insertPayment.run(
          tenantId,
          txnId,
          paymentMethod,
          drawerName,
          currency,
          data.sale_amount,
          data.note || txnSummary,
          data.userId,
        );

        // Update drawer balance (positive delta = money IN). Same composite
        // (tenant_id, drawer_name, currency_code) conflict target as above.
        const upsertBalance = this.db.prepare(`
          INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(tenant_id, drawer_name, currency_code) DO UPDATE SET
            balance = drawer_balances.balance + excluded.balance,
            updated_at = CURRENT_TIMESTAMP
        `);
        upsertBalance.run(tenantId, drawerName, currency, data.sale_amount);
      }

      // 3b. Book the on-account portion as client debt (open-debt model, same
      // as POS/custom services — 'Loto Debt'). Requires a real client row.
      if (debtUsd > 0 || debtLbp > 0) {
        if (!data.clientId) {
          throw new Error("Cannot create debt without a client");
        }
        this.db
          .prepare(
            `INSERT INTO debt_ledger (
              tenant_id, client_id, transaction_type, amount_usd, amount_lbp, transaction_id, note, created_by, due_date
            ) VALUES (?, ?, 'Loto Debt', ?, ?, ?, ?, ?, datetime('now', '+30 days'))`,
          )
          .run(
            tenantId,
            data.clientId,
            debtUsd,
            debtLbp,
            txnId,
            data.note || txnSummary,
            data.userId,
          );
      }

      // 4. Create supplier ledger entry (we owe LOTO: sale_amount - commission)
      const amountWeOwe = data.sale_amount - data.commission_amount;
      const insertLedger = this.db.prepare(`
        INSERT INTO supplier_ledger (
          tenant_id, supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, transaction_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

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

      // Positive amount = shop owes LOTO (standard supplier convention: the
      // Suppliers page sums ledger rows and reads >0 as "You owe"). TOP_UP —
      // not PAYMENT — because addLedgerEntry force-negates PAYMENT amounts; a
      // future refactor through it would silently re-invert this row.
      insertLedger.run(
        tenantId,
        supplierId,
        "TOP_UP",
        0, // USD
        amountWeOwe, // Positive LBP = we owe them
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
      SELECT * FROM loto_tickets WHERE id = ? AND tenant_id = ?
    `);
    return stmt.get(id, getCurrentTenantId()) as LotoTicket | null;
  }

  getTicketsByDateRange(from: string, to: string): LotoTicket[] {
    const stmt = this.db.prepare(`
      SELECT * FROM loto_tickets
      WHERE date(sale_date) BETWEEN date(?) AND date(?) AND tenant_id = ?
      ORDER BY sale_date DESC, id DESC
    `);
    return stmt.all(from, to, getCurrentTenantId()) as LotoTicket[];
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
    values.push(id, getCurrentTenantId());

    const stmt = this.db.prepare(`
      UPDATE loto_tickets SET ${fields.join(", ")} WHERE id = ? AND tenant_id = ?
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
      WHERE date(sale_date) BETWEEN date(?) AND date(?) AND tenant_id = ?
    `);
    const result = stmt.get(from, to, getCurrentTenantId()) as {
      total: number;
    };
    return result.total;
  }

  getTotalCommission(from: string, to: string): number {
    const stmt = this.db.prepare(`
      SELECT COALESCE(SUM(commission_amount), 0) as total FROM loto_tickets
      WHERE date(sale_date) BETWEEN date(?) AND date(?) AND tenant_id = ?
    `);
    const result = stmt.get(from, to, getCurrentTenantId()) as {
      total: number;
    };
    return result.total;
  }

  getTotalPrizes(from: string, to: string): number {
    const stmt = this.db.prepare(`
      SELECT COALESCE(SUM(prize_amount), 0) as total FROM loto_tickets
      WHERE is_winner = 1 AND date(sale_date) BETWEEN date(?) AND date(?) AND tenant_id = ?
    `);
    const result = stmt.get(from, to, getCurrentTenantId()) as {
      total: number;
    };
    return result.total;
  }

  getOutstandingPrizes(): number {
    const stmt = this.db.prepare(`
      SELECT COALESCE(SUM(prize_amount), 0) as total FROM loto_tickets
      WHERE is_winner = 1 AND (prize_paid_date IS NULL OR prize_paid_date = '') AND tenant_id = ?
    `);
    const result = stmt.get(getCurrentTenantId()) as { total: number };
    return result.total;
  }

  getTicketCount(from: string, to: string): number {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM loto_tickets
      WHERE date(sale_date) BETWEEN date(?) AND date(?) AND tenant_id = ?
    `);
    const result = stmt.get(from, to, getCurrentTenantId()) as {
      count: number;
    };
    return result.count;
  }

  // ===========================================================================
  // Checkpoint support
  // ===========================================================================

  /**
   * Get all tickets that have not been assigned to a checkpoint yet.
   */
  getUncheckpointedTickets(): LotoTicket[] {
    const stmt = this.db.prepare(`
      SELECT * FROM loto_tickets
      WHERE checkpoint_id IS NULL AND tenant_id = ?
      ORDER BY sale_date DESC, id DESC
    `);
    return stmt.all(getCurrentTenantId()) as LotoTicket[];
  }

  /**
   * Assign a ticket to a checkpoint.
   */
  assignToCheckpoint(ticketId: number, checkpointId: number): void {
    const stmt = this.db.prepare(`
      UPDATE loto_tickets
      SET checkpoint_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND tenant_id = ?
    `);
    stmt.run(checkpointId, ticketId, getCurrentTenantId());
  }

  /**
   * Unlink all tickets from a checkpoint (set checkpoint_id = NULL).
   */
  unlinkFromCheckpoint(checkpointId: number): number {
    const stmt = this.db.prepare(`
      UPDATE loto_tickets
      SET checkpoint_id = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE checkpoint_id = ? AND tenant_id = ?
    `);
    const result = stmt.run(checkpointId, getCurrentTenantId());
    return result.changes;
  }

  /**
   * Get aggregated totals for uncheckpointed tickets only.
   */
  getUncheckpointedTotals(): {
    count: number;
    totalSales: number;
    totalCommission: number;
    totalPrizes: number;
  } {
    const stmt = this.db.prepare(`
      SELECT
        COUNT(*) as count,
        COALESCE(SUM(sale_amount), 0) as totalSales,
        COALESCE(SUM(commission_amount), 0) as totalCommission,
        COALESCE(SUM(CASE WHEN is_winner = 1 THEN prize_amount ELSE 0 END), 0) as totalPrizes
      FROM loto_tickets
      WHERE checkpoint_id IS NULL AND tenant_id = ?
    `);
    return stmt.get(getCurrentTenantId()) as {
      count: number;
      totalSales: number;
      totalCommission: number;
      totalPrizes: number;
    };
  }

  /**
   * Update non-financial metadata on a loto ticket.
   * Only metadata fields are allowed — financial data is immutable.
   */
  updateMetadata(
    id: number,
    data: { note?: string },
    editedBy: string,
  ): LotoTicket | null {
    const existing = this.getTicketById(id);
    if (!existing) return null;

    const fields: string[] = [];
    const values: unknown[] = [];

    if (data.note !== undefined) {
      fields.push("note = ?");
      values.push(data.note);
    }

    if (fields.length === 0) return existing;

    fields.push("edited_by = ?", "edited_at = CURRENT_TIMESTAMP");
    values.push(editedBy);
    values.push(id, getCurrentTenantId());

    this.db
      .prepare(
        `UPDATE loto_tickets SET ${fields.join(", ")} WHERE id = ? AND tenant_id = ?`,
      )
      .run(...values);

    return this.getTicketById(id);
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
