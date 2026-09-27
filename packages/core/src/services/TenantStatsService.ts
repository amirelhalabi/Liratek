/**
 * Admin tenant-list stats fan-out (Phase C wave 2, `docs/plans/ongoing_plans/
 * PRODUCTION_DATABASE_AND_HOSTING_PLAN.md` § 12.2/12.3, table row #8).
 *
 * `TenantRepository.listAll()`'s per-tenant subqueries (user_count,
 * last_activity) are correlated against `users`/`transactions`/`sessions`/
 * `audit_log` in the SAME file as the `tenants` row — correct in shared mode,
 * where that IS the only file, but meaningless once `TENANT_DB_MODE=
 * per-tenant` moves every shop's own data into its own file: those tables in
 * the PLATFORM file then hold none of a shop's real rows.
 *
 * This service is the fan-out `listAll()` cannot do itself (rule 13: SQL
 * stays in repositories — `TenantRepository.getShopStats()` is the one new
 * per-shop query, this class only assembles/merges): for each tenant id that
 * actually has its own database file (`listTenantDatabaseIds()`), open it
 * (via `runWithTenant`) and ask it for its OWN stats, then merge that onto
 * the platform registry row. A shop whose file fails to open (missing,
 * poisoned migration, mid-provisioning...) gets nulled-out stats and a
 * logged error — it never breaks the rest of the list.
 *
 * `listTenantDatabaseIds() === null` (shared mode, desktop, or a test that
 * never installed a lister) means no fan-out is possible OR needed:
 * `listAll()` already answers everything correctly by itself.
 */

import {
  getTenantRepository,
  type TenantRepository,
  type TenantWithStats,
} from "../repositories/TenantRepository.js";
import { listTenantDatabaseIds } from "../db/tenantDatabaseIds.js";
import { runWithTenant } from "../db/tenantContext.js";
import { tenantLogger } from "../utils/logger.js";

export class TenantStatsService {
  private tenantRepo: TenantRepository;

  constructor(tenantRepo?: TenantRepository) {
    this.tenantRepo = tenantRepo ?? getTenantRepository();
  }

  /**
   * Every tenant registry row with user_count/last_activity attached —
   * `listAll()`'s own values in shared mode, or a per-shop fan-out merged
   * onto `listAllRows()` in per-tenant mode.
   */
  listAllWithStats(): TenantWithStats[] {
    const tenantIds = listTenantDatabaseIds();
    if (tenantIds === null) {
      // Shared mode / desktop: listAll() is already complete.
      return this.tenantRepo.listAll();
    }

    const rows = this.tenantRepo.listAllRows();
    const statsById = new Map<
      number,
      { user_count: number; last_activity: string | null }
    >();

    for (const tenantId of tenantIds) {
      try {
        const stats = runWithTenant(tenantId, () =>
          this.tenantRepo.getShopStats(tenantId),
        );
        statsById.set(tenantId, stats);
      } catch (error) {
        tenantLogger.error(
          { tenantId, error },
          "TenantStatsService: failed to open tenant database for stats fan-out — reporting nulls for this tenant",
        );
      }
    }

    return rows.map((row) => {
      const stats = statsById.get(row.id);
      return {
        ...row,
        user_count: stats?.user_count ?? 0,
        last_activity: stats?.last_activity ?? null,
      };
    });
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: TenantStatsService | null = null;

export function getTenantStatsService(): TenantStatsService {
  if (!instance) {
    instance = new TenantStatsService();
  }
  return instance;
}

export function resetTenantStatsService(): void {
  instance = null;
}
