import { BaseRepository } from "./BaseRepository.js";
export class ClosingRepository extends BaseRepository {
    constructor() {
        super("daily_closings");
    }
    /**
     * Find existing closing record for a date
     */
    findByDate(closingDate) {
        return this.db
            .prepare(`SELECT id FROM daily_closings WHERE closing_date = ? AND drawer_name = 'AGGREGATED'`)
            .get(closingDate);
    }
    /**
     * Set opening balances for a date
     */
    setOpeningBalances(closingDate, amounts, userId) {
        try {
            const exists = this.findByDate(closingDate);
            const upsertAmounts = this.db.prepare(`
        INSERT INTO daily_closing_amounts (closing_id, drawer_name, currency_code, opening_amount, physical_amount)
        VALUES (?, ?, ?, ?, 0)
        ON CONFLICT(closing_id, drawer_name, currency_code) DO UPDATE SET opening_amount=excluded.opening_amount
      `);
            if (exists && exists.id) {
                const upsertBalance = this.db.prepare(`
          INSERT INTO drawer_balances (drawer_name, currency_code, balance)
          VALUES (?, ?, ?)
          ON CONFLICT(drawer_name, currency_code) DO UPDATE SET
            balance=excluded.balance,
            updated_at=CURRENT_TIMESTAMP
        `);
                const tx = this.db.transaction((rows) => {
                    for (const r of rows) {
                        upsertAmounts.run(exists.id, r.drawer_name, r.currency_code, r.opening_amount);
                        // Opening sets the running expected balance baseline
                        upsertBalance.run(r.drawer_name, r.currency_code, r.opening_amount);
                    }
                });
                tx(amounts);
                this.logActivity(userId, "OPENING", { opening: amounts });
                return { success: true, id: exists.id };
            }
            else {
                const stmt = this.db.prepare(`
          INSERT INTO daily_closings (
            closing_date, drawer_name, opening_balance_usd, opening_balance_lbp, physical_eur, notes
          ) VALUES (?, 'AGGREGATED', 0, 0, 0, 'Opening set')
        `);
                const res = stmt.run(closingDate);
                const upsertBalance = this.db.prepare(`
          INSERT INTO drawer_balances (drawer_name, currency_code, balance)
          VALUES (?, ?, ?)
          ON CONFLICT(drawer_name, currency_code) DO UPDATE SET
            balance=excluded.balance,
            updated_at=CURRENT_TIMESTAMP
        `);
                const tx = this.db.transaction((rows) => {
                    for (const r of rows) {
                        upsertAmounts.run(res.lastInsertRowid, r.drawer_name, r.currency_code, r.opening_amount);
                        // Opening sets the running expected balance baseline
                        upsertBalance.run(r.drawer_name, r.currency_code, r.opening_amount);
                    }
                });
                tx(amounts);
                this.logActivity(userId, "OPENING", { opening: amounts });
                return { success: true, id: res.lastInsertRowid };
            }
        }
        catch (error) {
            console.error("Failed to set opening balances:", error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }
    /**
     * Create a daily closing record
     */
    createDailyClosing(closingDate, amounts, systemExpectedUsd, systemExpectedLbp, varianceNotes, reportPath) {
        try {
            const stmt = this.db.prepare(`
        INSERT INTO daily_closings (
          closing_date, drawer_name, opening_balance_usd, opening_balance_lbp,
          physical_usd, physical_lbp, physical_eur, system_expected_usd,
          system_expected_lbp, variance_usd, notes, report_path
        ) VALUES (?, 'AGGREGATED', 0, 0, 0, 0, 0, ?, ?, 0, ?, ?)
      `);
            const result = stmt.run(closingDate, systemExpectedUsd || 0, systemExpectedLbp || 0, varianceNotes || null, reportPath || null);
            const upsertAmounts = this.db.prepare(`
        INSERT INTO daily_closing_amounts (closing_id, drawer_name, currency_code, opening_amount, physical_amount)
        VALUES (?, ?, ?, COALESCE(?,0), COALESCE(?,0))
        ON CONFLICT(closing_id, drawer_name, currency_code) DO UPDATE SET 
          physical_amount=excluded.physical_amount, 
          opening_amount=COALESCE(daily_closing_amounts.opening_amount, excluded.opening_amount)
      `);
            const tx = this.db.transaction((rows) => {
                for (const r of rows) {
                    upsertAmounts.run(result.lastInsertRowid, r.drawer_name, r.currency_code, r.opening_amount, r.physical_amount);
                }
            });
            tx(amounts);
            // Log activity
            this.db
                .prepare(`INSERT INTO activity_logs (user_id, action, table_name, record_id, details_json, created_at)
           VALUES (1, 'CREATE_DAILY_CLOSING', 'daily_closings', ?, ?, CURRENT_TIMESTAMP)`)
                .run(result.lastInsertRowid, JSON.stringify({ amounts }));
            console.log(`[CLOSING] Daily closing created for ${closingDate}`);
            return { success: true, id: result.lastInsertRowid };
        }
        catch (error) {
            console.error("Failed to create daily closing:", error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }
    /**
     * Update an existing daily closing
     */
    updateDailyClosing(id, data) {
        try {
            const current = this.db
                .prepare("SELECT * FROM daily_closings WHERE id = ?")
                .get(id);
            if (!current)
                return { success: false, error: "Not found" };
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
            stmt.run(data.physical_usd, data.physical_lbp, data.physical_eur, data.system_expected_usd, data.system_expected_lbp, data.variance_usd, data.notes, data.report_path, data.updated_by || 1, id);
            return { success: true };
        }
        catch (error) {
            console.error("Failed to update daily closing:", error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }
    /**
     * Get system expected balances for today
     */
    getSystemExpectedBalances() {
        const getBalance = (drawer_name, currency_code) => {
            const row = this.db
                .prepare(`SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?`)
                .get(drawer_name, currency_code);
            return row?.balance ?? 0;
        };
        return {
            generalDrawer: { usd: getBalance("General", "USD"), lbp: getBalance("General", "LBP"), eur: 0 },
            omtDrawer: { usd: getBalance("OMT", "USD"), lbp: getBalance("OMT", "LBP"), eur: 0 },
            whishDrawer: { usd: getBalance("Whish", "USD"), lbp: getBalance("Whish", "LBP"), eur: 0 },
            binanceDrawer: { usd: getBalance("Binance", "USD"), lbp: getBalance("Binance", "LBP"), eur: 0 },
            mtcDrawer: { usd: getBalance("MTC", "USD"), lbp: 0, eur: 0 },
            alfaDrawer: { usd: getBalance("Alfa", "USD"), lbp: 0, eur: 0 },
        };
    }
    /**
     * Check if opening balance exists for a specific date
     */
    hasOpeningBalanceForDate(date) {
        const sql = `
      SELECT COUNT(*) as count 
      FROM closing_amounts 
      WHERE closing_date = ? AND opening_amount IS NOT NULL
    `;
        const result = this.db.prepare(sql).get(date);
        return result.count > 0;
    }
    /**
     * Get daily stats snapshot for closing report
     */
    getDailyStatsSnapshot() {
        const today = new Date().toISOString().split("T")[0];
        // Sales stats
        const salesStats = this.db
            .prepare(`SELECT
          COUNT(id) as sales_count,
          SUM(final_amount_usd) as total_sales_usd,
          SUM(paid_lbp) as total_sales_lbp
         FROM sales
         WHERE DATE(created_at) = ? AND status = 'completed'`)
            .get(today);
        // Debt payments
        const debtPayments = this.db
            .prepare(`SELECT
          SUM(ABS(amount_usd)) as total_debt_payments_usd,
          SUM(ABS(amount_lbp)) as total_debt_payments_lbp
         FROM debt_ledger
         WHERE DATE(created_at) = ? AND transaction_type = 'Repayment'`)
            .get(today);
        // Expenses
        const expensesStats = this.db
            .prepare(`SELECT
          SUM(amount_usd) as total_expenses_usd,
          SUM(amount_lbp) as total_expenses_lbp
         FROM expenses
         WHERE DATE(expense_date) = ?`)
            .get(today);
        // Profit
        const profitStats = this.db
            .prepare(`SELECT
          SUM(si.sold_price_usd - si.cost_price_snapshot_usd) as total_profit_usd
         FROM sales s
         JOIN sale_items si ON s.id = si.sale_id
         WHERE DATE(s.created_at) = ? AND s.status = 'completed'
           AND (s.paid_usd + (s.paid_lbp / s.exchange_rate_snapshot)) >= s.final_amount_usd`)
            .get(today);
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
    logActivity(userId, action, details) {
        this.db
            .prepare(`INSERT INTO activity_logs (user_id, action, details_json, created_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)`)
            .run(userId, action, JSON.stringify(details));
    }
}
// Singleton instance
let closingRepositoryInstance = null;
export function getClosingRepository() {
    if (!closingRepositoryInstance) {
        closingRepositoryInstance = new ClosingRepository();
    }
    return closingRepositoryInstance;
}
export function resetClosingRepository() {
    closingRepositoryInstance = null;
}
