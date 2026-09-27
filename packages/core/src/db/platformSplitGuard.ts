/**
 * Safety lock (`docs/plans/ongoing_plans/PRODUCTION_DATABASE_AND_HOSTING_PLAN.md`
 * § 12.4, ticket item 1): decides whether the platform database still holds
 * shop data — i.e. whether the Phase D split has actually run — independent
 * of `TENANT_DB_MODE` itself.
 *
 * The problem this closes: flipping `TENANT_DB_MODE=per-tenant` WITHOUT
 * running the split leaves `/data/tenants` empty. Every shop request then
 * fails ("no database file for tenant N") — a full outage — yet the boot
 * summary says `{ok:0, failed:0}` (there is nothing to migrate, so nothing
 * fails) and the deploy verifier passes. This module gives
 * `backend/src/database/connection.ts` something to check BEFORE it installs
 * the per-tenant resolver at all, so that mistake can be refused instead of
 * silently taking every shop offline.
 *
 * Reuses `discoverTenantScopedTables()` and `quoteIdent()` from
 * `tenantSplit.ts` — the SAME PRAGMA-based discovery and identifier-quoting
 * the split tool itself uses (rule 14) — so this can never disagree with the
 * split tool about which tables carry shop data, or about which table names
 * are safe to splice into SQL.
 *
 * After a real Phase D split, the platform file holds ONLY `tenant_id IS
 * NULL` rows in every tenant-scoped table, plus the FULL `tenants` and
 * `tenant_subscriptions` tables (`tenantSplit.ts`'s header, § 12.2).
 * `tenant_subscriptions` is excluded from this check for exactly that
 * reason: it is expected to hold real, non-NULL `tenant_id` values in the
 * platform file in BOTH states — before the split (today) and after it
 * (subscriptions never move to a shop file at all) — so counting it here
 * would report "split not run" forever, even on a freshly split platform
 * database. `tenants` itself has no `tenant_id` column
 * (`discoverTenantScopedTables()` already excludes it) and is likewise
 * expected to hold every tenant's row in the platform file after the split,
 * so it needs no special-casing here.
 *
 * A brand-new, never-migrated platform file (no tables at all yet) makes
 * `discoverTenantScopedTables()` return `[]`, so this reports
 * `splitRequired: false` — correct: there is no shop data to lose, so a
 * fresh per-tenant deployment with nothing provisioned yet is safe to start
 * in per-tenant mode.
 */
import type Database from "better-sqlite3";
import { discoverTenantScopedTables, quoteIdent } from "./tenantSplit.js";

/** `tenant_subscriptions` is deliberately never split out of the platform
 * file (§ 12.2) — see the module header for why it is excluded here. */
const EXCLUDED_FROM_SPLIT_CHECK = new Set(["tenant_subscriptions"]);

export interface TableWithShopRows {
  table: string;
  rows: number;
}

export interface PlatformSplitStatus {
  /** `true` = the Phase D split has NOT run. Per-tenant routing must refuse
   * to install and behave like shared mode instead. */
  splitRequired: boolean;
  /** Every tenant-scoped table (excluding `tenant_subscriptions`) that still
   * holds at least one row with a non-NULL `tenant_id`, and how many. Empty
   * when `splitRequired` is `false`. */
  tablesWithShopRows: TableWithShopRows[];
  /** Sum of every count in `tablesWithShopRows` — a single headline number
   * for the boot log. */
  totalRows: number;
}

/**
 * Checks the given (already-open) platform database connection for shop
 * data. Read-only: runs nothing but `SELECT COUNT(*)` statements.
 */
export function checkPlatformSplitStatus(
  db: Database.Database,
): PlatformSplitStatus {
  const tenantScopedTables = discoverTenantScopedTables(db).filter(
    (table) => !EXCLUDED_FROM_SPLIT_CHECK.has(table),
  );

  const tablesWithShopRows: TableWithShopRows[] = [];
  let totalRows = 0;

  for (const table of tenantScopedTables) {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS c FROM ${quoteIdent(table)} WHERE tenant_id IS NOT NULL`,
      )
      .get() as { c: number };
    if (row.c > 0) {
      tablesWithShopRows.push({ table, rows: row.c });
      totalRows += row.c;
    }
  }

  return {
    splitRequired: tablesWithShopRows.length > 0,
    tablesWithShopRows,
    totalRows,
  };
}
