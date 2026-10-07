/**
 * Database Reset Repository (LIRA-165 — Settings › Reset Data)
 *
 * The ONLY place with SQL for the reset feature (rule 13). Reads exclusively
 * from the frozen classification in `constants/resetTables.ts` — table
 * names are NEVER accepted from a caller, only from those constants, so
 * there is no path by which caller input can select which table gets a raw
 * `DELETE FROM <name>` (see the inline assertion below each loop).
 *
 * See `docs/plans/done_plans/DATABASE_RESET_PLAN.md` for the full
 * classification rationale.
 */

import { BaseRepository } from "./BaseRepository.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { DatabaseError } from "../utils/errors.js";
import { settingsLogger } from "../utils/logger.js";
import {
  RESET_WIPE_TABLES,
  RESET_ZERO_TABLES,
  type DatabaseResetPreview,
  type DatabaseResetResult,
} from "../constants/resetTables.js";

export class DatabaseResetRepository extends BaseRepository<{ id: number }> {
  constructor() {
    // Base table is irrelevant — every method here runs cross-table SQL
    // driven entirely by the resetTables.ts classification, never by the
    // generic single-table CRUD BaseRepository provides.
    super("transactions", { softDelete: false });
  }

  protected getColumns(): string {
    return "id";
  }

  /**
   * Row counts a reset would delete, for the confirmation UI — exactly
   * `RESET_WIPE_TABLES`. Kept setup tables (KEEP) and kept-but-zeroed rows
   * (ZERO: drawers, carrier lines, products) are never counted: nothing in
   * them is removed. Tables absent from the current schema are skipped via
   * `tableExists` rather than throwing — an older install may legitimately
   * lag a migration or two behind the newest classified table.
   */
  previewCounts(): DatabaseResetPreview {
    try {
      const tenantId = getCurrentTenantId();
      const counts: Record<string, number> = {};

      for (const table of RESET_WIPE_TABLES) {
        if (!this.tableExists(table)) continue;
        // `table` is only ever drawn from the frozen resetTables.ts array
        // above — never from caller input — so this interpolation cannot
        // carry user-controlled SQL. The bound value stays parameterized.
        const row = this.db
          .prepare(`SELECT COUNT(*) AS n FROM "${table}" WHERE tenant_id = ?`)
          .get(tenantId) as { n: number };
        counts[table] = row.n;
      }

      const totalRows = Object.values(counts).reduce((sum, n) => sum + n, 0);
      return { counts, totalRows };
    } catch (error) {
      throw new DatabaseError("Failed to compute database reset preview", {
        cause: error,
      });
    }
  }

  /**
   * Wipe every tenant-owned OPERATIONAL table and zero the kept rows'
   * balance-like columns, in ONE transaction — the shop's setup survives. See constants/resetTables.ts for what
   * each bucket means; see DATABASE_RESET_PLAN.md "Mechanics" for why
   * `defer_foreign_keys` (not `foreign_keys`, which cannot be toggled inside
   * a transaction) removes every delete-ordering concern.
   *
   * All-or-nothing: better-sqlite3's `db.transaction()` rolls back entirely
   * on any thrown error, so a failed FK check at COMMIT leaves the database
   * exactly as it was before the call.
   */
  resetTenantData(): DatabaseResetResult {
    const tenantId = getCurrentTenantId();

    try {
      const run = this.db.transaction(() => {
        // Runtime enforces `PRAGMA foreign_keys = ON` (electron-app/main.ts).
        // `foreign_keys` itself cannot be changed inside a transaction, but
        // `defer_foreign_keys` can — it postpones every FK check to COMMIT
        // and auto-resets afterward, so the deletes below can run in any
        // order with zero ordering concerns.
        this.db.pragma("defer_foreign_keys = ON");

        const deletedRows: Record<string, number> = {};

        // Step 1 — full delete, tenant-scoped. `table` is drawn ONLY from
        // the frozen resetTables.ts array — never from caller input. Setup
        // tables (categories, presets, Mobile Services items, partners,
        // suppliers, products, ...) are KEEP/ZERO and never reach here.
        for (const table of RESET_WIPE_TABLES) {
          if (!this.tableExists(table)) continue;
          const result = this.db
            .prepare(`DELETE FROM "${table}" WHERE tenant_id = ?`)
            .run(tenantId);
          deletedRows[table] = result.changes;
        }

        // Step 2 — RESET_ZERO_TABLES: KEEP the row, zero only the named
        // "balance-like" columns. `drawer_balances.balance` is the original
        // member — `ClosingRepository.hasInitialBalancesSet()` is
        // `COUNT(*) FROM drawer_balances WHERE balance != 0`; zeroing (not
        // deleting) is what re-arms the Dashboard "Starting drawer amounts
        // not set" alert + InitialDrawerAmountsModal on next login.
        // `carrier_lines.credits`/`.days_owed` (LIRA-254) joined for the
        // same reason: the line itself is shop setup like a currency, only
        // its sold balance resets — matching the zeroed drawers so the
        // LIRA-252 invariant (drawer = Σ active line credits = 0) holds.
        // `products.stock_quantity` (2026-10-07): the product is catalog
        // setup; only its quantity resets, matching its wiped batches.
        // `spec.columns` is drawn ONLY from the frozen resetTables.ts
        // constant above, never from caller input, so this interpolation
        // cannot carry user-controlled SQL (same reasoning as the table-name
        // interpolation elsewhere in this file).
        let zeroedBalances = 0;
        for (const spec of RESET_ZERO_TABLES) {
          if (!this.tableExists(spec.table)) continue;
          const setClause = spec.columns
            .map((column) => `"${column}" = 0`)
            .join(", ");
          const result = this.db
            .prepare(
              `UPDATE "${spec.table}" SET ${setClause}, updated_at = CURRENT_TIMESTAMP
               WHERE tenant_id = ?`,
            )
            .run(tenantId);
          zeroedBalances += result.changes;
        }

        const totalDeleted = Object.values(deletedRows).reduce(
          (sum, n) => sum + n,
          0,
        );

        return { deletedRows, totalDeleted, zeroedBalances };
      });

      const { deletedRows, totalDeleted, zeroedBalances } = run();

      settingsLogger.info(
        { tenantId, totalDeleted, zeroedBalances },
        "Database reset committed",
      );

      return { deletedRows, totalDeleted };
    } catch (error) {
      settingsLogger.error({ error, tenantId }, "Database reset failed");
      throw new DatabaseError("Failed to reset database", { cause: error });
    }
  }
}

let instance: DatabaseResetRepository | null = null;

export function getDatabaseResetRepository(): DatabaseResetRepository {
  if (!instance) {
    instance = new DatabaseResetRepository();
  }
  return instance;
}

export function resetDatabaseResetRepository(): void {
  instance = null;
}
