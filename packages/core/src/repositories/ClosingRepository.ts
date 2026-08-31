import { BaseRepository } from "./BaseRepository.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { closingLogger } from "../utils/logger.js";
import { localDay } from "../utils/localDate.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";
import { applyDrawerDelta, insertPaymentRow } from "./moneyPosting.js";
import {
  getCarrierLineRepository,
  carrierDrawerName,
  type CarrierKey,
} from "./CarrierLineRepository.js";
import {
  activeExpense,
  allocationNotDebtPending,
  cashlessCommissionBatch,
  currentSettlementAllocation,
  embeddedCommission,
  hasCommissionModelColumn,
  hasSettlementAllocationsTable,
  notPartnerPending,
  notRefunded,
} from "./ProfitRepository.js";

/**
 * Payments-journal method used for the balance adjustment posted when a
 * checkpoint's physical count differs from the live drawer balance. It is a
 * real (non-CUSTOMER_ACCOUNT) method so it is included in drawer-balance
 * recalculations.
 */
const CHECKPOINT_ADJUSTMENT_METHOD = "CHECKPOINT_ADJUSTMENT";

/** Sub-cent threshold below which a reconciliation delta is treated as zero. */
const RECONCILE_EPSILON = 0.0001;

/**
 * `carrier_line_movements.reason` written by the checkpoint's per-line
 * credits/validity count. The column is FREE TEXT — verified 2026-08-06
 * against both `create_db.sql` (`reason TEXT NOT NULL`, no CHECK) and
 * migration v141 — so no enum extension was needed for this value.
 */
const CHECKPOINT_MOVEMENT_REASON = "CHECKPOINT";

/**
 * SQL predicate: timestamp column `col` falls on TODAY in machine-local time.
 * Mirrors the `DATE(col,'localtime') = DATE('now','localtime')` convention used
 * across the reporting repositories (SalesRepository, FinancialServiceRepository).
 * Takes NO bind params — the whole comparison is evaluated in SQLite's local
 * timezone, so it never mismatches a UTC-day param near midnight. `'localtime'`
 * follows the machine TZ (Beirut on desktop; pin `TZ=Asia/Beirut` on the web
 * server — see docs/plans/done_plans/LOCAL_BUSINESS_DAY_PLAN.md).
 */
const todayLocal = (col: string): string =>
  `DATE(${col}, 'localtime') = DATE('now', 'localtime')`;

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

/**
 * One shop-owned SIM line counted during a checkpoint (D2, plan Phase 3).
 *
 * Only the COUNTED values travel from the client. `expected_credits` /
 * `expected_expires_at` are read off `carrier_lines` server-side at count
 * time so the audit snapshot cannot be spoofed by a crafted payload, and so
 * the expected value is always the one the delta was actually computed
 * against.
 */
export interface CheckpointCarrierLineCount {
  carrier_line_id: number;
  /** USD credits read off the line. */
  counted_credits: number;
  /** `YYYY-MM-DD` read off the line. Omitted or null = validity was not
   *  counted for this line; the stored expiry is left untouched. A
   *  checkpoint never CLEARS an expiry. */
  counted_expires_at?: string | null;
}

/** A checkpoint's per-line count, joined back to the line for display. */
export interface CheckpointCarrierLineRecord {
  carrier_line_id: number;
  carrier: string;
  phone_number: string;
  label: string | null;
  expected_credits: number;
  counted_credits: number;
  expected_expires_at: string | null;
  counted_expires_at: string | null;
}

export interface CreateCheckpointData {
  user_id: number;
  drawer_name: string;
  notes?: string;
  report_path?: string;
  amounts: CheckpointAmount[];
  /** Per-line SIM counts (MTC/Alfa). Absent/empty on every non-carrier
   *  drawer, which is why the whole feature is additive. */
  carrier_lines?: CheckpointCarrierLineCount[];
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
  /** Per-line SIM counts recorded with this checkpoint (empty on every
   *  non-carrier drawer). Drives the timeline's validity variance. */
  carrier_lines: CheckpointCarrierLineRecord[];
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
   * Memoized guard for whether `financial_services.commission_model` exists
   * (LIRA-158). Mirrors `ProfitRepository`'s own
   * `_hasCommissionModelColumnCache` precedent — the schema cannot change
   * mid-process, so the PRAGMA only needs to run once per repository
   * instance. Feeds {@link embeddedCommission}'s `supported` argument in
   * {@link getDailyStatsSnapshot} so a pre-v148 fixture (no `commission_model`
   * column — e.g. `ClosingRepository.localBusinessDay.test.ts`) degrades to
   * today's legacy-only behavior instead of throwing "no such column".
   */
  private _hasCommissionModelColumnCache: boolean | null = null;
  private _hasCommissionModelColumn(): boolean {
    if (this._hasCommissionModelColumnCache === null) {
      this._hasCommissionModelColumnCache = hasCommissionModelColumn(this.db);
    }
    return this._hasCommissionModelColumnCache;
  }

  /**
   * Memoized guard for whether `settlement_commission_allocations` exists
   * (LIRA-158 D17). Mirrors `_hasCommissionModelColumnCache` immediately
   * above and `ProfitRepository`'s own
   * `_hasSettlementAllocationsTableCache` precedent — the schema cannot
   * change mid-process, so the `sqlite_master` probe only needs to run once
   * per repository instance. Feeds the settlement-day commission source in
   * {@link getDailyStatsSnapshot} so a fixture that predates the table
   * (every existing `getDailyStatsSnapshot` fixture, none of which create
   * it — §5) degrades to the OLD, undifferentiated stamp-only query instead
   * of throwing "no such table".
   */
  private _hasSettlementAllocationsTableCache: boolean | null = null;
  private _hasSettlementAllocationsTable(): boolean {
    if (this._hasSettlementAllocationsTableCache === null) {
      this._hasSettlementAllocationsTableCache = hasSettlementAllocationsTable(
        this.db,
      );
    }
    return this._hasSettlementAllocationsTableCache;
  }

  /**
   * Schema-drift guard, same `sqlite_master` probe shape as
   * `FinancialServiceRepository._hasSettlementAllocationsTable()`. Several
   * `getDailyStatsSnapshot` fixtures (e.g.
   * `ClosingRepository.localBusinessDay.test.ts`) predate the LIRA-158
   * settlement-day commission source added below and never create a
   * `transactions` table at all — every prepare in this method runs
   * unconditionally, so a bare `no such table: transactions` there would kill
   * EVERY test in that file in SETUP even though none of them exercise
   * commission (the exact trap `reference_test_schema_completeness` names).
   * A missing table means no `SUPPLIER_SETTLEMENT`/`REFUND` rows can exist
   * either, so degrading to 0 is also the semantically correct answer, not
   * just a safe one.
   */
  private _hasTransactionsTable(): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'transactions'`,
      )
      .get();
    return row !== undefined;
  }

  /**
   * Get system expected balances for all drawers and currencies (fully dynamic).
   * Returns Record<drawerName, Record<currencyCode, balance>>
   */
  getSystemExpectedBalancesDynamic(): DynamicSystemExpectedBalances {
    const rows = this.db
      .prepare(
        `SELECT drawer_name, currency_code, balance FROM drawer_balances WHERE tenant_id = ?`,
      )
      .all(getCurrentTenantId()) as {
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
      // db.exec cannot bind parameters, so the tenant-scoped rewrite uses two
      // prepared statements run back-to-back (same sequential semantics as the
      // previous multi-statement exec).
      //
      // CQ-3 survey note: this ON CONFLICT is NOT migrated to the shared
      // `applyDrawerDelta` helper. It is a full recompute from the payments
      // journal (SUM(amount) GROUP BY drawer/currency) that OVERWRITES the
      // balance (`balance = excluded.balance`), not an additive signed delta
      // — genuinely different semantics from every other drawer_balances
      // upsert in the codebase. Left as-is.
      const tenantId = getCurrentTenantId();
      this.db
        .prepare(
          `UPDATE drawer_balances SET balance = 0, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ?`,
        )
        .run(tenantId);
      this.db
        .prepare(
          `INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance)
           SELECT ?, drawer_name, currency_code, SUM(amount)
           FROM payments
           WHERE method != 'CUSTOMER_ACCOUNT' AND tenant_id = ?
           GROUP BY drawer_name, currency_code
           ON CONFLICT(tenant_id, drawer_name, currency_code) DO UPDATE SET
             balance = excluded.balance,
             updated_at = CURRENT_TIMESTAMP`,
        )
        .run(tenantId, tenantId);
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
        `SELECT COUNT(*) as cnt FROM drawer_balances WHERE balance != 0 AND tenant_id = ?`,
      )
      .get(getCurrentTenantId()) as { cnt: number };
    return row.cnt > 0;
  }

  /**
   * Get the actual amounts from the most recent checkpoint.
   * Returns Record<drawerName, Record<currencyCode, physicalAmount>>
   * Used as baseline for the next checkpoint.
   */
  getLastCheckpointActuals(): Record<string, Record<string, number>> {
    const tenantId = getCurrentTenantId();
    const lastCheckpoint = this.db
      .prepare(
        `SELECT id FROM daily_closings WHERE tenant_id = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(tenantId) as { id: number } | undefined;

    if (!lastCheckpoint) return {};

    const amounts = this.db
      .prepare(
        `SELECT drawer_name, currency_code, physical_amount
         FROM daily_closing_amounts
         WHERE closing_id = ? AND physical_amount IS NOT NULL AND tenant_id = ?`,
      )
      .all(lastCheckpoint.id, tenantId) as {
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
   *
   * CARRIER LINES (D2, plan §0.1/§0.6 — the sum invariant is BUILT here).
   * When `data.carrier_lines` is non-empty the operator has counted the
   * shop's own MTC/Alfa SIMs. The line is the source of truth and the
   * provider drawer FOLLOWS it, never the reverse:
   *
   *   1. each counted line gets a `carrier_line_movements` row (reason
   *      `CHECKPOINT`, `creditsDelta = counted − stored`) tied to THIS
   *      checkpoint's transaction, plus the absolute counted expiry;
   *   2. the provider drawer's USD counted figure is then OVERWRITTEN with
   *      `getCarrierCreditsSum(carrier)` — the one definition of the sum
   *      (rule 14) — and reconciled through the same delta machinery every
   *      other drawer/currency uses.
   *
   * With one line per carrier the two deltas are numerically identical, so
   * this reads like a detour today; it is written as a SUM so that a second
   * line works without revisiting this method (§0.5 keeps the schema
   * multi-line-capable). The projected sum is computed arithmetically
   * BEFORE the movements are applied — the transaction row must exist first
   * to own them — and then re-read from `getCarrierCreditsSum` afterwards
   * and asserted equal, so an unexpected concurrent write aborts the whole
   * checkpoint rather than silently desynchronising drawer from lines.
   */
  createCheckpoint(data: CreateCheckpointData): {
    success: boolean;
    id?: number | bigint;
    error?: string;
  } {
    try {
      // Machine-local calendar day (not UTC) — a checkpoint recorded at 01:00
      // Beirut must file under today, not yesterday's UTC day.
      const closingDate = localDay();
      const tenantId = getCurrentTenantId();

      const stmt = this.db.prepare(`
        INSERT INTO daily_closings (
          tenant_id, closing_date, drawer_name, opening_balance_usd, opening_balance_lbp,
          physical_usd, physical_lbp, physical_eur, system_expected_usd,
          system_expected_lbp, variance_usd, notes, report_path, created_by
        ) VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, ?, ?, ?)
      `);
      const result = stmt.run(
        tenantId,
        closingDate,
        data.drawer_name,
        data.notes || null,
        data.report_path || null,
        data.user_id,
      );

      const upsertAmounts = this.db.prepare(`
        INSERT INTO daily_closing_amounts (tenant_id, closing_id, drawer_name, currency_code, opening_amount, physical_amount)
        VALUES (?, ?, ?, ?, ?, ?)
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
        `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ? AND tenant_id = ?`,
      );

      const upsertCarrierLines = this.db.prepare(`
        INSERT INTO daily_closing_carrier_lines
          (tenant_id, closing_id, carrier_line_id, expected_credits, counted_credits,
           expected_expires_at, counted_expires_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(closing_id, carrier_line_id) DO UPDATE SET
          expected_credits = excluded.expected_credits,
          counted_credits = excluded.counted_credits,
          expected_expires_at = excluded.expected_expires_at,
          counted_expires_at = excluded.counted_expires_at,
          updated_at = CURRENT_TIMESTAMP
      `);

      const tx = this.db.transaction(
        (
          rows: CheckpointAmount[],
          lineCounts: CheckpointCarrierLineCount[],
        ) => {
          // 0. Resolve every counted SIM line against the DB (the client
          //    sends only ids + counted values) and project what each
          //    carrier's credits sum becomes once the counts are applied.
          const carrierRepo = getCarrierLineRepository();
          const counted = lineCounts.map((c) => {
            const line = carrierRepo.getById(c.carrier_line_id);
            if (!line) {
              throw new Error(`Carrier line #${c.carrier_line_id} not found`);
            }
            if (line.is_active !== 1) {
              throw new Error(
                `Carrier line #${c.carrier_line_id} is archived and cannot be counted`,
              );
            }
            const rawCreditsDelta = c.counted_credits - (line.credits ?? 0);
            // A null/absent counted date means "validity was not counted",
            // NOT "clear the expiry" — a checkpoint never erases a date.
            const countedExpiry = c.counted_expires_at ?? null;
            return {
              line,
              countedCredits: c.counted_credits,
              creditsDelta:
                Math.abs(rawCreditsDelta) > RECONCILE_EPSILON
                  ? rawCreditsDelta
                  : 0,
              countedExpiry,
              expiryChanged:
                countedExpiry !== null &&
                countedExpiry !== line.validity_expires_at,
            };
          });

          const carriers = [...new Set(counted.map((c) => c.line.carrier))];
          const projectedSum = new Map<CarrierKey, number>();
          for (const carrier of carriers) {
            // rule 14: the sum invariant has exactly ONE definition. The
            // projection is (current sum + the counted deltas) rather than a
            // second SUM query, and is verified against the real thing in
            // step 5 once the movements have landed.
            const base = carrierRepo.getCarrierCreditsSum(carrier);
            const delta = counted
              .filter((c) => c.line.carrier === carrier)
              .reduce((sum, c) => sum + c.creditsDelta, 0);
            projectedSum.set(carrier, base + delta);
          }

          // The provider drawer's USD count is the SUM of that carrier's
          // lines — whatever figure the client typed into the drawer field
          // is superseded, so drawer and lines can never be reconciled to
          // two different numbers in one checkpoint. A carrier counted with
          // no matching drawer row gets one appended.
          const drawerToCarrier = new Map<string, CarrierKey>(
            carriers.map((c) => [carrierDrawerName(c), c]),
          );
          const effectiveRows: CheckpointAmount[] = rows.map((r) => {
            const carrier =
              r.currency_code === "USD"
                ? drawerToCarrier.get(r.drawer_name)
                : undefined;
            return carrier === undefined
              ? r
              : { ...r, physical_amount: projectedSum.get(carrier)! };
          });
          for (const [drawer, carrier] of drawerToCarrier) {
            const present = effectiveRows.some(
              (r) => r.drawer_name === drawer && r.currency_code === "USD",
            );
            if (present) continue;
            const existing = getBalance.get(drawer, "USD", tenantId) as
              | { balance: number }
              | undefined;
            effectiveRows.push({
              drawer_name: drawer,
              currency_code: "USD",
              expected_amount: existing?.balance ?? 0,
              physical_amount: projectedSum.get(carrier)!,
            });
          }

          // 1. Persist the audit snapshot (expected vs physical) for variance reports.
          for (const r of effectiveRows) {
            upsertAmounts.run(
              tenantId,
              result.lastInsertRowid,
              r.drawer_name,
              r.currency_code,
              r.expected_amount,
              r.physical_amount,
            );
          }

          // 2. Compute per-currency reconciliation deltas against live balances.
          const adjustments = effectiveRows
            .map((r) => {
              const existing = getBalance.get(
                r.drawer_name,
                r.currency_code,
                tenantId,
              ) as { balance: number } | undefined;
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
            metadata_json: {
              amounts: effectiveRows,
              adjustments,
              carrier_lines: counted.map((c) => ({
                carrier_line_id: c.line.id,
                carrier: c.line.carrier,
                credits_delta: c.creditsDelta,
                counted_credits: c.countedCredits,
                counted_expires_at: c.countedExpiry,
              })),
              notes: data.notes,
            },
          });

          // 4. Apply the per-line counts. The movement rides on THIS
          //    checkpoint's transaction, and the absolute counted expiry is
          //    passed as a date rather than a day-delta — a delta would be
          //    rebased onto today for an already-expired line and store an
          //    expiry nobody counted (see applyMovement's doc).
          //    A line whose credits AND expiry both already match is skipped
          //    entirely: nothing changed, so there is nothing to audit.
          for (const c of counted) {
            if (c.creditsDelta === 0 && !c.expiryChanged) continue;
            carrierRepo.applyMovement({
              carrierLineId: c.line.id,
              creditsDelta: c.creditsDelta,
              validityDaysDelta: 0,
              ...(c.expiryChanged
                ? { validityExpiresAt: c.countedExpiry as string }
                : {}),
              reason: CHECKPOINT_MOVEMENT_REASON,
              transactionId: txnId,
            });
          }

          // 5. The sum invariant, verified against its ONE definition after
          //    the writes (rule 14). A mismatch means something moved the
          //    lines underneath this checkpoint — abort rather than leave
          //    drawer and lines disagreeing.
          for (const carrier of carriers) {
            const actual = carrierRepo.getCarrierCreditsSum(carrier);
            const expected = projectedSum.get(carrier)!;
            if (Math.abs(actual - expected) > RECONCILE_EPSILON) {
              throw new Error(
                `Carrier credits sum for ${carrier} is ${actual}, expected ${expected} after applying the checkpoint counts`,
              );
            }
          }

          // 6. Per-line audit snapshot. `expected_*` come from the line as it
          //    stood BEFORE the count (the entity was read in step 0), never
          //    from the client. `counted_expires_at` stays NULL when the
          //    operator did not count validity — distinguishable from
          //    "counted and it matched", which stores the date.
          for (const c of counted) {
            upsertCarrierLines.run(
              tenantId,
              result.lastInsertRowid,
              c.line.id,
              c.line.credits ?? 0,
              c.countedCredits,
              c.line.validity_expires_at,
              c.countedExpiry,
            );
          }

          // 7. Post the reconciliation entries to the journal + live balances.
          for (const a of adjustments) {
            insertPaymentRow(this.db, {
              transactionId: txnId,
              method: CHECKPOINT_ADJUSTMENT_METHOD,
              drawerName: a.drawer_name,
              currencyCode: a.currency_code,
              amount: a.delta,
              note: `Checkpoint reconciliation for ${closingDate}`,
              createdBy: data.user_id,
              tenantId,
            });
            applyDrawerDelta(this.db, {
              drawerName: a.drawer_name,
              currencyCode: a.currency_code,
              delta: a.delta,
              tenantId,
            });
          }
        },
      );
      tx(data.amounts, data.carrier_lines ?? []);

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
    // "Today" is the machine-local calendar day, evaluated inside SQLite via
    // `todayLocal()` — no JS date param, so it can never mismatch a UTC day at
    // the local-midnight boundary (matches SalesRepository et al.).
    const tenantId = getCurrentTenantId();

    // Sales stats
    const salesStats = this.db
      .prepare(
        `SELECT
          COUNT(id) as sales_count,
          SUM(final_amount_usd) as total_sales_usd,
          SUM(paid_lbp) as total_sales_lbp
         FROM sales
         WHERE ${todayLocal("created_at")} AND status = 'completed' AND tenant_id = ?`,
      )
      .get(tenantId) as
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
         WHERE ${todayLocal("created_at")} AND transaction_type = 'Repayment' AND tenant_id = ?`,
      )
      .get(tenantId) as
      | { total_debt_payments_usd: number; total_debt_payments_lbp: number }
      | undefined;

    // Expenses — gated to status='active' AND not-refunded (rule 14's shared
    // `activeExpense` predicate), else a voided/refunded expense (either of
    // the two doors — see `activeExpense`'s doc) keeps inflating today's
    // closing total forever even after its drawer leg was reversed (rule 20).
    const expensesStats = this.db
      .prepare(
        `SELECT
          SUM(amount_usd) as total_expenses_usd,
          SUM(amount_lbp) as total_expenses_lbp
         FROM expenses
         WHERE ${todayLocal("expense_date")} AND tenant_id = ? AND ${activeExpense()}`,
      )
      .get(tenantId) as
      | { total_expenses_usd: number; total_expenses_lbp: number }
      | undefined;

    // Profit — aggregate across all revenue modules
    const salesProfit = this.db
      .prepare(
        `SELECT
          COALESCE(SUM(si.sold_price_usd - si.cost_price_snapshot_usd), 0) as profit_usd
         FROM sales s
         JOIN sale_items si ON s.id = si.sale_id
         WHERE ${todayLocal("s.created_at")} AND s.status = 'completed'
           AND si.is_refunded = 0
           AND (s.paid_usd + COALESCE(s.paid_lbp, 0) / COALESCE(NULLIF(s.exchange_rate_snapshot, 0), 1)) >= s.final_amount_usd - 0.05
           AND s.tenant_id = ? AND si.tenant_id = ?`,
      )
      .get(tenantId, tenantId) as { profit_usd: number };

    // Financial-service commission — LIRA-158 (D10/D14, closing goes
    // settlement-day cash basis). Two independent, additive sources:
    //
    //  - LEGACY (`commission_model = 0`): UNCHANGED — `financial_services
    //    .commission` on the row's own transaction day. This is a per-row
    //    CUTOVER (D3), not a restatement of history: legacy rows keep the
    //    embedded-estimate model forever. Newly gated with `notRefunded` —
    //    the sibling `salesProfit` query above already carries
    //    `si.is_refunded = 0`; this query never did, so a voided financial
    //    service kept contributing its commission forever (bonus fix,
    //    independent of LIRA-158, §1.3 of the plan).
    //  - NEW MODEL (`commission_model = 1`): the operator's ENTERED
    //    commission, read off the `SUPPLIER_SETTLEMENT` transaction
    //    `SupplierRepository` stamps at settlement time
    //    (`source_table = 'supplier_ledger'`), bucketed on THAT row's own
    //    date — the settlement day. The predicate mirrors
    //    `ProfitRepository.getSupplierCommissionTotals` verbatim (rule 14),
    //    swapping its arbitrary `dateRange` for this file's `todayLocal`.
    //    `REFUND` is included deliberately: a voided settlement's REFUND row
    //    carries the negated stamp on the same `source_table`, so a
    //    same-day create+void nets to exactly 0 (rule 20).
    //
    // DELIBERATE, NOT A REGRESSION: from this change on, a model-1 row's
    // commission appears in the daily closing total on the day it is
    // SETTLED, never the day the underlying OMT/WHISH/BILL transaction
    // happened. A future reader must not "fix" this back to transaction-day
    // bucketing — D10/D14 chose settlement-day cash basis on purpose.
    //
    // EXTENDED by D17 (LIRA-158 follow-up, owner decision 2026-08-31) — the
    // NEW MODEL source above splits further, mirroring
    // `ProfitRepository.getSupplierCommissionTotals` verbatim (same two
    // buckets, same partition proof — see that method's doc comment for the
    // full exhaustive/disjoint argument and the reversal analysis, which
    // apply here unchanged; only `dateRange` -> `todayLocal` differs):
    //  - BILLS-ONLY (`cashlessCommissionBatch` negated): UNCHANGED —
    //    real money the instant it's recognised, stays on the settlement
    //    transaction's own stamp.
    //  - CASHLESS (every other new-model batch, including MIXED
    //    bills+OMT): the owner settles these batches out of his OWN drawer
    //    BEFORE the client who owes for the transfer has repaid, so this
    //    commission is contingent on that repayment — re-sourced from
    //    `settlement_commission_allocations`, gated on
    //    `allocationNotDebtPending` + `notPartnerPending` + `notRefunded`.
    //  Degrades to the OLD, undifferentiated stamp-only query when
    //  `settlement_commission_allocations` doesn't exist (§5) — every
    //  existing `getDailyStatsSnapshot` fixture predates that table, so this
    //  degradation keeps every one of them byte-for-byte unchanged.
    const hasCommissionModel = this._hasCommissionModelColumn();
    const finProfitLegacy = this.db
      .prepare(
        `SELECT
          COALESCE(SUM(CASE WHEN currency != 'LBP' THEN commission ELSE 0 END), 0) as profit_usd
         FROM financial_services
         WHERE ${todayLocal("created_at")}
           AND ${embeddedCommission("financial_services", hasCommissionModel)}
           AND ${notRefunded("financial_services")}
           AND tenant_id = ?`,
      )
      .get(tenantId) as { profit_usd: number };

    let finProfitSettlement: { profit_usd: number };
    if (!this._hasTransactionsTable()) {
      finProfitSettlement = { profit_usd: 0 };
    } else if (!this._hasSettlementAllocationsTable()) {
      finProfitSettlement = this.db
        .prepare(
          `SELECT COALESCE(SUM(profit_usd), 0) as profit_usd
           FROM transactions
           WHERE ${todayLocal("created_at")}
             AND status = 'ACTIVE'
             AND source_table = 'supplier_ledger'
             AND type IN ('SUPPLIER_SETTLEMENT', 'REFUND')
             AND tenant_id = ?`,
        )
        .get(tenantId) as { profit_usd: number };
    } else {
      const billsOnlySettlement = this.db
        .prepare(
          `SELECT COALESCE(SUM(profit_usd), 0) as profit_usd
           FROM transactions
           WHERE ${todayLocal("created_at")}
             AND status = 'ACTIVE'
             AND source_table = 'supplier_ledger'
             AND type IN ('SUPPLIER_SETTLEMENT', 'REFUND')
             AND NOT (${cashlessCommissionBatch("source_id")})
             AND tenant_id = ?`,
        )
        .get(tenantId) as { profit_usd: number };

      const cashlessSettlement = this.db
        .prepare(
          `SELECT COALESCE(SUM(sca.commission_usd), 0) as profit_usd
           FROM settlement_commission_allocations sca
           JOIN financial_services fs ON ${currentSettlementAllocation("fs", "sca")}
           WHERE sca.tenant_id = ?
             AND ${notRefunded("fs")}
             AND ${cashlessCommissionBatch("sca.settlement_ledger_id")}
             AND ${allocationNotDebtPending("sca")}
             AND ${notPartnerPending("financial_services", "sca.financial_service_id")}
             AND ${todayLocal("sca.created_at")}`,
        )
        .get(tenantId) as { profit_usd: number };

      finProfitSettlement = {
        profit_usd: billsOnlySettlement.profit_usd + cashlessSettlement.profit_usd,
      };
    }

    const finProfit = {
      profit_usd: finProfitLegacy.profit_usd + finProfitSettlement.profit_usd,
    };

    const rechargeProfit = this.db
      .prepare(
        `SELECT
          COALESCE(SUM(CASE WHEN currency_code != 'LBP' THEN (price - cost) ELSE 0 END), 0) as profit_usd
         FROM recharges
         WHERE ${todayLocal("created_at")} AND tenant_id = ?`,
      )
      .get(tenantId) as { profit_usd: number };

    const customProfit = this.db
      .prepare(
        `SELECT
          COALESCE(SUM(profit_usd), 0) as profit_usd
         FROM custom_services
         WHERE ${todayLocal("created_at")} AND status = 'completed' AND tenant_id = ?`,
      )
      .get(tenantId) as { profit_usd: number };

    const maintProfit = this.db
      .prepare(
        `SELECT
          COALESCE(SUM(final_amount_usd - cost_usd), 0) as profit_usd
         FROM maintenance
         WHERE ${todayLocal("created_at")} AND LOWER(status) = 'completed' AND tenant_id = ?`,
      )
      .get(tenantId) as { profit_usd: number };

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
    // closing_date is a plain 'YYYY-MM-DD' string stamped via localDay() (see
    // createCheckpoint) — compare against that SAME JS-computed value, not
    // SQLite's own DATE('now','localtime'). The two are NOT interchangeable:
    // SQLite's 'localtime' modifier calls the platform C runtime's localtime(),
    // which on Windows does not reliably honor an IANA TZ string (e.g.
    // TZ=Asia/Beirut resolves to the wrong UTC offset there), while Node's own
    // Date getters (which localDay() uses) correctly respect process.env.TZ on
    // every platform. Binding the same JS value on both sides of the
    // comparison removes the cross-system disagreement entirely — verified
    // via a direct comparison: with TZ=Asia/Beirut, SQLite's
    // DATE('now','localtime') on Windows returned a day BEHIND the correct
    // Beirut calendar day.
    const row = this.db
      .prepare(
        `SELECT 1 FROM daily_closings WHERE closing_date = ? AND tenant_id = ? LIMIT 1`,
      )
      .get(localDay(), getCurrentTenantId());
    return row !== undefined;
  }

  /**
   * True once at least one checkpoint exists in the timeline. The setup wizard
   * ALWAYS writes an initial checkpoint on completion (StepComplete, A4), so the
   * earliest daily_closings row IS the starting checkpoint — its mere existence
   * means the timeline has a baseline. Used by the dashboard to nudge the
   * operator to record a starting checkpoint when none has ever been created
   * (mirrors hasInitialBalancesSet for opening drawer amounts).
   */
  hasStartingCheckpoint(): boolean {
    const row = this.db
      .prepare(`SELECT 1 FROM daily_closings WHERE tenant_id = ? LIMIT 1`)
      .get(getCurrentTenantId());
    return row !== undefined;
  }

  /**
   * The closing_date of the initial (setup) checkpoint — the very first
   * daily_closings row (setup A4 always writes it first). Returns null if no
   * checkpoint exists. Lets the timeline surface "initial setup was done at …"
   * and jump the from-date to it when it falls outside the current filter.
   */
  getInitialCheckpointDate(): string | null {
    const row = this.db
      .prepare(
        `SELECT closing_date FROM daily_closings WHERE tenant_id = ? ORDER BY id ASC LIMIT 1`,
      )
      .get(getCurrentTenantId()) as { closing_date: string } | undefined;
    return row?.closing_date ?? null;
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
        WHERE id = ? AND tenant_id = ?
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
        getCurrentTenantId(),
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
       WHERE closing_id = ? AND tenant_id = ?
       ORDER BY drawer_name, currency_code`,
      checkpointId,
      getCurrentTenantId(),
    );
  }

  /**
   * The per-line SIM counts recorded with one checkpoint, joined to the line
   * for display (phone number / label). Empty for every checkpoint of a
   * non-carrier drawer.
   */
  getCheckpointCarrierLines(
    checkpointId: number,
  ): CheckpointCarrierLineRecord[] {
    return this.query<CheckpointCarrierLineRecord>(
      `SELECT dccl.carrier_line_id, cl.carrier, cl.phone_number, cl.label,
              dccl.expected_credits, dccl.counted_credits,
              dccl.expected_expires_at, dccl.counted_expires_at
         FROM daily_closing_carrier_lines dccl
         JOIN carrier_lines cl
           ON cl.id = dccl.carrier_line_id AND cl.tenant_id = ?
        WHERE dccl.closing_id = ? AND dccl.tenant_id = ?
        ORDER BY cl.carrier, cl.phone_number`,
      getCurrentTenantId(),
      checkpointId,
      getCurrentTenantId(),
    );
  }

  /**
   * Get checkpoint timeline for a date
   */
  getCheckpointTimeline(filters: CheckpointFilters = {}): CheckpointRecord[] {
    const today = localDay();
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
      LEFT JOIN users u ON u.id = dc.created_by AND u.tenant_id = ?
      LEFT JOIN transactions t ON t.source_table = 'daily_closings' AND t.source_id = dc.id AND t.tenant_id = ?
      WHERE dc.closing_date BETWEEN ? AND ?
        AND dc.tenant_id = ?
    `;

    const tenantId = getCurrentTenantId();
    const params: (string | number)[] = [
      tenantId,
      tenantId,
      date_from,
      date_to,
      tenantId,
    ];

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
         WHERE closing_id = ? AND tenant_id = ?
         ORDER BY drawer_name, currency_code`,
        checkpoint.id,
        tenantId,
      );

      checkpoint.carrier_lines = this.getCheckpointCarrierLines(checkpoint.id);

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
   * Get the most recent checkpoint for each drawer.
   * Returns Record<drawerName, DrawerCheckpointStatus>
   *
   * LIRA-156 — the dashboard's per-drawer chip showed the right AMOUNTS but a
   * frozen TIME. Root cause was this query's `IN`-list:
   *
   *   WHERE dca.closing_id IN (
   *     SELECT MAX(dca2.closing_id) FROM daily_closing_amounts dca2
   *     WHERE dca2.tenant_id = ? GROUP BY dca2.drawer_name
   *   )
   *
   * `GROUP BY drawer_name` computes the right MAX(closing_id) *per drawer*,
   * but the result is flattened into one bare id list before it reaches the
   * outer `WHERE` — so the outer filter can no longer tell WHICH drawer each
   * id belongs to. Any row whose closing_id happens to appear anywhere in
   * that list passes, including a drawer's own STALE rows from a closing
   * that is only "latest" for some OTHER drawer. On top of that the query had
   * no time ordering at all (`ORDER BY drawer_name, currency_code` only), so
   * which of a drawer's surviving rows the JS loop below saw *first* (and
   * therefore took `checked_at` from) was scan-order luck, not recency.
   *
   * This bites in practice because most checkpoints are single-drawer, but
   * TWO paths (`InitialDrawerAmountsModal.tsx`, `StepComplete.tsx` — the
   * setup wizard, which runs on every fresh install) write ONE multi-drawer
   * checkpoint tagged `drawer_name: 'AGGREGATED'` with an amount row per
   * drawer. So every shop has at least one closing spanning every drawer,
   * and the moment an operator checkpoints a single drawer on its own, that
   * drawer has rows in TWO closings — the old aggregated one and the new
   * individual one — which is exactly the shape the old query got wrong.
   *
   * The fix does two things, both required:
   *   1. CORRELATE per drawer: rank each drawer's closings by recency and
   *      keep only rank 1, instead of computing a tenant-wide id set with no
   *      per-drawer link back to the outer query.
   *   2. ORDER BY TIME, not id: `dc.created_at DESC, dc.id DESC` — `id DESC`
   *      is only the tiebreak (created_at is second-granular; see
   *      FEATURE_GUIDE.md's timestamp-tie convention), never the primary
   *      sort. Ranking by id alone would pick whichever checkpoint happened
   *      to insert last, not whichever happened chronologically last — the
   *      two are normally the same, but nothing in the schema guarantees it.
   *
   * The ranking runs over a `SELECT DISTINCT drawer_name, closing_id`
   * derived table — i.e. one row per (drawer, closing), not one row per
   * (drawer, closing, currency) — before joining back to
   * `daily_closing_amounts` for the full currency breakdown. Ranking
   * directly over the currency-level rows would tie every currency of the
   * SAME closing on `(created_at, id)` and let `ROW_NUMBER()` arbitrarily
   * keep only one currency of the winning closing (e.g. General/USD but not
   * General/LBP) — silently dropping a currency whenever a drawer's
   * checkpoint covers more than one, which is the common case.
   *
   * Both tenant_id filters (on the derived `daily_closing_amounts` scan and
   * on the `daily_closings` join) are preserved in every place they appear
   * below — dropping either is the exact class of bug
   * `scripts/check-tenant-scoping.mjs` exists to catch.
   *
   * Owner decision (2026-08-29): the AGGREGATED setup baseline DOES count as
   * a real checkpoint for the dashboard's staleness dot — it is a real
   * physical count, just of every drawer at once. Do not add a
   * `drawer_name != 'AGGREGATED'` filter here; that was considered and
   * deliberately rejected, not overlooked.
   */
  getLastCheckpointPerDrawer(): Record<string, DrawerCheckpointStatus> {
    const tenantId = getCurrentTenantId();
    const rows = this.db
      .prepare(
        `WITH latest_closing_per_drawer AS (
           SELECT dca.drawer_name, dca.closing_id,
                  ROW_NUMBER() OVER (
                    PARTITION BY dca.drawer_name
                    ORDER BY dc.created_at DESC, dc.id DESC
                  ) AS rn
           FROM (
             SELECT DISTINCT drawer_name, closing_id
             FROM daily_closing_amounts
             WHERE tenant_id = ?
           ) dca
           JOIN daily_closings dc ON dc.id = dca.closing_id AND dc.tenant_id = ?
         )
         SELECT dc.created_at as checked_at,
                dca.drawer_name, dca.currency_code, dca.physical_amount, dca.opening_amount
         FROM daily_closing_amounts dca
         JOIN daily_closings dc ON dc.id = dca.closing_id AND dc.tenant_id = ?
         JOIN latest_closing_per_drawer lcd
           ON lcd.drawer_name = dca.drawer_name
          AND lcd.closing_id = dca.closing_id
          AND lcd.rn = 1
         WHERE dca.tenant_id = ?
         ORDER BY dca.drawer_name, dca.currency_code`,
      )
      .all(tenantId, tenantId, tenantId, tenantId) as {
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
