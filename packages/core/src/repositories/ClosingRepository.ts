import { BaseRepository } from "./BaseRepository.js";
import { closingLogger } from "../utils/logger.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";

/**
 * Payments-journal method used for the balance adjustment posted when a
 * checkpoint's physical count differs from the live drawer balance. It is a
 * real (non-CUSTOMER_ACCOUNT) method so it is included in drawer-balance
 * recalculations.
 */
const CHECKPOINT_ADJUSTMENT_METHOD = "CHECKPOINT_ADJUSTMENT";

/** Sub-cent threshold below which a reconciliation delta is treated as zero. */
const RECONCILE_EPSILON = 0.0001;

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

export interface CheckpointAmount {
  drawer_name: string;
  currency_code: string;
  expected_amount: number;
  physical_amount: number;
}

export interface CreateCheckpointData {
  user_id: number;
  drawer_name: string;
  notes?: string;
  report_path?: string;
  amounts: CheckpointAmount[];
}

export interface DrawerCheckpointStatus {
  drawer_name: string;
  checked_at: string;
  amounts: Record<string, { physical: number; expected: number }>;
}

export interface CheckpointCurrency {
  currency_code: string;
  opening_amount: number;
  physical_amount?: number;
  variance?: number;
}

export interface CheckpointRecord {
  id: number;
  closing_date: string;
  drawer_name: string;
  checkpoint_type: "OPENING" | "CLOSING" | "CHECKPOINT";
  created_at: string;
  created_by: number;
  user_name: string;
  notes?: string;
  currencies: CheckpointCurrency[];
}

export interface CheckpointFilters {
  date_from?: string;
  date_to?: string;
  type?: "OPENING" | "CLOSING" | "CHECKPOINT" | "ALL";
  drawer_name?: string;
  user_id?: number;
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
        WHERE method != 'CUSTOMER_ACCOUNT'
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
   * Check whether any drawer has a non-zero balance (i.e. initial amounts have
   * been seeded at least once). Returns false on a fresh DB with all-zero balances.
   */
  hasInitialBalancesSet(): boolean {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) as cnt FROM drawer_balances WHERE balance != 0`,
      )
      .get() as { cnt: number };
    return row.cnt > 0;
  }

  /**
   * Get the actual amounts from the most recent checkpoint.
   * Returns Record<drawerName, Record<currencyCode, physicalAmount>>
   * Used as baseline for the next checkpoint.
   */
  getLastCheckpointActuals(): Record<string, Record<string, number>> {
    const lastCheckpoint = this.db
      .prepare(`SELECT id FROM daily_closings ORDER BY id DESC LIMIT 1`)
      .get() as { id: number } | undefined;

    if (!lastCheckpoint) return {};

    const amounts = this.db
      .prepare(
        `SELECT drawer_name, currency_code, physical_amount
         FROM daily_closing_amounts
         WHERE closing_id = ? AND physical_amount IS NOT NULL`,
      )
      .all(lastCheckpoint.id) as {
      drawer_name: string;
      currency_code: string;
      physical_amount: number;
    }[];

    const result: Record<string, Record<string, number>> = {};
    for (const row of amounts) {
      if (!result[row.drawer_name]) result[row.drawer_name] = {};
      result[row.drawer_name][row.currency_code] = row.physical_amount;
    }
    return result;
  }

  /**
   * Create a unified checkpoint record.
   * Records both expected and actual (physical) amounts per drawer/currency.
   */
  createCheckpoint(data: CreateCheckpointData): {
    success: boolean;
    id?: number | bigint;
    error?: string;
  } {
    try {
      const closingDate = new Date().toISOString().split("T")[0];

      const stmt = this.db.prepare(`
        INSERT INTO daily_closings (
          closing_date, drawer_name, opening_balance_usd, opening_balance_lbp,
          physical_usd, physical_lbp, physical_eur, system_expected_usd,
          system_expected_lbp, variance_usd, notes, report_path, created_by
        ) VALUES (?, ?, 0, 0, 0, 0, 0, 0, 0, 0, ?, ?, ?)
      `);
      const result = stmt.run(
        closingDate,
        data.drawer_name,
        data.notes || null,
        data.report_path || null,
        data.user_id,
      );

      const upsertAmounts = this.db.prepare(`
        INSERT INTO daily_closing_amounts (closing_id, drawer_name, currency_code, opening_amount, physical_amount)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(closing_id, drawer_name, currency_code) DO UPDATE SET
          opening_amount = excluded.opening_amount,
          physical_amount = excluded.physical_amount
      `);

      // Reconciliation: a checkpoint's physical count becomes the new truth for
      // the drawer. For each currency we post the delta (physical − live
      // balance) to the payments journal and bump drawer_balances, so the
      // dashboard reflects the counted amount. Currencies whose count already
      // matches the balance produce a zero delta and are skipped.
      const getBalance = this.db.prepare(
        `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?`,
      );
      const upsertBalance = this.db.prepare(`
        INSERT INTO drawer_balances (drawer_name, currency_code, balance)
        VALUES (?, ?, ?)
        ON CONFLICT(drawer_name, currency_code) DO UPDATE SET
          balance = drawer_balances.balance + excluded.balance,
          updated_at = CURRENT_TIMESTAMP
      `);
      const insertPayment = this.db.prepare(`
        INSERT INTO payments (transaction_id, method, drawer_name, currency_code, amount, note, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      const tx = this.db.transaction((rows: CheckpointAmount[]) => {
        // 1. Persist the audit snapshot (expected vs physical) for variance reports.
        for (const r of rows) {
          upsertAmounts.run(
            result.lastInsertRowid,
            r.drawer_name,
            r.currency_code,
            r.expected_amount,
            r.physical_amount,
          );
        }

        // 2. Compute per-currency reconciliation deltas against live balances.
        const adjustments = rows
          .map((r) => {
            const existing = getBalance.get(r.drawer_name, r.currency_code) as
              | { balance: number }
              | undefined;
            const current = existing?.balance ?? 0;
            return {
              drawer_name: r.drawer_name,
              currency_code: r.currency_code,
              delta: r.physical_amount - current,
            };
          })
          .filter((a) => Math.abs(a.delta) > RECONCILE_EPSILON);

        const netUsd = adjustments
          .filter((a) => a.currency_code === "USD")
          .reduce((sum, a) => sum + a.delta, 0);
        const netLbp = adjustments
          .filter((a) => a.currency_code === "LBP")
          .reduce((sum, a) => sum + a.delta, 0);

        // 3. Anchor the audit snapshot and reconciliation to one CHECKPOINT
        //    transaction. Its headline amounts are the net journal movement.
        const txnId = getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.CHECKPOINT,
          source_table: "daily_closings",
          source_id: Number(result.lastInsertRowid),
          user_id: data.user_id,
          amount_usd: netUsd,
          amount_lbp: netLbp,
          summary: `Checkpoint: ${data.drawer_name} for ${closingDate}`,
          metadata_json: { amounts: data.amounts, adjustments, notes: data.notes },
        });

        // 4. Post the reconciliation entries to the journal + live balances.
        for (const a of adjustments) {
          insertPayment.run(
            txnId,
            CHECKPOINT_ADJUSTMENT_METHOD,
            a.drawer_name,
            a.currency_code,
            a.delta,
            `Checkpoint reconciliation for ${closingDate}`,
            data.user_id,
          );
          upsertBalance.run(a.drawer_name, a.currency_code, a.delta);
        }
      });
      tx(data.amounts);

      closingLogger.info(
        { closingDate, id: result.lastInsertRowid },
        `Checkpoint created for ${closingDate}`,
      );
      return { success: true, id: result.lastInsertRowid };
    } catch (error) {
      closingLogger.error({ error, data }, "Failed to create checkpoint");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
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

  /**
   * Check if there is at least one checkpoint record in daily_closings for today's date.
   */
  hasOpeningBalanceToday(): boolean {
    const today = new Date().toISOString().split("T")[0];
    const row = this.db
      .prepare(`SELECT 1 FROM daily_closings WHERE closing_date = ? LIMIT 1`)
      .get(today);
    return row !== undefined;
  }

  /**
   * Update an existing daily_closings record by id.
   */
  updateDailyClosing(data: {
    id: number;
    physical_usd?: number;
    physical_lbp?: number;
    physical_eur?: number;
    system_expected_usd?: number;
    system_expected_lbp?: number;
    variance_usd?: number;
    notes?: string;
    report_path?: string;
    user_id?: number;
  }): { success: boolean; error?: string } {
    try {
      const stmt = this.db.prepare(`
        UPDATE daily_closings SET
          physical_usd          = COALESCE(?, physical_usd),
          physical_lbp          = COALESCE(?, physical_lbp),
          physical_eur          = COALESCE(?, physical_eur),
          system_expected_usd   = COALESCE(?, system_expected_usd),
          system_expected_lbp   = COALESCE(?, system_expected_lbp),
          variance_usd          = COALESCE(?, variance_usd),
          notes                 = COALESCE(?, notes),
          report_path           = COALESCE(?, report_path),
          updated_by            = COALESCE(?, updated_by),
          updated_at            = CURRENT_TIMESTAMP
        WHERE id = ?
      `);

      const result = stmt.run(
        data.physical_usd ?? null,
        data.physical_lbp ?? null,
        data.physical_eur ?? null,
        data.system_expected_usd ?? null,
        data.system_expected_lbp ?? null,
        data.variance_usd ?? null,
        data.notes ?? null,
        data.report_path ?? null,
        data.user_id ?? null,
        data.id,
      );

      if (result.changes === 0) {
        return { success: false, error: `No record found with id ${data.id}` };
      }

      closingLogger.info({ id: data.id }, "Daily closing updated");
      return { success: true };
    } catch (error) {
      closingLogger.error({ error, data }, "Failed to update daily closing");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get raw amounts for a specific checkpoint.
   */
  getCheckpointAmounts(checkpointId: number): Array<{
    drawer_name: string;
    currency_code: string;
    opening_amount: number;
    physical_amount: number;
  }> {
    return this.query<{
      drawer_name: string;
      currency_code: string;
      opening_amount: number;
      physical_amount: number;
    }>(
      `SELECT drawer_name, currency_code, opening_amount, physical_amount
       FROM daily_closing_amounts
       WHERE closing_id = ?
       ORDER BY drawer_name, currency_code`,
      checkpointId,
    );
  }

  /**
   * Get checkpoint timeline for a date
   */
  getCheckpointTimeline(filters: CheckpointFilters = {}): CheckpointRecord[] {
    const today = new Date().toISOString().split("T")[0];
    const {
      date_from = today,
      date_to = today,
      type = "ALL",
      drawer_name,
      user_id,
    } = filters;

    let sql = `
      SELECT
        dc.id,
        dc.closing_date,
        dc.drawer_name,
        dc.notes,
        dc.created_at,
        dc.created_by,
        COALESCE(u.username, 'Unknown') as user_name,
        CASE
          WHEN t.type = 'OPENING' THEN 'OPENING'
          WHEN t.type = 'CLOSING' THEN 'CLOSING'
          WHEN t.type = 'CHECKPOINT' THEN 'CHECKPOINT'
          ELSE 'CHECKPOINT'
        END as checkpoint_type
      FROM daily_closings dc
      LEFT JOIN users u ON u.id = dc.created_by
      LEFT JOIN transactions t ON t.source_table = 'daily_closings' AND t.source_id = dc.id
      WHERE dc.closing_date BETWEEN ? AND ?
    `;

    const params: (string | number)[] = [date_from, date_to];

    if (type !== "ALL") {
      sql += ` AND t.type = ?`;
      params.push(type);
    }

    if (drawer_name) {
      sql += ` AND dc.drawer_name = ?`;
      params.push(drawer_name);
    }

    if (user_id) {
      sql += ` AND dc.created_by = ?`;
      params.push(user_id);
    }

    sql += ` ORDER BY dc.created_at DESC`;

    const checkpoints = this.query<CheckpointRecord>(sql, ...params);

    // Load full per-drawer breakdown for each checkpoint (NOT aggregated)
    for (const checkpoint of checkpoints) {
      const amounts = this.query<{
        drawer_name: string;
        currency_code: string;
        opening_amount: number;
        physical_amount: number;
      }>(
        `SELECT drawer_name, currency_code, opening_amount, physical_amount 
         FROM daily_closing_amounts 
         WHERE closing_id = ?
         ORDER BY drawer_name, currency_code`,
        checkpoint.id,
      );

      checkpoint.currencies = amounts.map((a: any) => ({
        currency_code: a.currency_code,
        opening_amount: a.opening_amount || 0,
        physical_amount:
          a.physical_amount && a.physical_amount > 0
            ? a.physical_amount
            : undefined,
        variance:
          a.physical_amount && a.physical_amount > 0
            ? a.physical_amount - a.opening_amount
            : undefined,
        drawer_name: a.drawer_name, // Keep drawer info for modal
      }));
    }

    return checkpoints;
  }

  /**
   * Get the most recent checkpoint for each drawer (excluding AGGREGATED rows).
   * Returns Record<drawerName, DrawerCheckpointStatus>
   */
  getLastCheckpointPerDrawer(): Record<string, DrawerCheckpointStatus> {
    // Checkpoints are stored as AGGREGATED rows in daily_closings, with
    // per-drawer amounts in daily_closing_amounts. Group by the amounts
    // table's drawer_name to find the latest checkpoint per drawer.
    const rows = this.db
      .prepare(
        `SELECT dc.created_at as checked_at,
                dca.drawer_name, dca.currency_code, dca.physical_amount, dca.opening_amount
         FROM daily_closing_amounts dca
         JOIN daily_closings dc ON dc.id = dca.closing_id
         WHERE dca.closing_id IN (
           SELECT MAX(dca2.closing_id)
           FROM daily_closing_amounts dca2
           GROUP BY dca2.drawer_name
         )
         ORDER BY dca.drawer_name, dca.currency_code`,
      )
      .all() as {
      drawer_name: string;
      checked_at: string;
      currency_code: string;
      physical_amount: number;
      opening_amount: number;
    }[];

    const result: Record<string, DrawerCheckpointStatus> = {};
    for (const row of rows) {
      if (!result[row.drawer_name]) {
        result[row.drawer_name] = {
          drawer_name: row.drawer_name,
          checked_at: row.checked_at,
          amounts: {},
        };
      }
      result[row.drawer_name].amounts[row.currency_code] = {
        physical: row.physical_amount,
        expected: row.opening_amount,
      };
    }
    return result;
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
