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
  RESET_RESEED_TABLES,
  RESET_ZERO_TABLES,
  SUPPLIER_KEEP_PREDICATE,
  PRODUCT_CATEGORY_DEFAULTS,
  SERVICE_PRESET_DEFAULTS,
  type DatabaseResetPreview,
  type DatabaseResetResult,
} from "../constants/resetTables.js";

/** `suppliers` is the one WIPE-PARTIAL table; not itself exported from
 *  resetTables.ts as a bucket array member beyond `RESET_PARTIAL_TABLES`,
 *  named here once for the two SQL sites (preview count + delete) that need it. */
const SUPPLIERS_TABLE = "suppliers";

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
   * Row counts a reset would touch, for the confirmation UI. Counts
   * `RESET_WIPE_TABLES` + `RESET_RESEED_TABLES` (all full-delete-then-maybe-
   * reseed tables) plus the ad-hoc-supplier subset of `suppliers`
   * (`RESET_PARTIAL_TABLES`). Tables absent from the current schema are
   * skipped via `tableExists` rather than throwing — an older install may
   * legitimately lag a migration or two behind the newest classified table.
   */
  previewCounts(): DatabaseResetPreview {
    try {
      const tenantId = getCurrentTenantId();
      const counts: Record<string, number> = {};

      for (const table of [...RESET_WIPE_TABLES, ...RESET_RESEED_TABLES]) {
        if (!this.tableExists(table)) continue;
        // `table` is only ever drawn from the frozen resetTables.ts arrays
        // above — never from caller input — so this interpolation cannot
        // carry user-controlled SQL. The bound value stays parameterized.
        const row = this.db
          .prepare(`SELECT COUNT(*) AS n FROM "${table}" WHERE tenant_id = ?`)
          .get(tenantId) as { n: number };
        counts[table] = row.n;
      }

      if (this.tableExists(SUPPLIERS_TABLE)) {
        const row = this.db
          .prepare(
            `SELECT COUNT(*) AS n FROM suppliers
             WHERE tenant_id = ? AND NOT ${SUPPLIER_KEEP_PREDICATE}`,
          )
          .get(tenantId) as { n: number };
        counts[SUPPLIERS_TABLE] = row.n;
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
   * Reset every tenant-owned operational table to the fresh-install
   * baseline, in ONE transaction. See constants/resetTables.ts for what
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

        // Step 1 — full delete, tenant-scoped. RESET_RESEED_TABLES tables
        // are wiped here too; they get their fresh-install rows back in
        // Step 2. `table` is drawn ONLY from the frozen resetTables.ts
        // arrays — never from caller input.
        for (const table of [...RESET_WIPE_TABLES, ...RESET_RESEED_TABLES]) {
          if (!this.tableExists(table)) continue;
          const result = this.db
            .prepare(`DELETE FROM "${table}" WHERE tenant_id = ?`)
            .run(tenantId);
          deletedRows[table] = result.changes;
        }

        // Step 2 (suppliers, WIPE PARTIAL) — delete only ad-hoc suppliers.
        // See SUPPLIER_KEEP_PREDICATE's doc comment: `is_system` alone is
        // NOT a safe gate because the seeded `Whish` row has
        // `is_system = 0` but `module_key = 'omt_whish'`.
        if (this.tableExists(SUPPLIERS_TABLE)) {
          const supplierResult = this.db
            .prepare(
              `DELETE FROM suppliers
               WHERE tenant_id = ? AND NOT ${SUPPLIER_KEEP_PREDICATE}`,
            )
            .run(tenantId);
          deletedRows[SUPPLIERS_TABLE] = supplierResult.changes;
        }

        // Step 3 — re-seed product_categories / service_presets with the
        // exact create_db.sql fresh-install defaults, under the current
        // tenant. created_at/updated_at are left to each column's own
        // DEFAULT CURRENT_TIMESTAMP.
        if (this.tableExists("product_categories")) {
          const insertCategory = this.db.prepare(
            `INSERT INTO product_categories (tenant_id, name, sort_order, tracks_imei_units)
             VALUES (?, ?, ?, ?)`,
          );
          for (const cat of PRODUCT_CATEGORY_DEFAULTS) {
            insertCategory.run(
              tenantId,
              cat.name,
              cat.sort_order,
              cat.tracks_imei_units,
            );
          }
        }

        if (this.tableExists("service_presets")) {
          const insertPreset = this.db.prepare(
            `INSERT INTO service_presets (tenant_id, name, category, cost_usd, price_usd, sort_order)
             VALUES (?, ?, ?, ?, ?, ?)`,
          );
          for (const preset of SERVICE_PRESET_DEFAULTS) {
            insertPreset.run(
              tenantId,
              preset.name,
              preset.category,
              preset.cost_usd,
              preset.price_usd,
              preset.sort_order,
            );
          }
        }

        // Step 4 — drawer_balances: ZERO the balance, do NOT delete the
        // row. `ClosingRepository.hasInitialBalancesSet()` is
        // `COUNT(*) FROM drawer_balances WHERE balance != 0`; zeroing (not
        // deleting) is what re-arms the Dashboard "Starting drawer amounts
        // not set" alert + InitialDrawerAmountsModal on next login.
        let zeroedBalances = 0;
        for (const table of RESET_ZERO_TABLES) {
          if (!this.tableExists(table)) continue;
          const result = this.db
            .prepare(
              `UPDATE "${table}" SET balance = 0, updated_at = CURRENT_TIMESTAMP
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
