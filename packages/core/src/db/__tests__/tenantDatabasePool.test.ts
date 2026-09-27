/**
 * `TenantDatabasePool` (Phase A, `PRODUCTION_DATABASE_AND_HOSTING_PLAN.md`
 * § 11.1/§ 11.3). Covers tests 2, 4, 5, 6 and 8 from § 11.3's list; test 1
 * (singleton capture) lives in
 * `repositories/__tests__/SingletonLiveHandle.routing.test.ts`, test 3
 * (interleaved async requests) and 7 (bypass/no-resolver) in
 * `tenantDatabasePool.routing.test.ts`, test 9 (browser-entry guard) is the
 * existing `browserEntryIsNodeFree.guard.test.ts`.
 *
 * Every test here opens REAL better-sqlite3 files under `os.tmpdir()`
 * (cleaned up in `afterEach`) rather than mocking better-sqlite3 — the pool's
 * job is file existence/opening/migration-ordering, which a mock can't prove.
 * `migrate()` is a small stub (a one-table version tracker), not the real
 * LiraTek migration set: none of these tests need the production schema,
 * only the pool's CONTRACT that `migrate()` runs to completion before a
 * connection is ever handed back, and that the pool never creates a missing
 * file. `openDatabase()` is `new Database(filePath)` with no pragmas — the
 * real pragma/SQLCipher wiring is exercised in
 * `backend/src/database/__tests__/tenantResolver.test.ts` instead, since
 * that is backend's responsibility to supply, not the pool's to assume.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { TenantDatabasePool } from "../tenantDatabasePool.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "liratek-tenant-pool-"));
}

function createTenantFile(dir: string, tenantId: number): void {
  const db = new Database(path.join(dir, `${tenantId}.db`));
  db.exec(
    `CREATE TABLE pool_schema_version (version INTEGER NOT NULL);
     INSERT INTO pool_schema_version (version) VALUES (0);`,
  );
  db.close();
}

/** A stub migrate(): brings `pool_schema_version` up to `targetVersion`. */
function makeStubMigrate(targetVersion: number, onMigrate?: () => void) {
  return (db: Database.Database): void => {
    const row = db
      .prepare("SELECT version FROM pool_schema_version")
      .get() as { version: number };
    if (row.version < targetVersion) {
      db.prepare("UPDATE pool_schema_version SET version = ?").run(
        targetVersion,
      );
      onMigrate?.();
    }
  };
}

describe("TenantDatabasePool", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------
  // § 11.3 test 2 — two tenant files: a write under tenant 1 is invisible
  // under tenant 5, and vice versa.
  // ---------------------------------------------------------------------
  it("keeps two tenants' data fully isolated across two separate files", () => {
    createTenantFile(dir, 1);
    createTenantFile(dir, 5);

    const pool = new TenantDatabasePool({
      dir,
      openDatabase: (filePath) => new Database(filePath),
      migrate: makeStubMigrate(1),
    });

    const db1 = pool.get(1);
    db1.exec(
      "CREATE TABLE marker (label TEXT); INSERT INTO marker VALUES ('tenant1-row');",
    );

    const db5 = pool.get(5);
    db5.exec(
      "CREATE TABLE marker (label TEXT); INSERT INTO marker VALUES ('tenant5-row');",
    );

    const tenant1Rows = pool
      .get(1)
      .prepare("SELECT label FROM marker")
      .all() as { label: string }[];
    const tenant5Rows = pool
      .get(5)
      .prepare("SELECT label FROM marker")
      .all() as { label: string }[];

    expect(tenant1Rows).toEqual([{ label: "tenant1-row" }]);
    expect(tenant5Rows).toEqual([{ label: "tenant5-row" }]);

    pool.closeAll();
  });

  // ---------------------------------------------------------------------
  // § 11.3 test 4 — a file at an older schema version is migrated before
  // its first query.
  // ---------------------------------------------------------------------
  it("migrates a file at an older schema version before handing back the connection", () => {
    createTenantFile(dir, 1); // version 0

    const order: string[] = [];
    const pool = new TenantDatabasePool({
      dir,
      openDatabase: (filePath) => new Database(filePath),
      migrate: makeStubMigrate(3, () => order.push("migrated")),
    });

    const db = pool.get(1);
    order.push("queried");
    const { version } = db
      .prepare("SELECT version FROM pool_schema_version")
      .get() as { version: number };

    expect(version).toBe(3);
    expect(order).toEqual(["migrated", "queried"]);

    pool.closeAll();
  });

  // ---------------------------------------------------------------------
  // § 11.3 test 5 — a migration that throws on one file leaves the other
  // tenant serving; the bad tenant gets its error, repeatably.
  // ---------------------------------------------------------------------
  it("poisons only the tenant whose migration throws; every other tenant keeps serving", () => {
    createTenantFile(dir, 1);
    createTenantFile(dir, 2);

    const pool = new TenantDatabasePool({
      dir,
      openDatabase: (filePath) => new Database(filePath),
      migrate: (db) => {
        // better-sqlite3 exposes the path the connection was opened with as
        // `.name` — used here only to make ONE tenant's migration fail.
        if (db.name.endsWith(`${path.sep}2.db`) || db.name.endsWith("/2.db")) {
          throw new Error("simulated migration failure for tenant 2");
        }
      },
    });

    // Tenant 1 is unaffected.
    expect(() => pool.get(1)).not.toThrow();

    // Tenant 2 throws...
    expect(() => pool.get(2)).toThrow(/simulated migration failure/);
    // ...and throws the SAME way on every subsequent call (no retry storm),
    // while tenant 1 keeps serving normally.
    expect(() => pool.get(2)).toThrow(/simulated migration failure/);
    expect(() => pool.get(1)).not.toThrow();

    pool.closeAll();
  });

  // ---------------------------------------------------------------------
  // § 11.3 test 6 — missing tenant file ⇒ throws; no file is created on
  // disk.
  // ---------------------------------------------------------------------
  it("throws for a missing tenant file and never creates one", () => {
    const pool = new TenantDatabasePool({
      dir,
      openDatabase: (filePath) => new Database(filePath),
      migrate: makeStubMigrate(1),
    });

    const missingPath = path.join(dir, "999.db");
    expect(fs.existsSync(missingPath)).toBe(false);
    expect(() => pool.get(999)).toThrow(/no database file for tenant 999/);
    expect(fs.existsSync(missingPath)).toBe(false);
  });

  // ---------------------------------------------------------------------
  // Review finding (Phase A): confirms `openDatabaseFn` throwing leaves the
  // pool in a consistent state — no entry cached, and (unlike a migration
  // failure) the tenant is NOT poisoned, so the very next `get()` retries
  // cleanly. This is a documentation/confirmation test, not a fix — the
  // behaviour was already correct by inspection (the throw propagates out of
  // `get()` before the try/catch around `migrateFn` is ever reached), so it
  // was not written failing-first.
  // ---------------------------------------------------------------------
  it("leaves a tenant unpoisoned and uncached when openDatabaseFn itself throws", () => {
    createTenantFile(dir, 3);

    let shouldThrow = true;
    const pool = new TenantDatabasePool({
      dir,
      openDatabase: (filePath) => {
        if (shouldThrow) throw new Error("simulated open failure for tenant 3");
        return new Database(filePath);
      },
      migrate: makeStubMigrate(1),
    });

    expect(() => pool.get(3)).toThrow(/simulated open failure/);
    expect(pool.openCount()).toBe(0);

    // Unlike a migration failure, this tenant is NOT poisoned — the next
    // get() retries openDatabaseFn instead of repeating a cached error.
    shouldThrow = false;
    expect(() => pool.get(3)).not.toThrow();
    expect(pool.openCount()).toBe(1);

    pool.closeAll();
  });

  // ---------------------------------------------------------------------
  // § 11.3 test 8 — idle close then reopen works; a handle inside a
  // transaction is not closed.
  // ---------------------------------------------------------------------
  it("closes idle connections but never one mid-transaction, and reopens cleanly afterwards", () => {
    createTenantFile(dir, 1);
    createTenantFile(dir, 7);

    let now = 1_000_000;
    const pool = new TenantDatabasePool({
      dir,
      openDatabase: (filePath) => new Database(filePath),
      migrate: makeStubMigrate(1),
      idleMs: 1_000,
      clock: () => now,
    });

    const db1First = pool.get(1);
    const db7 = pool.get(7);
    expect(pool.openCount()).toBe(2);

    // Tenant 7 starts (and stays inside) a transaction.
    db7.exec("BEGIN");
    expect(db7.inTransaction).toBe(true);

    // Advance well past idleMs for both, then sweep.
    now += 10_000;
    pool.closeIdle();

    // Tenant 1 (idle, no transaction) was closed; tenant 7 (mid-transaction)
    // was left alone.
    expect(pool.openCount()).toBe(1);
    expect(db7.inTransaction).toBe(true);
    expect(() => db7.prepare("SELECT 1").get()).not.toThrow();

    // Reopening tenant 1 works and yields a fresh, usable connection.
    const db1Second = pool.get(1);
    expect(db1Second).not.toBe(db1First);
    expect(() =>
      db1Second.prepare("SELECT version FROM pool_schema_version").get(),
    ).not.toThrow();

    // Finish tenant 7's transaction, advance the clock again, and confirm it
    // NOW closes.
    db7.exec("COMMIT");
    now += 10_000;
    pool.closeIdle();
    expect(pool.openCount()).toBe(0);
  });
});
