/**
 * Debt Repository
 *
 * Handles all debt_ledger table operations.
 * Uses BaseRepository for common functionality.
 */
import { BaseRepository } from "./BaseRepository.js";
// =============================================================================
// Debt Repository Class
// =============================================================================
export class DebtRepository extends BaseRepository {
    constructor() {
        super("debt_ledger", { softDelete: false });
    }
    // ---------------------------------------------------------------------------
    // Debtor Queries
    // ---------------------------------------------------------------------------
    /**
     * Get all clients with their debt totals (grouped)
     */
    findAllDebtors() {
        // Use exchange rate to convert LBP portion into USD for consistent totals
        const rateResult = this.db
            .prepare(`SELECT rate FROM exchange_rates WHERE from_code = 'USD' AND to_code = 'LBP' LIMIT 1`)
            .get();
        const rate = rateResult?.rate || 89000;
        const stmt = this.db.prepare(`
      SELECT 
        c.id, 
        c.full_name, 
        c.phone_number,
        ROUND(SUM(dl.amount_usd) + (SUM(dl.amount_lbp) / ?), 2) as total_debt
      FROM debt_ledger dl
      JOIN clients c ON dl.client_id = c.id
      GROUP BY c.id
      ORDER BY total_debt DESC
    `);
        return stmt.all(rate);
    }
    /**
     * Get debt history for a specific client
     * Default: most recent first (DESC)
     */
    findClientHistory(clientId) {
        const stmt = this.db.prepare(`
      SELECT * FROM debt_ledger 
      WHERE client_id = ? 
      ORDER BY created_at DESC
    `);
        return stmt.all(clientId);
    }
    /**
     * Get total debt for a specific client
     */
    getClientDebtTotal(clientId) {
        const rateResult = this.db
            .prepare(`SELECT rate FROM exchange_rates WHERE from_code = 'USD' AND to_code = 'LBP' LIMIT 1`)
            .get();
        const rate = rateResult?.rate || 89000;
        const stmt = this.db.prepare(`SELECT ROUND(SUM(amount_usd) + (SUM(amount_lbp) / ?), 2) as total 
       FROM debt_ledger 
       WHERE client_id = ?`);
        const result = stmt.get(rate, clientId);
        return result?.total || 0;
    }
    // ---------------------------------------------------------------------------
    // Repayment Operations
    // ---------------------------------------------------------------------------
    /**
     * Add a repayment entry (stored as negative values to reduce debt)
     */
    addRepayment(data) {
        const stmt = this.db.prepare(`
      INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, note, created_by)
      VALUES (?, 'Repayment', ?, ?, ?, ?)
    `);
        // Store as negative values to signify a reduction in debt
        const result = stmt.run(data.client_id, -data.amount_usd, -data.amount_lbp, data.note || null, data.created_by || null);
        return { id: Number(result.lastInsertRowid) };
    }
    // ---------------------------------------------------------------------------
    // Dashboard Queries
    // ---------------------------------------------------------------------------
    /**
     * Get debt summary for dashboard (total debt + top debtors)
     */
    getDebtSummary(topN = 5) {
        // Total debt receivable
        const rateResult = this.db
            .prepare(`SELECT rate FROM exchange_rates WHERE from_code = 'USD' AND to_code = 'LBP' LIMIT 1`)
            .get();
        const rate = rateResult?.rate || 89000;
        const totalDebtResult = this.db
            .prepare(`
      SELECT ROUND(SUM(amount_usd) + (SUM(amount_lbp) / ?), 2) as totalDebt FROM debt_ledger
    `)
            .get(rate);
        // Top N debtors (only those with positive debt)
        const topDebtors = this.db
            .prepare(`
      SELECT 
        c.full_name,
        ROUND(SUM(dl.amount_usd) + (SUM(dl.amount_lbp) / ?), 2) as total_debt
      FROM debt_ledger dl
      JOIN clients c ON dl.client_id = c.id
      GROUP BY dl.client_id
      HAVING total_debt > 0.01
      ORDER BY total_debt DESC
      LIMIT ?
    `)
            .all(rate, topN);
        return {
            totalDebt: totalDebtResult?.totalDebt || 0,
            topDebtors,
        };
    }
}
// =============================================================================
// Singleton Instance
// =============================================================================
let debtRepositoryInstance = null;
export function getDebtRepository() {
    if (!debtRepositoryInstance) {
        debtRepositoryInstance = new DebtRepository();
    }
    return debtRepositoryInstance;
}
/** Reset the singleton (for testing) */
export function resetDebtRepository() {
    debtRepositoryInstance = null;
}
