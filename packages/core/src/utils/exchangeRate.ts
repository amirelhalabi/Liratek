import type Database from "better-sqlite3";
import { getCurrentTenantId } from "../db/tenantContext.js";

/** Fallback USD→LBP rate when no row/table is available (e.g. test harnesses). */
export const FALLBACK_USD_LBP_RATE = 89500;

/**
 * Cache of whether `exchange_rates` has a `tenant_id` column, keyed by the
 * `Database` handle. Production/desktop and every real web tenant have it —
 * `exchange_rates` has been UNIQUE (tenant_id, to_code) since the
 * multi-tenant foundation migration (db/migrations/index.ts, "Multi-tenant
 * foundation (WP0)") — but a handful of repository unit-test fixtures
 * (RechargeRepository.stampedExchangeRate.test.ts and others) still build a
 * legacy `exchange_rates` table with no `tenant_id` column at all; those are
 * lane-owned by other repositories and must keep working unedited (PA-1.8).
 * The column set of an open connection never changes, so each handle is
 * probed at most once. A `WeakMap` (rather than `BaseRepository`'s
 * per-instance cache) because this module is plain functions, not a class,
 * and many `Database` handles can exist across a test run.
 */
const tenantColumnCache = new WeakMap<Database.Database, boolean>();

function exchangeRatesHasTenantColumn(db: Database.Database): boolean {
  const cached = tenantColumnCache.get(db);
  if (cached !== undefined) {
    return cached;
  }
  let hasTenantId: boolean;
  try {
    const cols = db.prepare(`PRAGMA table_info(exchange_rates)`).all() as {
      name: string;
    }[];
    hasTenantId = cols.some((c) => c.name === "tenant_id");
  } catch {
    hasTenantId = false;
  }
  tenantColumnCache.set(db, hasTenantId);
  return hasTenantId;
}

/**
 * Current USD→LBP **sell** rate (the rate a customer pays — Money IN) read from
 * the `exchange_rates` table. Used to stamp `transactions.exchange_rate` at
 * creation time so the rate-of-record is captured alongside the payment legs.
 *
 * **Tenant-scoped (PA-1.8).** `exchange_rates` is a per-tenant table, but this
 * read carried no `tenant_id` predicate — on web, one tenant could read
 * another tenant's configured rate (recharge stamps derive from it,
 * `RechargeRepository.ts` ~:759). Fixed HERE, via `getCurrentTenantId()`,
 * rather than at each of the four call sites (`DebtRepository`,
 * `ExchangeRepository`, `FinancialServiceRepository`, `RechargeRepository`),
 * which keep calling `getUsdLbpSellRate(this.db)` unchanged. Desktop is
 * unaffected: `initFixedTenantContext(1)` at boot makes
 * `getCurrentTenantId()` resolve to tenant 1 exactly like every other
 * tenant-scoped repository read already does. The predicate is applied only
 * when the column is present (see {@link exchangeRatesHasTenantColumn}) so
 * legacy test fixtures without it keep behaving exactly as before.
 *
 * Defensive by design: if the table or row is missing (unit-test in-memory
 * DBs, fresh installs) — or the tenant context can't be resolved at all, which
 * fails closed to the fallback rather than ever reading another tenant's row
 * — it returns {@link FALLBACK_USD_LBP_RATE} instead of throwing.
 */
export function getUsdLbpSellRate(
  db: Database.Database,
  toCode = "LBP",
): number {
  try {
    const row = exchangeRatesHasTenantColumn(db)
      ? (db
          .prepare(
            `SELECT sell_rate, market_rate FROM exchange_rates WHERE tenant_id = ? AND to_code = ? LIMIT 1`,
          )
          .get(getCurrentTenantId(), toCode) as
          | { sell_rate?: number; market_rate?: number }
          | undefined)
      : (db
          .prepare(
            `SELECT sell_rate, market_rate FROM exchange_rates WHERE to_code = ? LIMIT 1`,
          )
          .get(toCode) as { sell_rate?: number; market_rate?: number } | undefined);
    return row?.sell_rate ?? row?.market_rate ?? FALLBACK_USD_LBP_RATE;
  } catch {
    return FALLBACK_USD_LBP_RATE;
  }
}
