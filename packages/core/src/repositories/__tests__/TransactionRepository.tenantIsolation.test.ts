/**
 * TransactionRepository — cross-tenant isolation (multi-tenant retrofit,
 * WP3a, CLAUDE.md rule 17 regression proof).
 *
 * `transactions` is the unified accounting journal every module writes to;
 * it is a single physical table shared by every tenant. Two tenants are
 * seeded with MIRRORED rows that additionally share the SAME
 * (source_table, source_id) pair (both post a 'sales' transaction for
 * source_id 500) — proving that a get-by-id-style lookup can't be tricked
 * into crossing tenants even when the caller's own key collides with
 * another tenant's row. Money amounts are `base × mult` so a leak into any
 * SUM shows up as a wrong number, not just an extra row.
 *
 * This file proves, under `runWithTenant(1, ...)`:
 *   - getRecent() (the main list read, plus its `_attachPaymentLegs` join)
 *     returns ONLY tenant 1's row and ONLY tenant 1's payment leg.
 *   - getBySourceId() (a get-by-id-style lookup) cannot return tenant 2's
 *     row for the identical source_table/source_id.
 *   - getDailySummary() (a GROUP BY aggregate) sums ONLY tenant 1's amounts.
 *   - getRevenueByUser() (an aggregate with a scoped LEFT JOIN) attributes
 *     revenue ONLY to tenant 1's user.
 *
 * Per rule 17: the getRecent() assertion below was verified to FAIL when the
 * seed `"t.tenant_id = ?"` predicate/param was temporarily removed from
 * `TransactionRepository.getRecent()` (both tenants' rows leaked back in,
 * inflating the row count from 1 to 2) — the predicate was then restored and
 * the revert verified identical via `git diff` before this file was
 * finalized.
 */

import Database from "better-sqlite3";
import { TransactionRepository } from "../TransactionRepository.js";
import { runWithTenant } from "../../db/tenantContext.js";

const D = "2026-01-15 10:00:00";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      username  TEXT NOT NULL
    );

    CREATE TABLE clients (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id    INTEGER,
      full_name    TEXT,
      phone_number TEXT
    );

    CREATE TABLE transactions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id     INTEGER,
      type          TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table  TEXT NOT NULL,
      source_id     INTEGER NOT NULL,
      user_id       INTEGER NOT NULL,
      amount_usd    REAL NOT NULL DEFAULT 0,
      amount_lbp    REAL NOT NULL DEFAULT 0,
      profit_usd    REAL NOT NULL DEFAULT 0,
      profit_lbp    REAL NOT NULL DEFAULT 0,
      exchange_rate REAL,
      client_id     INTEGER,
      client_name   TEXT,
      client_phone  TEXT,
      reverses_id   INTEGER,
      summary       TEXT,
      metadata_json TEXT,
      device_id     TEXT,
      created_at    TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id      INTEGER,
      transaction_id INTEGER,
      session_id     INTEGER,
      method         TEXT NOT NULL,
      drawer_name    TEXT NOT NULL,
      currency_code  TEXT NOT NULL,
      amount         REAL NOT NULL,
      note           TEXT,
      created_by     INTEGER,
      created_at     TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Only needs to exist for getRecent()'s LEFT JOIN — no rows required
    -- since neither seeded transaction belongs to a customer-basket session.
    CREATE TABLE customer_session_transactions (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id              INTEGER,
      session_id             INTEGER NOT NULL,
      unified_transaction_id INTEGER
    );
  `);
  return db;
}

/**
 * Seed one tenant's mirrored SALE transaction (+ its CASH payment leg).
 * Deliberately reuses the SAME `sourceId` across tenants — proves that
 * getBySourceId()'s tenant scoping (not the uniqueness of the id itself) is
 * what keeps tenants apart.
 */
function seedTenant(
  db: Database.Database,
  tenantId: number,
  mult: number,
  username: string,
  sourceId: number,
): number {
  db.prepare(
    `INSERT INTO users (id, tenant_id, username) VALUES (?, ?, ?)`,
  ).run(tenantId, tenantId, username);

  const txnResult = db
    .prepare(
      `INSERT INTO transactions
         (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, created_at)
       VALUES (?, 'SALE', 'ACTIVE', 'sales', ?, ?, ?, 0, ?)`,
    )
    .run(tenantId, sourceId, tenantId, 100 * mult, D);
  const txnId = Number(txnResult.lastInsertRowid);

  db.prepare(
    `INSERT INTO payments (tenant_id, transaction_id, method, drawer_name, currency_code, amount, created_at)
     VALUES (?, ?, 'CASH', 'General', 'USD', ?, ?)`,
  ).run(tenantId, txnId, 100 * mult, D);

  return txnId;
}

describe("TransactionRepository — cross-tenant isolation", () => {
  let db: Database.Database;
  let repo: TransactionRepository;

  beforeEach(() => {
    db = createTestDb();
    (globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }).__LIRATEK_TEST_DB__ = db;
    repo = new TransactionRepository();
  });

  afterEach(() => {
    delete (globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }).__LIRATEK_TEST_DB__;
    db.close();
  });

  it("getRecent(): tenant 1 sees ONLY its own row, with ONLY its own payment leg attached", () => {
    seedTenant(db, 1, 1, "alice", 500);
    seedTenant(db, 2, 3, "bob", 500); // same source_id — must not leak into tenant 1's list

    const rowsT1 = runWithTenant(1, () => repo.getRecent(50));
    expect(rowsT1).toHaveLength(1);
    expect(rowsT1[0].amount_usd).toBe(100);
    expect(rowsT1[0].username).toBe("alice");
    expect(rowsT1[0].payments).toHaveLength(1);
    expect(rowsT1[0].payments[0].amount).toBe(100);

    const rowsT2 = runWithTenant(2, () => repo.getRecent(50));
    expect(rowsT2).toHaveLength(1);
    expect(rowsT2[0].amount_usd).toBe(300);
    expect(rowsT2[0].username).toBe("bob");
  });

  it("getBySourceId(): tenant 1 cannot fetch tenant 2's transaction for the identical source_table/source_id", () => {
    seedTenant(db, 1, 1, "alice", 500);
    seedTenant(db, 2, 3, "bob", 500);

    const seenByTenant1 = runWithTenant(1, () => repo.getBySourceId("sales", 500));
    expect(seenByTenant1?.amount_usd).toBe(100);

    const seenByTenant2 = runWithTenant(2, () => repo.getBySourceId("sales", 500));
    expect(seenByTenant2?.amount_usd).toBe(300);
  });

  it("getDailySummary(): SUM(amount_usd) reflects ONLY the active tenant's rows", () => {
    seedTenant(db, 1, 1, "alice", 500);
    seedTenant(db, 2, 3, "bob", 501);

    const summaryT1 = runWithTenant(1, () => repo.getDailySummary("2026-01-15"));
    expect(summaryT1.total_usd).toBe(100); // NOT 400
    expect(summaryT1.by_type).toHaveLength(1);
    expect(summaryT1.by_type[0].total_usd).toBe(100);

    const summaryT2 = runWithTenant(2, () => repo.getDailySummary("2026-01-15"));
    expect(summaryT2.total_usd).toBe(300);
  });

  it("getRevenueByUser(): per-user revenue does not include the other tenant's user", () => {
    seedTenant(db, 1, 1, "alice", 500);
    seedTenant(db, 2, 3, "bob", 501);

    const rowsT1 = runWithTenant(1, () =>
      repo.getRevenueByUser("2026-01-15 00:00:00", "2026-01-15 23:59:59"),
    );
    expect(rowsT1).toHaveLength(1);
    expect(rowsT1[0].username).toBe("alice");
    expect(rowsT1[0].total_usd).toBe(100);

    const rowsT2 = runWithTenant(2, () =>
      repo.getRevenueByUser("2026-01-15 00:00:00", "2026-01-15 23:59:59"),
    );
    expect(rowsT2).toHaveLength(1);
    expect(rowsT2[0].username).toBe("bob");
    expect(rowsT2[0].total_usd).toBe(300);
  });
});
