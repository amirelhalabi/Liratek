/**
 * PA-1.8 (LANE LR) — `getUsdLbpSellRate` (utils/exchangeRate.ts ~:14-28) had
 * NO tenant filter. `exchange_rates` has been a per-tenant table (UNIQUE
 * (tenant_id, to_code)) since the multi-tenant foundation migration
 * (packages/core/src/db/migrations/index.ts, "Multi-tenant foundation
 * (WP0)"), but this read still did `SELECT ... WHERE to_code = ? LIMIT 1`
 * with no `tenant_id` predicate — on web, one tenant could read another
 * tenant's configured sell rate, and recharge stamps derive from it
 * (RechargeRepository.ts ~:759).
 *
 * Fixed HERE (inside exchangeRate.ts, via `getCurrentTenantId()`) so the
 * four call sites (DebtRepository, ExchangeRepository,
 * FinancialServiceRepository, RechargeRepository) need no edits — they
 * already just call `getUsdLbpSellRate(this.db)`.
 *
 * RULE 17 — RED, actually run (`npx jest exchangeRate.tenantScoping
 * --maxWorkers=1`, 2026-09-23) against the PRE-FIX code — the plain
 * `WHERE to_code = ? LIMIT 1` query, no tenant_id predicate anywhere:
 *
 *   FAIL packages/core/src/utils/__tests__/exchangeRate.tenantScoping.test.ts
 *     ✕ tenant 2 reads its OWN rate (92,000), not tenant 1's
 *       Expected: 92000 / Received: 90000
 *     ✕ switching tenants on the SAME db connection switches the answer
 *       Expected: 92000 / Received: 90000
 *     ✕ a tenant with no row of its own falls back, never reads another
 *       tenant's row
 *       Expected: 89500 / Received: 90000
 *     ✕ falls back to FALLBACK_USD_LBP_RATE (fail-closed, never cross-
 *       tenant) when the column exists but no tenant context is active
 *       Expected: 89500 / Received: 90000
 *   Tests: 4 failed, 5 passed, 9 total — SQLite returned whichever row
 *   LIMIT 1 happened to pick first (tenant 1's, insertion order) for every
 *   tenant scope and even with no tenant context at all, which is exactly
 *   the cross-tenant leak PA-1.8 describes.
 *
 * GREEN after adding the `tenant_id = ?` predicate, gated on the column
 * actually being present (a handful of existing repository unit-test
 * fixtures still build a legacy `exchange_rates` table with no `tenant_id`
 * column at all — see the "single-tenant desktop path" describe block,
 * which mirrors those fixtures verbatim and must keep passing untouched).
 */

import Database from "better-sqlite3";
import { getUsdLbpSellRate, FALLBACK_USD_LBP_RATE } from "../exchangeRate";
import {
  initFixedTenantContext,
  resetTenantContext,
  runWithTenant,
} from "../../db/tenantContext";

/** Mirrors electron-app/create_db.sql's `exchange_rates` table exactly. */
function createProductionShapedDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE exchange_rates (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id   INTEGER,
      to_code     TEXT    NOT NULL,
      market_rate REAL    NOT NULL,
      buy_rate    REAL    NOT NULL,
      sell_rate   REAL    NOT NULL,
      is_stronger INTEGER NOT NULL DEFAULT 1 CHECK(is_stronger IN (1, -1)),
      updated_at  TEXT    DEFAULT (datetime('now')),
      UNIQUE (tenant_id, to_code)
    );
  `);
  return db;
}

function seedRate(
  db: Database.Database,
  tenantId: number,
  sellRate: number,
): void {
  db.prepare(
    `INSERT INTO exchange_rates (tenant_id, to_code, market_rate, buy_rate, sell_rate, is_stronger)
     VALUES (?, 'LBP', ?, ?, ?, 1)`,
  ).run(tenantId, sellRate - 500, sellRate - 1000, sellRate);
}

describe("getUsdLbpSellRate — tenant scoping (PA-1.8)", () => {
  afterEach(() => {
    resetTenantContext();
  });

  describe("cross-tenant isolation (web path — runWithTenant)", () => {
    let db: Database.Database;

    beforeEach(() => {
      db = createProductionShapedDb();
      seedRate(db, 1, 90000); // tenant 1's configured sell rate
      seedRate(db, 2, 92000); // tenant 2's — deliberately different
    });

    afterEach(() => {
      db.close();
    });

    it("tenant 1 reads its OWN rate (90,000), not tenant 2's", () => {
      const rate = runWithTenant(1, () => getUsdLbpSellRate(db));
      expect(rate).toBe(90000);
    });

    it("tenant 2 reads its OWN rate (92,000), not tenant 1's", () => {
      const rate = runWithTenant(2, () => getUsdLbpSellRate(db));
      expect(rate).toBe(92000);
    });

    it("switching tenants on the SAME db connection switches the answer", () => {
      expect(runWithTenant(1, () => getUsdLbpSellRate(db))).toBe(90000);
      expect(runWithTenant(2, () => getUsdLbpSellRate(db))).toBe(92000);
      expect(runWithTenant(1, () => getUsdLbpSellRate(db))).toBe(90000);
    });

    it("a tenant with no row of its own falls back, never reads another tenant's row", () => {
      // tenant 3 has no exchange_rates row at all — must NOT silently read
      // tenant 1's or tenant 2's.
      const rate = runWithTenant(3, () => getUsdLbpSellRate(db));
      expect(rate).toBe(FALLBACK_USD_LBP_RATE);
    });
  });

  describe("single-tenant desktop path is unchanged", () => {
    it("production-shaped table + initFixedTenantContext(1) (desktop boot) still reads the row", () => {
      const db = createProductionShapedDb();
      seedRate(db, 1, 90000);
      initFixedTenantContext(1);
      expect(getUsdLbpSellRate(db)).toBe(90000);
      db.close();
    });

    it("legacy fixture with NO tenant_id column (existing repo unit tests, e.g. RechargeRepository.stampedExchangeRate.test.ts) still reads the row, untouched", () => {
      const db = new Database(":memory:");
      db.exec(`
        CREATE TABLE exchange_rates (
          to_code     TEXT,
          sell_rate   REAL,
          market_rate REAL
        );
        INSERT INTO exchange_rates (to_code, sell_rate) VALUES ('LBP', 90000);
      `);
      initFixedTenantContext(1);
      expect(getUsdLbpSellRate(db)).toBe(90000);
      db.close();
    });

    it("legacy fixture works even with NO tenant context active at all (desktop tests that never call initFixedTenantContext)", () => {
      const db = new Database(":memory:");
      db.exec(`
        CREATE TABLE exchange_rates (
          to_code     TEXT,
          sell_rate   REAL,
          market_rate REAL
        );
        INSERT INTO exchange_rates (to_code, sell_rate) VALUES ('LBP', 90000);
      `);
      expect(getUsdLbpSellRate(db)).toBe(90000);
      db.close();
    });

    it("falls back to FALLBACK_USD_LBP_RATE when the table is missing (unit-test harnesses)", () => {
      const db = new Database(":memory:");
      initFixedTenantContext(1);
      expect(getUsdLbpSellRate(db)).toBe(FALLBACK_USD_LBP_RATE);
      db.close();
    });

    it("falls back to FALLBACK_USD_LBP_RATE (fail-closed, never cross-tenant) when the column exists but no tenant context is active", () => {
      const db = createProductionShapedDb();
      seedRate(db, 1, 90000);
      // No initFixedTenantContext / runWithTenant here — getCurrentTenantId()
      // throws TenantContextError, caught by the same defensive try/catch
      // that already covers a missing table/row.
      expect(getUsdLbpSellRate(db)).toBe(FALLBACK_USD_LBP_RATE);
      db.close();
    });
  });
});
