/**
 * Debt Repository
 * 
 * Handles all debt_ledger table operations.
 * Uses BaseRepository for common functionality.
 */

import { BaseRepository } from './BaseRepository';

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
  note?: string | null;
  created_by?: number | null;
}

// =============================================================================
// Debt Repository Class
// =============================================================================

export class DebtRepository extends BaseRepository<DebtLedgerEntity> {
  constructor() {
    super('debt_ledger', { softDelete: false });
  }

  // ---------------------------------------------------------------------------
  // Debtor Queries
  // ---------------------------------------------------------------------------

  /**
   * Get all clients with their debt totals (grouped)
   */
  findAllDebtors(): DebtorSummary[] {
    const stmt = this.db.prepare(`
      SELECT 
        c.id, 
        c.full_name, 
        c.phone_number,
        SUM(dl.amount_usd) as total_debt
      FROM debt_ledger dl
      JOIN clients c ON dl.client_id = c.id
      GROUP BY c.id
      ORDER BY total_debt DESC
    `);
    return stmt.all() as DebtorSummary[];
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
    const stmt = this.db.prepare(
      'SELECT SUM(amount_usd) as total FROM debt_ledger WHERE client_id = ?'
    );
    const result = stmt.get(clientId) as { total: number | null };
    return result?.total || 0;
  }

  // ---------------------------------------------------------------------------
  // Repayment Operations
  // ---------------------------------------------------------------------------

  /**
   * Add a repayment entry (stored as negative values to reduce debt)
   */
  addRepayment(data: CreateRepaymentData): { id: number } {
    const stmt = this.db.prepare(`
      INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, note, created_by)
      VALUES (?, 'Repayment', ?, ?, ?, ?)
    `);
    
    // Store as negative values to signify a reduction in debt
    const result = stmt.run(
      data.client_id,
      -data.amount_usd,
      -data.amount_lbp,
      data.note || null,
      data.created_by || null
    );
    
    return { id: Number(result.lastInsertRowid) };
  }

  // ---------------------------------------------------------------------------
  // Dashboard Queries
  // ---------------------------------------------------------------------------

  /**
   * Get debt summary for dashboard (total debt + top debtors)
   */
  getDebtSummary(topN: number = 5): DebtSummary {
    // Total debt receivable
    const totalDebtResult = this.db.prepare(`
      SELECT SUM(amount_usd) as totalDebt FROM debt_ledger
    `).get() as { totalDebt: number | null };

    // Top N debtors (only those with positive debt)
    const topDebtors = this.db.prepare(`
      SELECT 
        c.full_name,
        SUM(dl.amount_usd) as total_debt
      FROM debt_ledger dl
      JOIN clients c ON dl.client_id = c.id
      GROUP BY dl.client_id
      HAVING total_debt > 0.01
      ORDER BY total_debt DESC
      LIMIT ?
    `).all(topN) as TopDebtor[];

    return {
      totalDebt: totalDebtResult?.totalDebt || 0,
      topDebtors
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
