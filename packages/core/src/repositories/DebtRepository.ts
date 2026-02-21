/**
 * Debt Repository
 *
 * Handles all debt_ledger table operations.
 * Uses BaseRepository for common functionality.
 */

import { BaseRepository } from "./BaseRepository.js";
import { DatabaseError } from "../utils/errors.js";
import { paymentMethodToDrawerName } from "../utils/payments.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";

// =============================================================================
// Entity Types
// =============================================================================

export interface DebtLedgerEntity {
  id: number;
  client_id: number;
  transaction_id: number | null;
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
  total_debt_usd: number;
  total_debt_lbp: number;
}

export interface TopDebtor {
  full_name: string;
  total_debt: number;
  total_debt_usd: number;
  total_debt_lbp: number;
}

export interface DebtSummary {
  totalDebt: number;
  totalDebtUsd: number;
  totalDebtLbp: number;
  topDebtors: TopDebtor[];
}

export interface CreateRepaymentData {
  client_id: number;
  amount_usd: number;
  amount_lbp: number;
  note?: string | null;
  created_by?: number | null;
  paid_by_method?: string;
}

// =============================================================================
// Debt Repository Class
// =============================================================================

export class DebtRepository extends BaseRepository<DebtLedgerEntity> {
  constructor() {
    super("debt_ledger", { softDelete: false });
  }

  // Override getColumns() to use explicit columns instead of SELECT *
  protected getColumns(): string {
    return "id, client_id, transaction_type, amount_usd, amount_lbp, transaction_id, note, created_at, created_by";
  }

  // ---------------------------------------------------------------------------
  // Debtor Queries
  // ---------------------------------------------------------------------------

  /**
   * Get the current exchange rate for a currency pair.
   * Defaults to USD→LBP for backward compatibility.
   */
  private getExchangeRate(fromCode = "USD", toCode = "LBP"): number {
    const rateResult = this.db
      .prepare(
        `SELECT rate FROM exchange_rates WHERE from_code = ? AND to_code = ? LIMIT 1`,
      )
      .get(fromCode, toCode) as { rate: number } | undefined;
    if (!rateResult) {
      throw new DatabaseError(
        `No exchange rate found for ${fromCode}→${toCode}`,
      );
    }
    return rateResult.rate;
  }

  /**
   * Get all clients with their debt totals (grouped)
   */
  findAllDebtors(): DebtorSummary[] {
    // Use exchange rate to convert LBP portion into USD for consistent totals
    const rate = this.getExchangeRate("USD", "LBP");

    const stmt = this.db.prepare(`
      SELECT 
        c.id, 
        c.full_name, 
        c.phone_number,
        ROUND(COALESCE(SUM(dl.amount_usd), 0) + (COALESCE(SUM(dl.amount_lbp), 0) / ?), 2) as total_debt,
        ROUND(COALESCE(SUM(dl.amount_usd), 0), 2) as total_debt_usd,
        ROUND(COALESCE(SUM(dl.amount_lbp), 0), 2) as total_debt_lbp
      FROM debt_ledger dl
      JOIN clients c ON dl.client_id = c.id
      GROUP BY c.id
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
      SELECT ${this.getColumns()} FROM debt_ledger 
      WHERE client_id = ? 
      ORDER BY created_at DESC
    `);
    return stmt.all(clientId) as DebtLedgerEntity[];
  }

  /**
   * Get total debt for a specific client
   */
  getClientDebtTotal(clientId: number): number {
    const rate = this.getExchangeRate("USD", "LBP");

    const stmt = this.db.prepare(
      `SELECT ROUND(COALESCE(SUM(amount_usd), 0) + (COALESCE(SUM(amount_lbp), 0) / ?), 2) as total 
       FROM debt_ledger 
       WHERE client_id = ?`,
    );
    const result = stmt.get(rate, clientId) as { total: number | null };
    return result?.total || 0;
  }

  // ---------------------------------------------------------------------------
  // Repayment Operations
  // ---------------------------------------------------------------------------

  /**
   * Add a repayment entry (stored as negative values to reduce debt)
   * Wrapped in transaction to ensure atomicity with payments and drawer updates
   */
  addRepayment(data: CreateRepaymentData): { id: number } {
    return this.transaction(() => {
      // 1. Insert debt ledger entry
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
        data.created_by || null,
      );

      const repaymentId = Number(result.lastInsertRowid);

      // Create unified transaction row
      const txnId = getTransactionRepository().createTransaction({
        type: TRANSACTION_TYPES.DEBT_REPAYMENT,
        source_table: "debt_ledger",
        source_id: repaymentId,
        user_id: data.created_by || 1,
        amount_usd: data.amount_usd,
        amount_lbp: data.amount_lbp,
        client_id: data.client_id,
        summary: `Debt Repayment: $${data.amount_usd} + ${data.amount_lbp} LBP`,
        metadata_json: {
          paid_by: data.paid_by_method || "CASH",
        },
      });

      // Link debt_ledger row to unified transaction
      this.db
        .prepare(`UPDATE debt_ledger SET transaction_id = ? WHERE id = ?`)
        .run(txnId, repaymentId);

      // 2. Record payment entries for drawer tracking
      const insertPayment = this.db.prepare(`
        INSERT INTO payments (
          transaction_id, method, drawer_name, currency_code, amount, note, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      // 3. Update drawer balances
      const upsertBalance = this.db.prepare(`
        INSERT INTO drawer_balances (drawer_name, currency_code, balance)
        VALUES (?, ?, ?)
        ON CONFLICT(drawer_name, currency_code) DO UPDATE SET
          balance = drawer_balances.balance + excluded.balance,
          updated_at = CURRENT_TIMESTAMP
      `);

      // Resolve drawer from payment method (defaults to CASH → General)
      const paidBy = data.paid_by_method || "CASH";
      const drawerName = paymentMethodToDrawerName(paidBy);

      if (data.amount_usd > 0) {
        insertPayment.run(
          txnId,
          paidBy,
          drawerName,
          "USD",
          data.amount_usd,
          data.note || "Debt repayment",
          data.created_by || null,
        );
        upsertBalance.run(drawerName, "USD", data.amount_usd);
      }

      if (data.amount_lbp > 0) {
        insertPayment.run(
          txnId,
          paidBy,
          drawerName,
          "LBP",
          data.amount_lbp,
          data.note || "Debt repayment",
          data.created_by || null,
        );
        upsertBalance.run(drawerName, "LBP", data.amount_lbp);
      }

      return { id: repaymentId };
    });
  }

  // ---------------------------------------------------------------------------
  // Dashboard Queries
  // ---------------------------------------------------------------------------

  /**
   * Get debt summary for dashboard (total debt + top debtors)
   */
  getDebtSummary(topN: number = 5): DebtSummary {
    // Total debt receivable
    const rate = this.getExchangeRate("USD", "LBP");

    const totalDebtResult = this.db
      .prepare(
        `
      SELECT 
        ROUND(COALESCE(SUM(amount_usd), 0) + (COALESCE(SUM(amount_lbp), 0) / ?), 2) as totalDebt,
        ROUND(COALESCE(SUM(amount_usd), 0), 2) as totalDebtUsd,
        ROUND(COALESCE(SUM(amount_lbp), 0), 2) as totalDebtLbp
      FROM debt_ledger
    `,
      )
      .get(rate) as {
      totalDebt: number | null;
      totalDebtUsd: number | null;
      totalDebtLbp: number | null;
    };

    // Top N debtors (only those with positive debt)
    const topDebtors = this.db
      .prepare(
        `
      SELECT 
        c.full_name,
        ROUND(COALESCE(SUM(dl.amount_usd), 0) + (COALESCE(SUM(dl.amount_lbp), 0) / ?), 2) as total_debt,
        ROUND(COALESCE(SUM(dl.amount_usd), 0), 2) as total_debt_usd,
        ROUND(COALESCE(SUM(dl.amount_lbp), 0), 2) as total_debt_lbp
      FROM debt_ledger dl
      JOIN clients c ON dl.client_id = c.id
      GROUP BY dl.client_id
      HAVING total_debt > 0.01
      ORDER BY total_debt DESC
      LIMIT ?
    `,
      )
      .all(rate, topN) as TopDebtor[];

    return {
      totalDebt: totalDebtResult?.totalDebt || 0,
      totalDebtUsd: totalDebtResult?.totalDebtUsd || 0,
      totalDebtLbp: totalDebtResult?.totalDebtLbp || 0,
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
