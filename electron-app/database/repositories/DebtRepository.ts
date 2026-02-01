/**
 * Debt Repository
 *
 * Handles all debt_ledger table operations.
 * Uses BaseRepository for common functionality.
 */

import { BaseRepository } from "./BaseRepository.js";

// =============================================================================
// Entity Types
// =============================================================================

export interface DebtLedgerEntity {
  id: number;
  client_id: number;
  sale_id: number | null;
  transaction_type: string;
  amount_usd: number;
  amount_lbp: number;
  note: string | null;
  created_at: string;
  created_by: number | null;
}

export interface DebtorSummary {
  id: number;
  full_name: string;
  phone_number: string;
  total_debt: number;
}

export interface TopDebtor {
  full_name: string;
  total_debt: number;
}

export interface DebtSummary {
  totalDebt: number;
  topDebtors: TopDebtor[];
}

export interface CreateRepaymentData {
  client_id: number;
  amount_usd: number;
  amount_lbp: number;
  paid_amount_usd?: number | undefined; // Actual amount paid (rounded), saved to drawer
  paid_amount_lbp?: number | undefined; // Actual amount paid (rounded), saved to drawer
  drawer_name?: string | undefined; // Which drawer received the payment
  note?: string | null;
  created_by?: number | null;
}

// =============================================================================
// Debt Repository Class
// =============================================================================

export class DebtRepository extends BaseRepository<DebtLedgerEntity> {
  constructor() {
    super("debt_ledger", { softDelete: false });
  }

  // ---------------------------------------------------------------------------
  // Debtor Queries
  // ---------------------------------------------------------------------------

  /**
   * Get all clients with their debt totals (grouped)
   */
  findAllDebtors(): DebtorSummary[] {
    // Get exchange rate from settings or use default
    const rateResult = this.db.prepare(`
      SELECT rate FROM exchange_rates WHERE from_code = 'USD' AND to_code = 'LBP' LIMIT 1
    `).get() as { rate: number } | undefined;
    const rate = rateResult?.rate || 89000;

    const stmt = this.db.prepare(`
      SELECT 
        c.id, 
        c.full_name, 
        c.phone_number,
        COALESCE(ROUND(SUM(dl.amount_usd) + SUM(dl.amount_lbp) / ?, 2), 0) as total_debt
      FROM debt_ledger dl
      JOIN clients c ON dl.client_id = c.id
      GROUP BY c.id
      HAVING total_debt != 0
      ORDER BY total_debt DESC
    `);
    return stmt.all(rate) as DebtorSummary[];
  }

  /**
   * Get debt history for a specific client
   * Default: most recent first (DESC)
   */
  findClientHistory(clientId: number): DebtLedgerEntity[] {
    const stmt = this.db.prepare(`
      SELECT * FROM debt_ledger 
      WHERE client_id = ? 
      ORDER BY created_at DESC
    `);
    return stmt.all(clientId) as DebtLedgerEntity[];
  }

  /**
   * Get total debt for a specific client
   */
  getClientDebtTotal(clientId: number): number {
    // Get exchange rate from settings or use default
    const rateResult = this.db.prepare(`
      SELECT rate FROM exchange_rates WHERE from_code = 'USD' AND to_code = 'LBP' LIMIT 1
    `).get() as { rate: number } | undefined;
    const rate = rateResult?.rate || 89000;

    const stmt = this.db.prepare(
      "SELECT COALESCE(ROUND(SUM(amount_usd) + SUM(amount_lbp) / ?, 2), 0) as total FROM debt_ledger WHERE client_id = ?",
    );
    const result = stmt.get(rate, clientId) as { total: number | null };
    return result?.total || 0;
  }

  // ---------------------------------------------------------------------------
  // Repayment Operations
  // ---------------------------------------------------------------------------

  /**
   * Add a repayment entry (stored as negative values to reduce debt)
   * If paid_amount differs from amount, the paid amount goes to drawer and amount reduces debt
   */
  addRepayment(data: CreateRepaymentData): { id: number } {
    // Use paid amounts if provided, otherwise use actual amounts (backward compatible)
    const paidUSD = data.paid_amount_usd ?? data.amount_usd;
    const paidLBP = data.paid_amount_lbp ?? data.amount_lbp;
    const drawerName = data.drawer_name || 'General';

    const insertDebtStmt = this.db.prepare(`
      INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, note, created_by)
      VALUES (?, 'Repayment', ?, ?, ?, ?)
    `);

    // Store as negative values to signify a reduction in debt
    const result = insertDebtStmt.run(
      data.client_id,
      -data.amount_usd,
      -data.amount_lbp,
      data.note || null,
      data.created_by || null,
    );

    const repaymentId = Number(result.lastInsertRowid);

    // Record payment and update drawer balances with the PAID amounts (rounded)
    // USD payment to drawer
    if (paidUSD > 0) {
      const paymentStmt = this.db.prepare(`
        INSERT INTO payments (source_type, source_id, method, drawer_name, currency_code, amount, note, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      paymentStmt.run(
        'debt_repayment',
        repaymentId,
        'cash',
        drawerName,
        'USD',
        paidUSD,
        data.note || null,
        data.created_by || null,
      );

      // Update drawer balance
      const drawerStmt = this.db.prepare(`
        INSERT INTO drawer_balances (drawer_name, currency_code, balance)
        VALUES (?, ?, ?)
        ON CONFLICT(drawer_name, currency_code) DO UPDATE SET
          balance = drawer_balances.balance + excluded.balance,
          updated_at = CURRENT_TIMESTAMP
      `);
      drawerStmt.run(drawerName, 'USD', paidUSD);
    }

    // LBP payment to drawer
    if (paidLBP > 0) {
      const paymentStmt = this.db.prepare(`
        INSERT INTO payments (source_type, source_id, method, drawer_name, currency_code, amount, note, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      paymentStmt.run(
        'debt_repayment',
        repaymentId,
        'cash',
        drawerName,
        'LBP',
        paidLBP,
        data.note || null,
        data.created_by || null,
      );

      // Update drawer balance
      const drawerStmt = this.db.prepare(`
        INSERT INTO drawer_balances (drawer_name, currency_code, balance)
        VALUES (?, ?, ?)
        ON CONFLICT(drawer_name, currency_code) DO UPDATE SET
          balance = drawer_balances.balance + excluded.balance,
          updated_at = CURRENT_TIMESTAMP
      `);
      drawerStmt.run(drawerName, 'LBP', paidLBP);
    }

    return { id: repaymentId };
  }

  // ---------------------------------------------------------------------------
  // Dashboard Queries
  // ---------------------------------------------------------------------------

  /**
   * Get debt summary for dashboard (total debt + top debtors)
   */
  getDebtSummary(topN: number = 5): DebtSummary {
    // Total debt receivable
    const totalDebtResult = this.db
      .prepare(
        `
      SELECT SUM(amount_usd) as totalDebt FROM debt_ledger
    `,
      )
      .get() as { totalDebt: number | null };

    // Top N debtors (only those with positive debt)
    const topDebtors = this.db
      .prepare(
        `
      SELECT 
        c.full_name,
        SUM(dl.amount_usd) as total_debt
      FROM debt_ledger dl
      JOIN clients c ON dl.client_id = c.id
      GROUP BY dl.client_id
      HAVING total_debt > 0.01
      ORDER BY total_debt DESC
      LIMIT ?
    `,
      )
      .all(topN) as TopDebtor[];

    return {
      totalDebt: totalDebtResult?.totalDebt || 0,
      topDebtors,
    };
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let debtRepositoryInstance: DebtRepository | null = null;

export function getDebtRepository(): DebtRepository {
  if (!debtRepositoryInstance) {
    debtRepositoryInstance = new DebtRepository();
  }
  return debtRepositoryInstance;
}

/** Reset the singleton (for testing) */
export function resetDebtRepository(): void {
  debtRepositoryInstance = null;
}
