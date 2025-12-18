import { BaseRepository } from "./BaseRepository";

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

export interface DrawerBalances {
  usd: number;
  lbp: number;
  eur: number;
}

export interface SystemExpectedBalances {
  generalDrawer: DrawerBalances;
  omtDrawer: DrawerBalances;
  mtcDrawer: DrawerBalances;
  alfaDrawer: DrawerBalances;
}

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

  /**
   * Find existing closing record for a date
   */
  findByDate(closingDate: string): DailyClosingEntity | undefined {
    return this.db
      .prepare(
        `SELECT id FROM daily_closings WHERE closing_date = ? AND drawer_name = 'AGGREGATED'`
      )
      .get(closingDate) as DailyClosingEntity | undefined;
  }

  /**
   * Set opening balances for a date
   */
  setOpeningBalances(
    closingDate: string,
    amounts: OpeningBalanceAmount[],
    userId: number
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
            upsertAmounts.run(exists.id, r.drawer_name, r.currency_code, r.opening_amount);
          }
        });
        tx(amounts);

        this.logActivity(userId, "OPENING", { opening: amounts });
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
            upsertAmounts.run(res.lastInsertRowid, r.drawer_name, r.currency_code, r.opening_amount);
          }
        });
        tx(amounts);

        this.logActivity(userId, "OPENING", { opening: amounts });
        return { success: true, id: res.lastInsertRowid };
      }
    } catch (error: any) {
      console.error("Failed to set opening balances:", error);
      return { success: false, error: error.message };
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
    varianceNotes?: string
  ): { success: boolean; id?: number | bigint; error?: string } {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO daily_closings (
          closing_date, drawer_name, opening_balance_usd, opening_balance_lbp,
          physical_usd, physical_lbp, physical_eur, system_expected_usd,
          system_expected_lbp, variance_usd, notes
        ) VALUES (?, 'AGGREGATED', 0, 0, 0, 0, 0, ?, ?, 0, ?)
      `);
      const result = stmt.run(
        closingDate,
        systemExpectedUsd || 0,
        systemExpectedLbp || 0,
        varianceNotes || null
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
            r.physical_amount
          );
        }
      });
      tx(amounts);

      // Log activity
      this.db
        .prepare(
          `INSERT INTO activity_logs (user_id, action, table_name, record_id, details_json, created_at)
           VALUES (1, 'CREATE_DAILY_CLOSING', 'daily_closings', ?, ?, CURRENT_TIMESTAMP)`
        )
        .run(result.lastInsertRowid, JSON.stringify({ amounts }));

      console.log(`[CLOSING] Daily closing created for ${closingDate}`);
      return { success: true, id: result.lastInsertRowid };
    } catch (error: any) {
      console.error("Failed to create daily closing:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update an existing daily closing
   */
  updateDailyClosing(
    id: number,
    data: Partial<DailyClosingEntity>
  ): { success: boolean; error?: string } {
    try {
      const current = this.db
        .prepare("SELECT * FROM daily_closings WHERE id = ?")
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
        id
      );
      return { success: true };
    } catch (error: any) {
      console.error("Failed to update daily closing:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get system expected balances for today
   */
  getSystemExpectedBalances(): SystemExpectedBalances {
    const today = new Date().toISOString().split("T")[0];

    // Sales
    const salesResult = this.db
      .prepare(
        `SELECT 
          SUM(paid_usd) as total_usd_sales,
          SUM(paid_lbp) as total_lbp_sales
         FROM sales 
         WHERE DATE(created_at) = ? AND status = 'completed'`
      )
      .get(today) as { total_usd_sales: number; total_lbp_sales: number } | undefined;

    // Debt Repayments
    const repaymentsResult = this.db
      .prepare(
        `SELECT 
          SUM(ABS(amount_usd)) as total_usd_repayments,
          SUM(ABS(amount_lbp)) as total_lbp_repayments
         FROM debt_ledger
         WHERE DATE(created_at) = ? AND transaction_type = 'Repayment'`
      )
      .get(today) as { total_usd_repayments: number; total_lbp_repayments: number } | undefined;

    // Expenses
    const expensesResult = this.db
      .prepare(
        `SELECT 
          SUM(amount_usd) as total_usd_expenses,
          SUM(amount_lbp) as total_lbp_expenses
         FROM expenses 
         WHERE DATE(expense_date) = ?`
      )
      .get(today) as { total_usd_expenses: number; total_lbp_expenses: number } | undefined;

    // General Drawer
    const expectedUsd =
      (salesResult?.total_usd_sales || 0) +
      (repaymentsResult?.total_usd_repayments || 0) -
      (expensesResult?.total_usd_expenses || 0);
    const expectedLbp =
      (salesResult?.total_lbp_sales || 0) +
      (repaymentsResult?.total_lbp_repayments || 0) -
      (expensesResult?.total_lbp_expenses || 0);

    // OMT Drawer
    const omtInflows = this.db
      .prepare(
        `SELECT 
          COALESCE(SUM(amount_usd), 0) as total_usd,
          COALESCE(SUM(amount_lbp), 0) as total_lbp
         FROM financial_services
         WHERE DATE(created_at) = ? AND provider = 'OMT' AND service_type = 'RECEIVE'`
      )
      .get(today) as { total_usd: number; total_lbp: number } | undefined;

    const omtOutflows = this.db
      .prepare(
        `SELECT 
          COALESCE(SUM(amount_usd), 0) as total_usd,
          COALESCE(SUM(amount_lbp), 0) as total_lbp
         FROM financial_services
         WHERE DATE(created_at) = ? AND provider = 'OMT' AND service_type = 'SEND'`
      )
      .get(today) as { total_usd: number; total_lbp: number } | undefined;

    const expectedOmtUsd = (omtInflows?.total_usd || 0) - (omtOutflows?.total_usd || 0);
    const expectedOmtLbp = (omtInflows?.total_lbp || 0) - (omtOutflows?.total_lbp || 0);

    // MTC Drawer (recharge sales for Touch)
    // Note: Recharges table may not exist yet - handle gracefully
    let mtcRecharges: { total_usd: number } | undefined;
    let alfaRecharges: { total_usd: number } | undefined;
    
    try {
      mtcRecharges = this.db
        .prepare(
          `SELECT COALESCE(SUM(amount_usd), 0) as total_usd
           FROM recharges
           WHERE DATE(created_at) = ? AND carrier = 'Touch'`
        )
        .get(today) as { total_usd: number } | undefined;
    } catch (error) {
      // Table doesn't exist yet, default to 0
      mtcRecharges = { total_usd: 0 };
    }

    // Alfa Drawer (recharge sales for Alfa)
    try {
      alfaRecharges = this.db
        .prepare(
          `SELECT COALESCE(SUM(amount_usd), 0) as total_usd
           FROM recharges
           WHERE DATE(created_at) = ? AND carrier = 'Alfa'`
        )
        .get(today) as { total_usd: number } | undefined;
    } catch (error) {
      // Table doesn't exist yet, default to 0
      alfaRecharges = { total_usd: 0 };
    }

    return {
      generalDrawer: { usd: expectedUsd, lbp: expectedLbp, eur: 0 },
      omtDrawer: { usd: expectedOmtUsd, lbp: expectedOmtLbp, eur: 0 },
      mtcDrawer: { usd: mtcRecharges?.total_usd || 0, lbp: 0, eur: 0 },
      alfaDrawer: { usd: alfaRecharges?.total_usd || 0, lbp: 0, eur: 0 },
    };
  }

  /**
   * Check if opening balance exists for a specific date
   */
  hasOpeningBalanceForDate(date: string): boolean {
    const sql = `
      SELECT COUNT(*) as count 
      FROM closing_amounts 
      WHERE closing_date = ? AND opening_amount IS NOT NULL
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
         WHERE DATE(created_at) = ? AND status = 'completed'`
      )
      .get(today) as { sales_count: number; total_sales_usd: number; total_sales_lbp: number } | undefined;

    // Debt payments
    const debtPayments = this.db
      .prepare(
        `SELECT
          SUM(ABS(amount_usd)) as total_debt_payments_usd,
          SUM(ABS(amount_lbp)) as total_debt_payments_lbp
         FROM debt_ledger
         WHERE DATE(created_at) = ? AND transaction_type = 'Repayment'`
      )
      .get(today) as { total_debt_payments_usd: number; total_debt_payments_lbp: number } | undefined;

    // Expenses
    const expensesStats = this.db
      .prepare(
        `SELECT
          SUM(amount_usd) as total_expenses_usd,
          SUM(amount_lbp) as total_expenses_lbp
         FROM expenses
         WHERE DATE(expense_date) = ?`
      )
      .get(today) as { total_expenses_usd: number; total_expenses_lbp: number } | undefined;

    // Profit
    const profitStats = this.db
      .prepare(
        `SELECT
          SUM(si.sold_price_usd - si.cost_price_snapshot_usd) as total_profit_usd
         FROM sales s
         JOIN sale_items si ON s.id = si.sale_id
         WHERE DATE(s.created_at) = ? AND s.status = 'completed'
           AND (s.paid_usd + (s.paid_lbp / s.exchange_rate_snapshot)) >= s.final_amount_usd`
      )
      .get(today) as { total_profit_usd: number } | undefined;

    return {
      salesCount: salesStats?.sales_count || 0,
      totalSalesUSD: salesStats?.total_sales_usd || 0,
      totalSalesLBP: salesStats?.total_sales_lbp || 0,
      debtPaymentsUSD: debtPayments?.total_debt_payments_usd || 0,
      debtPaymentsLBP: debtPayments?.total_debt_payments_lbp || 0,
      totalExpensesUSD: expensesStats?.total_expenses_usd || 0,
      totalExpensesLBP: expensesStats?.total_expenses_lbp || 0,
      totalProfitUSD: profitStats?.total_profit_usd || 0,
    };
  }

  /**
   * Log activity
   */
  private logActivity(userId: number, action: string, details: Record<string, unknown>): void {
    this.db
      .prepare(
        `INSERT INTO activity_logs (user_id, action, details_json, created_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)`
      )
      .run(userId, action, JSON.stringify(details));
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
