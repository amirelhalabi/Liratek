/**
 * LIRA-335 — checkpoint open differences (spec FR-001..FR-016,
 * data-model.md).
 *
 * A checkpoint that corrects a drawer records, per drawer and currency, the
 * correction it actually posted (`recordForCheckpoint`, called from
 * `ClosingRepository.createCheckpoint`). The difference then stays open
 * until a back-timed transaction resolves it (Lane B's
 * `checkpointResolution.ts` writes the resolution rows) or the owner closes
 * what is left (`close` / `reopen`).
 *
 * Status, direction and open amount always come from the ONE pure
 * derivation `describeCheckpointDifference` (rule 14); a resolution counts
 * while its transaction is not voided ({@link ACTIVE_RESOLUTION_SQL}).
 *
 * Reversal owners (rule 20, data-model.md):
 *   - a difference row belongs to its checkpoint, which is non-reversible;
 *   - a resolution row goes inactive when its transaction is voided;
 *   - the Drawer shortage expense of a closed Short is owned by
 *     {@link CheckpointDifferenceRepository.syncShortageExpense}.
 */
import { BaseRepository } from "./BaseRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { closingLogger } from "../utils/logger.js";
import { requestNow } from "../utils/requestNow.js";
import {
  describeCheckpointDifference,
  type CheckpointDifferenceDirection,
  type CheckpointDifferenceStatus,
} from "../utils/checkpointDifference.js";
import {
  CHECKPOINT_DIFFERENCE_SOURCE_TABLE,
  checkpointDifferenceEpsilon,
} from "../constants/checkpointAdjustment.js";
import {
  bookDrawerShortageExpense,
  DRAWER_SHORTAGE_EXPENSE_CURRENCIES,
} from "./drawerShortageExpense.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { activeExpense } from "./ProfitRepository.js";
// Function-level use only, so the import cycle with the engine (which reads
// views and syncs shortage expenses through this repository) is harmless.
import { getOpenDifferencesAfter } from "./checkpointResolution.js";

/**
 * The ONE definition of "this resolution still counts" (rule 14): its
 * transaction is not voided. A REFUND leaves the original ACTIVE (it adds a
 * REFUND row instead), so a refunded resolver keeps its resolution, as the
 * spec requires (FR-009). Alias the resolutions table as `r`. Bind: none.
 */
export const ACTIVE_RESOLUTION_SQL =
  "EXISTS (SELECT 1 FROM transactions rt WHERE rt.id = r.transaction_id AND rt.tenant_id = r.tenant_id AND rt.status <> 'VOIDED'" +
  // A Hold Money pickup is voided by a HOLD_MONEY_COLLECT_VOID reversal that
  // leaves the pickup itself ACTIVE (`HoldMoneyRepository.voidPickup`) — it
  // is the one wired writer that does, so its resolution ends there too.
  ` AND NOT EXISTS (SELECT 1 FROM transactions rv WHERE rv.reverses_id = rt.id AND rv.tenant_id = rt.tenant_id AND rv.type = '${TRANSACTION_TYPES.HOLD_MONEY_COLLECT_VOID}'))`;

export interface CheckpointDifferenceResolutionView {
  transaction_id: number;
  transaction_type: string;
  summary: string | null;
  /** Magnitude, signed like the difference. */
  amount: number;
  /** `transactions.created_at` — the custom time. */
  effective_time: string;
  /** Resolution row `created_at` — when it was saved. */
  entered_at: string;
  user_name: string | null;
}

export interface CheckpointDifferenceView {
  id: number;
  closing_id: number;
  closing_created_at: string;
  drawer_name: string;
  currency_code: string;
  /** Signed delta: > 0 Over, < 0 Short. */
  amount: number;
  direction: CheckpointDifferenceDirection;
  resolved: number;
  open: number;
  status: CheckpointDifferenceStatus;
  closed_at: string | null;
  closed_by_name: string | null;
  shortage_expense_id: number | null;
  resolutions: CheckpointDifferenceResolutionView[];
}

/** One adjustment `createCheckpoint` posted (its own `adjustments`). */
export interface CheckpointDifferenceAdjustment {
  drawer_name: string;
  currency_code: string;
  delta: number;
}

export interface CheckpointDifferenceEntity {
  id: number;
  tenant_id: number;
  closing_id: number;
  drawer_name: string;
  currency_code: string;
  amount: number;
  closed_at: string | null;
  closed_by: number | null;
  created_at: string;
  updated_at: string;
}

interface DifferenceRow {
  id: number;
  closing_id: number;
  closing_created_at: string;
  closing_date: string;
  drawer_name: string;
  currency_code: string;
  amount: number;
  closed_at: string | null;
  closed_by_name: string | null;
  shortage_expense_id: number | null;
}

interface ResolutionRow extends CheckpointDifferenceResolutionView {
  difference_id: number;
}

/** SQLite's bound-parameter ceiling is far above this; chunking keeps any
 *  date range safe without a second code path. */
const ID_CHUNK = 400;

/** The real drawer a multi-drawer setup checkpoint is filed under; never a
 *  difference's drawer (data-model.md). */
const AGGREGATED_DRAWER = "AGGREGATED";

export class CheckpointDifferenceRepository extends BaseRepository<CheckpointDifferenceEntity> {
  constructor() {
    super("checkpoint_differences");
  }

  protected getColumns(): string {
    return "id, tenant_id, closing_id, drawer_name, currency_code, amount, closed_at, closed_by, created_at, updated_at";
  }

  /**
   * False only on a hand-trimmed test schema that predates v222 (every real
   * database runs the migration). Same tolerance as the engine's
   * `hasCheckpointTables` and `_expensesHasSourceRefColumns`: such a schema
   * records and reads no differences instead of failing every checkpoint.
   */
  private hasTables(): boolean {
    return (
      this.tableExists("checkpoint_differences") &&
      this.tableExists("checkpoint_difference_resolutions")
    );
  }

  /**
   * Record the corrections a checkpoint posted as open differences. Called
   * by `createCheckpoint` inside its own db transaction, after its
   * adjustments are known. A correction within the currency's tolerance
   * (sub-cent / sub-LBP) records nothing. Stamped with the checkpoint's own
   * time (the event's inside an offline replay).
   */
  recordForCheckpoint(
    closingId: number,
    adjustments: CheckpointDifferenceAdjustment[],
  ): void {
    if (!this.hasTables()) return;
    const tenantId = getCurrentTenantId();
    const closing = this.queryOne<{ created_at: string }>(
      `SELECT created_at FROM daily_closings WHERE id = ? AND tenant_id = ?`,
      closingId,
      tenantId,
    );
    if (!closing) {
      throw new Error(`Checkpoint #${closingId} not found`);
    }
    for (const a of adjustments) {
      if (a.drawer_name === AGGREGATED_DRAWER) continue;
      if (Math.abs(a.delta) <= checkpointDifferenceEpsilon(a.currency_code)) {
        continue;
      }
      this.execute(
        `INSERT INTO checkpoint_differences
           (tenant_id, closing_id, drawer_name, currency_code, amount, closed_at, closed_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
        tenantId,
        closingId,
        a.drawer_name,
        a.currency_code,
        a.delta,
        closing.created_at,
        closing.created_at,
      );
    }
  }

  /**
   * Every difference of the given checkpoints, keyed by checkpoint id. Every
   * requested id gets an entry (`[]` when it has none — e.g. a checkpoint
   * saved before v222). Two queries per chunk of ids (differences +
   * resolutions), never one per checkpoint.
   */
  listForClosings(closingIds: number[]): Map<number, CheckpointDifferenceView[]> {
    const result = new Map<number, CheckpointDifferenceView[]>();
    const ids = [...new Set(closingIds)];
    for (const id of ids) result.set(id, []);
    if (!this.hasTables()) return result;
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      const chunk = ids.slice(i, i + ID_CHUNK);
      const rows = this.selectDifferences(
        `d.closing_id IN (${chunk.map(() => "?").join(", ")})`,
        chunk,
      );
      for (const view of this.buildViews(rows)) {
        result.get(view.closing_id)!.push(view);
      }
    }
    return result;
  }

  /** The given differences as views, in id order (missing ids skipped). */
  listByIds(differenceIds: number[]): CheckpointDifferenceView[] {
    const ids = [...new Set(differenceIds)];
    const out: CheckpointDifferenceView[] = [];
    if (!this.hasTables()) return out;
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      const chunk = ids.slice(i, i + ID_CHUNK);
      const rows = this.selectDifferences(
        `d.id IN (${chunk.map(() => "?").join(", ")})`,
        chunk,
      );
      out.push(...this.buildViews(rows));
    }
    return out.sort((a, b) => a.id - b.id);
  }

  getById(id: number): CheckpointDifferenceView | null {
    return this.listByIds([id])[0] ?? null;
  }

  /**
   * The differences money saved at `at` could still resolve (the hint under
   * Transaction time). The engine (`checkpointResolution.ts`) owns the
   * "first checkpoint after `at`" rule; this hands it the db so the service
   * never touches it (rule 13).
   */
  openDifferencesAfter(at: string): CheckpointDifferenceView[] {
    return getOpenDifferencesAfter(this.db, { at });
  }

  /**
   * Admin closes what is still open (FR-011/014/015). A Short in USD or LBP
   * books one books-only Drawer shortage expense for the open amount, dated
   * the checkpoint's day; an Over (or another currency) records nothing.
   * No drawer moves: the checkpoint already set it.
   */
  close(id: number, userId: number): { success: boolean; error?: string } {
    try {
      return this.transaction(() => {
        const d = this.getById(id);
        if (!d) return { success: false, error: "Checkpoint difference not found" };
        if (d.closed_at) {
          return { success: false, error: "This difference is already closed" };
        }
        if (d.open <= 0) {
          return {
            success: false,
            error: "There is nothing left open to close on this difference",
          };
        }
        const now = requestNow();
        this.execute(
          `UPDATE checkpoint_differences SET closed_at = ?, closed_by = ?, updated_at = ?
            WHERE id = ? AND tenant_id = ?`,
          now,
          userId,
          now,
          id,
          getCurrentTenantId(),
        );
        this.syncShortageExpense(id, userId);
        closingLogger.info(
          { differenceId: id, direction: d.direction, open: d.open, currency: d.currency_code },
          "Checkpoint difference closed",
        );
        return { success: true };
      });
    } catch (error) {
      closingLogger.error({ error, differenceId: id }, "Failed to close checkpoint difference");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Admin reopens a closed difference (FR-012/014): its Drawer shortage
   * expense (if any) is voided and it returns to Open / Partly resolved.
   */
  reopen(id: number, userId: number): { success: boolean; error?: string } {
    try {
      return this.transaction(() => {
        const d = this.getById(id);
        if (!d) return { success: false, error: "Checkpoint difference not found" };
        if (!d.closed_at) {
          return { success: false, error: "This difference is not closed" };
        }
        this.execute(
          `UPDATE checkpoint_differences SET closed_at = NULL, closed_by = NULL, updated_at = ?
            WHERE id = ? AND tenant_id = ?`,
          requestNow(),
          id,
          getCurrentTenantId(),
        );
        this.syncShortageExpense(id, userId);
        closingLogger.info({ differenceId: id }, "Checkpoint difference reopened");
        return { success: true };
      });
    } catch (error) {
      closingLogger.error({ error, differenceId: id }, "Failed to reopen checkpoint difference");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Re-derive the Drawer shortage expense of one difference (rule 20 owner,
   * FR-016). Target = the open amount of a CLOSED Short in USD/LBP, else
   * nothing. If the active expense already holds the target, nothing is
   * written (idempotent); otherwise every active linked expense is voided
   * and, for a positive target, one is booked again. Run by close, reopen,
   * a new resolution of a closed Short and the void of such a resolver.
   * Call inside the caller's db transaction.
   */
  syncShortageExpense(differenceId: number, userId: number): void {
    const tenantId = getCurrentTenantId();
    const d = this.getById(differenceId);
    if (!d) throw new Error(`Checkpoint difference #${differenceId} not found`);
    const closing = this.queryOne<{ closing_date: string }>(
      `SELECT closing_date FROM daily_closings WHERE id = ? AND tenant_id = ?`,
      d.closing_id,
      tenantId,
    );
    if (!closing) throw new Error(`Checkpoint #${d.closing_id} not found`);

    const bookable = DRAWER_SHORTAGE_EXPENSE_CURRENCIES.includes(d.currency_code);
    const target =
      d.closed_at !== null && d.direction === "SHORT" && bookable ? d.open : 0;

    const active = this.query<{ amount_usd: number; amount_lbp: number }>(
      `SELECT e.amount_usd, e.amount_lbp FROM expenses e
        WHERE e.tenant_id = ? AND e.source_ref_table = ? AND e.source_ref_id = ?
          AND ${activeExpense("e")}`,
      tenantId,
      CHECKPOINT_DIFFERENCE_SOURCE_TABLE,
      differenceId,
    );
    const held = active.reduce(
      (sum, e) =>
        sum +
        (d.currency_code === "LBP" ? Number(e.amount_lbp) || 0 : Number(e.amount_usd) || 0),
      0,
    );
    if (active.length <= 1 && Math.abs(held - target) < 1e-9) return;

    if (active.length > 0) {
      // `internal`: the one caller allowed to void a Drawer shortage expense
      // (FR-013 refuses every manual void of it).
      getTransactionRepository().voidLinkedExpenses(
        CHECKPOINT_DIFFERENCE_SOURCE_TABLE,
        differenceId,
        userId,
        { internal: true },
      );
    }
    if (target > 0) {
      bookDrawerShortageExpense({
        differenceId,
        drawerName: d.drawer_name,
        currencyCode: d.currency_code,
        amount: target,
        closingDate: closing.closing_date,
        closingId: d.closing_id,
        userId,
      });
    }
    closingLogger.info(
      { differenceId, from: held, to: target, currency: d.currency_code },
      "Drawer shortage expense re-derived",
    );
  }

  // ─── internals ────────────────────────────────────────────────────────────

  /** Difference rows matching `where` (alias `d`), with their checkpoint,
   *  closer and active shortage expense. `params` bind `where`'s `?`s. */
  private selectDifferences(where: string, params: number[]): DifferenceRow[] {
    const tenantId = getCurrentTenantId();
    return this.query<DifferenceRow>(
      `SELECT d.id, d.closing_id, dc.created_at AS closing_created_at, dc.closing_date,
              d.drawer_name, d.currency_code, d.amount, d.closed_at,
              u.username AS closed_by_name,
              (SELECT MAX(e.id) FROM expenses e
                WHERE e.tenant_id = d.tenant_id AND e.source_ref_table = ?
                  AND e.source_ref_id = d.id AND ${activeExpense("e")}) AS shortage_expense_id
         FROM checkpoint_differences d
         JOIN daily_closings dc ON dc.id = d.closing_id AND dc.tenant_id = d.tenant_id
         LEFT JOIN users u ON u.id = d.closed_by AND u.tenant_id = d.tenant_id
        WHERE d.tenant_id = ? AND ${where}
        ORDER BY d.closing_id, d.drawer_name, d.currency_code`,
      CHECKPOINT_DIFFERENCE_SOURCE_TABLE,
      tenantId,
      ...params,
    );
  }

  /** Attach active resolutions and the derived status (one query for all). */
  private buildViews(rows: DifferenceRow[]): CheckpointDifferenceView[] {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const resolutions = this.query<ResolutionRow>(
      `SELECT r.difference_id, r.transaction_id, t.type AS transaction_type, t.summary,
              r.amount, t.created_at AS effective_time, r.created_at AS entered_at,
              u.username AS user_name
         FROM checkpoint_difference_resolutions r
         JOIN transactions t ON t.id = r.transaction_id AND t.tenant_id = r.tenant_id
         LEFT JOIN users u ON u.id = t.user_id AND u.tenant_id = r.tenant_id
        WHERE r.tenant_id = ? AND r.difference_id IN (${ids.map(() => "?").join(", ")})
          AND ${ACTIVE_RESOLUTION_SQL}
        ORDER BY r.difference_id, julianday(r.created_at), r.id`,
      getCurrentTenantId(),
      ...ids,
    );
    const byDifference = new Map<number, CheckpointDifferenceResolutionView[]>();
    for (const r of resolutions) {
      const { difference_id, ...view } = r;
      const list = byDifference.get(difference_id) ?? [];
      list.push(view);
      byDifference.set(difference_id, list);
    }
    return rows.map((row) => {
      const list = byDifference.get(row.id) ?? [];
      const resolved = list.reduce((sum, r) => sum + Math.abs(r.amount), 0);
      const summary = describeCheckpointDifference({
        amount: row.amount,
        resolved,
        closed: row.closed_at !== null,
        currencyCode: row.currency_code,
      });
      return {
        id: row.id,
        closing_id: row.closing_id,
        closing_created_at: row.closing_created_at,
        drawer_name: row.drawer_name,
        currency_code: row.currency_code,
        amount: row.amount,
        direction: summary.direction,
        resolved,
        open: summary.open,
        status: summary.status,
        closed_at: row.closed_at,
        closed_by_name: row.closed_by_name ?? null,
        shortage_expense_id: row.shortage_expense_id ?? null,
        resolutions: list,
      };
    });
  }
}

// Singleton
let instance: CheckpointDifferenceRepository | null = null;

export function getCheckpointDifferenceRepository(): CheckpointDifferenceRepository {
  if (!instance) instance = new CheckpointDifferenceRepository();
  return instance;
}

export function resetCheckpointDifferenceRepository(): void {
  instance = null;
}
