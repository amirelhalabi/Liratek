import { BaseRepository } from "./BaseRepository.js";
import { closingLogger } from "../utils/logger.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";

export interface DailyClosingEntity {
  id: number;
  closing_date: string;
  drawer_name: string;
  opening_balance_usd: number;
  opening_balance_lbp: number;
  physical_usd?: number;
  physical_lbp?: number;
  physical_eur?: number;
  system_expected_usd?: number;
  system_expected_lbp?: number;
  variance_usd?: number;
  notes?: string | null;
  report_path?: string | null;
  updated_by?: number;
  created_at?: string;
  updated_at?: string;
}

export interface ClosingAmountEntity {
  id?: number;
  closing_id: number;
  drawer_name: string;
  currency_code: string;
  opening_amount: number;
  physical_amount: number;
}

/**
 * Dynamic system expected balances: Record<drawerName, Record<currencyCode, balance>>
 * Example: { "General": { "USD": 123, "LBP": 456 }, "MTC": { "USD": 789 } }
 */
export type DynamicSystemExpectedBalances = Record<
  string,
  Record<string, number>
>;

export interface DailyStatsSnapshot {
  salesCount: number;
  totalSalesUSD: number;
  totalSalesLBP: number;
  debtPaymentsUSD: number;
  debtPaymentsLBP: number;
  totalExpensesUSD: number;
  totalExpensesLBP: number;
  totalProfitUSD: number;
}

export interface OpeningBalanceAmount {
  drawer_name: string;
  currency_code: string;
  opening_amount: number;
}

export interface ClosingAmount {
  drawer_name: string;
  currency_code: string;
  physical_amount: number;
  opening_amount?: number;
}

export class ClosingRepository extends BaseRepository<DailyClosingEntity> {
  constructor() {
    super("daily_closings");
  }

  // Override getColumns() to use explicit columns instead of SELECT *
  protected getColumns(): string {
    return "id, closing_date, drawer_name, opening_balance_usd, opening_balance_lbp, physical_usd, physical_lbp, physical_eur, system_expected_usd, system_expected_lbp, variance_usd, notes";
  }

  /**
   * Find existing closing record for a date
   */
  findByDate(closingDate: string): DailyClosingEntity | undefined {
    return this.db
      .prepare(
        `SELECT id FROM daily_closings WHERE closing_date = ? AND drawer_name = 'AGGREGATED'`,
      )
      .get(closingDate) as DailyClosingEntity | undefined;
  }

  /**
   * Set opening balances for a date
   */
  setOpeningBalances(
    closingDate: string,
    amounts: OpeningBalanceAmount[],
    userId: number,
  ): { success: boolean; id?: number | bigint; error?: string } {
    try {
      const exists = this.findByDate(closingDate);

      const upsertAmounts = this.db.prepare(`
        INSERT INTO daily_closing_amounts (closing_id, drawer_name, currency_code, opening_amount, physical_amount)
        VALUES (?, ?, ?, ?, 0)
        ON CONFLICT(closing_id, drawer_name, currency_code) DO UPDATE SET opening_amount=excluded.opening_amount
      `);

      if (exists && exists.id) {
        const tx = this.db.transaction((rows: OpeningBalanceAmount[]) => {
          for (const r of rows) {
            upsertAmounts.run(
              exists.id,
              r.drawer_name,
              r.currency_code,
              r.opening_amount,
            );
          }
        });
        tx(amounts);

        // Create unified transaction row for opening balances
        getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.OPENING,
          source_table: "daily_closings",
          source_id: exists.id as number,
          user_id: userId,
          amount_usd: 0,
          amount_lbp: 0,
          summary: `Opening balances set for ${closingDate}`,
          metadata_json: { opening: amounts },
        });
        return { success: true, id: exists.id };
      } else {
        const stmt = this.db.prepare(`
          INSERT INTO daily_closings (
            closing_date, drawer_name, opening_balance_usd, opening_balance_lbp, physical_eur, notes
          ) VALUES (?, 'AGGREGATED', 0, 0, 0, 'Opening set')
        `);
        const res = stmt.run(closingDate);

        const tx = this.db.transaction((rows: OpeningBalanceAmount[]) => {
          for (const r of rows) {
            upsertAmounts.run(
              res.lastInsertRowid,
              r.drawer_name,
              r.currency_code,
              r.opening_amount,
            );
          }
        });
        tx(amounts);

        // Create unified transaction row for opening balances
        getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.OPENING,
          source_table: "daily_closings",
          source_id: Number(res.lastInsertRowid),
          user_id: userId,
          amount_usd: 0,
          amount_lbp: 0,
          summary: `Opening balances set for ${closingDate}`,
          metadata_json: { opening: amounts },
        });

        return { success: true, id: res.lastInsertRowid };
      }
    } catch (error) {
      closingLogger.error(
        { error, closingDate, amounts },
        "Failed to set opening balances",
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Create a daily closing record
   */
  createDailyClosing(
    closingDate: string,
    amounts: ClosingAmount[],
    systemExpectedUsd: number,
    systemExpectedLbp: number,
    varianceNotes?: string,
    reportPath?: string,
  ): { success: boolean; id?: number | bigint; error?: string } {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO daily_closings (
          closing_date, drawer_name, opening_balance_usd, opening_balance_lbp,
          physical_usd, physical_lbp, physical_eur, system_expected_usd,
          system_expected_lbp, variance_usd, notes, report_path
        ) VALUES (?, 'AGGREGATED', 0, 0, 0, 0, 0, ?, ?, 0, ?, ?)
      `);
      const result = stmt.run(
        closingDate,
        systemExpectedUsd || 0,
        systemExpectedLbp || 0,
        varianceNotes || null,
        reportPath || null,
      );

      const upsertAmounts = this.db.prepare(`
        INSERT INTO daily_closing_amounts (closing_id, drawer_name, currency_code, opening_amount, physical_amount)
        VALUES (?, ?, ?, COALESCE(?,0), COALESCE(?,0))
        ON CONFLICT(closing_id, drawer_name, currency_code) DO UPDATE SET 
          physical_amount=excluded.physical_amount, 
          opening_amount=COALESCE(daily_closing_amounts.opening_amount, excluded.opening_amount)
      `);

      const tx = this.db.transaction((rows: ClosingAmount[]) => {
        for (const r of rows) {
          upsertAmounts.run(
            result.lastInsertRowid,
            r.drawer_name,
            r.currency_code,
            r.opening_amount,
            r.physical_amount,
          );
        }
      });
      tx(amounts);

      // Create unified transaction row for daily closing
      getTransactionRepository().createTransaction({
        type: TRANSACTION_TYPES.CLOSING,
        source_table: "daily_closings",
        source_id: Number(result.lastInsertRowid),
        user_id: 1,
        amount_usd: systemExpectedUsd || 0,
        amount_lbp: systemExpectedLbp || 0,
        summary: `Daily closing for ${closingDate}`,
        metadata_json: { amounts },
      });

      closingLogger.info(
        { closingDate, id: result.lastInsertRowid },
        `Daily closing created for ${closingDate}`,
      );
      return { success: true, id: result.lastInsertRowid };
    } catch (error) {
      closingLogger.error(
        { error, closingDate, amounts },
        "Failed to create daily closing",
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Update an existing daily closing
   */
  updateDailyClosing(
    id: number,
    data: Partial<DailyClosingEntity>,
  ): { success: boolean; error?: string } {
    try {
      const current = this.db
        .prepare(`SELECT ${this.getColumns()} FROM daily_closings WHERE id = ?`)
        .get(id);
      if (!current) return { success: false, error: "Not found" };

      const stmt = this.db.prepare(`
        UPDATE daily_closings SET
          physical_usd = COALESCE(?, physical_usd),
          physical_lbp = COALESCE(?, physical_lbp),
          physical_eur = COALESCE(?, physical_eur),
          system_expected_usd = COALESCE(?, system_expected_usd),
          system_expected_lbp = COALESCE(?, system_expected_lbp),
          variance_usd = COALESCE(?, variance_usd),
          notes = COALESCE(?, notes),
          report_path = COALESCE(?, report_path),
          updated_by = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);
      stmt.run(
        data.physical_usd,
        data.physical_lbp,
        data.physical_eur,
        data.system_expected_usd,
        data.system_expected_lbp,
        data.variance_usd,
        data.notes,
        data.report_path,
        data.updated_by || 1,
        id,
      );
      return { success: true };
    } catch (error) {
      closingLogger.error(
        { error, id, data },
        "Failed to update daily closing",
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get system expected balances for all drawers and currencies (fully dynamic).
   * Returns Record<drawerName, Record<currencyCode, balance>>
   */
  getSystemExpectedBalancesDynamic(): DynamicSystemExpectedBalances {
    const rows = this.db
      .prepare(
        `SELECT drawer_name, currency_code, balance FROM drawer_balances`,
      )
      .all() as {
      drawer_name: string;
      currency_code: string;
      balance: number;
    }[];

    const result: DynamicSystemExpectedBalances = {};
    for (const row of rows) {
      if (!result[row.drawer_name]) result[row.drawer_name] = {};
      result[row.drawer_name][row.currency_code] = row.balance;
    }
    return result;
  }

  /**
   * Recalculate drawer_balances from the payments journal.
   * The payments table is an append-only log of every signed amount that
   * flowed through each drawer, so SUM(amount) per (drawer, currency) gives
   * the correct running total.
   */
  recalculateDrawerBalances(): { success: boolean; error?: string } {
    try {
      this.db.exec(`
        UPDATE drawer_balances SET balance = 0, updated_at = CURRENT_TIMESTAMP;

        INSERT INTO drawer_balances (drawer_name, currency_code, balance)
        SELECT drawer_name, currency_code, SUM(amount)
        FROM payments
        GROUP BY drawer_name, currency_code
        ON CONFLICT(drawer_name, currency_code) DO UPDATE SET
          balance = excluded.balance,
          updated_at = CURRENT_TIMESTAMP;
      `);
      closingLogger.info("Drawer balances recalculated from payments journal");
      return { success: true };
    } catch (error) {
      closingLogger.error({ error }, "Failed to recalculate drawer balances");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Check if opening balance exists for a specific date
   */
  hasOpeningBalanceForDate(date: string): boolean {
    const sql = `
      SELECT COUNT(*) as count 
      FROM daily_closing_amounts ca
      JOIN daily_closings dc ON dc.id = ca.closing_id
      WHERE dc.closing_date = ? AND ca.opening_amount IS NOT NULL
    `;
    const result = this.db.prepare(sql).get(date) as { count: number };
    return result.count > 0;
  }

  /**
   * Get daily stats snapshot for closing report
   */
  getDailyStatsSnapshot(): DailyStatsSnapshot {
    const today = new Date().toISOString().split("T")[0];

    // Sales stats
    const salesStats = this.db
      .prepare(
        `SELECT
          COUNT(id) as sales_count,
          SUM(final_amount_usd) as total_sales_usd,
          SUM(paid_lbp) as total_sales_lbp
         FROM sales
         WHERE DATE(created_at) = ? AND status = 'completed'`,
      )
      .get(today) as
      | {
          sales_count: number;
          total_sales_usd: number;
          total_sales_lbp: number;
        }
      | undefined;

    // Debt payments
    const debtPayments = this.db
      .prepare(
        `SELECT
          SUM(ABS(amount_usd)) as total_debt_payments_usd,
          SUM(ABS(amount_lbp)) as total_debt_payments_lbp
         FROM debt_ledger
         WHERE DATE(created_at) = ? AND transaction_type = 'Repayment'`,
      )
      .get(today) as
      | { total_debt_payments_usd: number; total_debt_payments_lbp: number }
      | undefined;

    // Expenses
    const expensesStats = this.db
      .prepare(
        `SELECT
          SUM(amount_usd) as total_expenses_usd,
          SUM(amount_lbp) as total_expenses_lbp
         FROM expenses
         WHERE DATE(expense_date) = ?`,
      )
      .get(today) as
      | { total_expenses_usd: number; total_expenses_lbp: number }
      | undefined;

    // Profit — aggregate across all revenue modules
    const salesProfit = this.db
      .prepare(
        `SELECT
          COALESCE(SUM(si.sold_price_usd - si.cost_price_snapshot_usd), 0) as profit_usd
         FROM sales s
         JOIN sale_items si ON s.id = si.sale_id
         WHERE DATE(s.created_at) = ? AND s.status = 'completed'
           AND si.is_refunded = 0
           AND (s.paid_usd + COALESCE(s.paid_lbp, 0) / COALESCE(NULLIF(s.exchange_rate_snapshot, 0), 1)) >= s.final_amount_usd - 0.05`,
      )
      .get(today) as { profit_usd: number };

    const finProfit = this.db
      .prepare(
        `SELECT
          COALESCE(SUM(CASE WHEN currency != 'LBP' THEN commission ELSE 0 END), 0) as profit_usd
         FROM financial_services
         WHERE DATE(created_at) = ?`,
      )
      .get(today) as { profit_usd: number };

    const rechargeProfit = this.db
      .prepare(
        `SELECT
          COALESCE(SUM(CASE WHEN currency_code != 'LBP' THEN (price - cost) ELSE 0 END), 0) as profit_usd
         FROM recharges
         WHERE DATE(created_at) = ?`,
      )
      .get(today) as { profit_usd: number };

    const customProfit = this.db
      .prepare(
        `SELECT
          COALESCE(SUM(profit_usd), 0) as profit_usd
         FROM custom_services
         WHERE DATE(created_at) = ? AND status = 'completed'`,
      )
      .get(today) as { profit_usd: number };

    const maintProfit = this.db
      .prepare(
        `SELECT
          COALESCE(SUM(final_amount_usd - cost_usd), 0) as profit_usd
         FROM maintenance
         WHERE DATE(created_at) = ? AND LOWER(status) = 'completed'`,
      )
      .get(today) as { profit_usd: number };

    const totalProfitUSD =
      salesProfit.profit_usd +
      finProfit.profit_usd +
      rechargeProfit.profit_usd +
      customProfit.profit_usd +
      maintProfit.profit_usd;

    return {
      salesCount: salesStats?.sales_count || 0,
      totalSalesUSD: salesStats?.total_sales_usd || 0,
      totalSalesLBP: salesStats?.total_sales_lbp || 0,
      debtPaymentsUSD: debtPayments?.total_debt_payments_usd || 0,
      debtPaymentsLBP: debtPayments?.total_debt_payments_lbp || 0,
      totalExpensesUSD: expensesStats?.total_expenses_usd || 0,
      totalExpensesLBP: expensesStats?.total_expenses_lbp || 0,
      totalProfitUSD,
    };
  }
}

// Singleton instance
let closingRepositoryInstance: ClosingRepository | null = null;

export function getClosingRepository(): ClosingRepository {
  if (!closingRepositoryInstance) {
    closingRepositoryInstance = new ClosingRepository();
  }
  return closingRepositoryInstance;
}

export function resetClosingRepository(): void {
  closingRepositoryInstance = null;
}
