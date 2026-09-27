/**
 * `TenantDatabasePool.evict()` (Phase C, `PRODUCTION_DATABASE_AND_HOSTING_PLAN.md`
 * § 12.2/12.3, table row #10 — B-D4 delete-archives-the-file). Added
 * alongside the per-tenant delete path so the archive step can release the
 * pooled connection (and checkpoint its WAL into the main file) BEFORE
 * moving `<id>.db` on disk.
 *
 * Same fixture conventions as `tenantDatabasePool.test.ts`: real
 * better-sqlite3 files under `os.tmpdir()`, a stub `migrate()`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { TenantDatabasePool } from "../tenantDatabasePool.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "liratek-tenant-pool-evict-"));
}

function createTenantFile(dir: string, tenantId: number): void {
  const db = new Database(path.join(dir, `${tenantId}.db`));
  db.pragma("journal_mode = WAL");
  db.exec(
    `CREATE TABLE pool_schema_version (version INTEGER NOT NULL);
     INSERT INTO pool_schema_version (version) VALUES (1);`,
  );
  db.close();
}

const noopMigrate = (): void => {
  /* no-op — files are already at "version 1" */
};

describe("TenantDatabasePool.evict", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns false and does nothing for a tenant with no cached connection", () => {
    createTenantFile(dir, 5);
    const pool = new TenantDatabasePool({
      dir,
      openDatabase: (fp) => new Database(fp),
      migrate: noopMigrate,
    });

    expect(pool.evict(5)).toBe(false);
    expect(pool.openCount()).toBe(0);
  });

  it("closes a cached connection and reports true", () => {
    createTenantFile(dir, 5);
    const pool = new TenantDatabasePool({
      dir,
      openDatabase: (fp) => new Database(fp),
      migrate: noopMigrate,
    });

    pool.get(5);
    expect(pool.openCount()).toBe(1);

    expect(pool.evict(5)).toBe(true);
    expect(pool.openCount()).toBe(0);
  });

  it("a SUBSEQUENT get() re-opens a fresh connection after eviction (file untouched)", () => {
    createTenantFile(dir, 5);
    const pool = new TenantDatabasePool({
      dir,
      openDatabase: (fp) => new Database(fp),
      migrate: noopMigrate,
    });

    const db1 = pool.get(5);
    db1.exec("CREATE TABLE marker (label TEXT); INSERT INTO marker VALUES ('x');");
    pool.evict(5);

    const db2 = pool.get(5);
    const row = db2.prepare("SELECT label FROM marker").get() as { label: string };
    expect(row.label).toBe("x");
    pool.closeAll();
  });

  it("refuses to evict a connection that is mid-transaction", () => {
    createTenantFile(dir, 5);
    const pool = new TenantDatabasePool({
      dir,
      openDatabase: (fp) => new Database(fp),
      migrate: noopMigrate,
    });

    const db = pool.get(5);
    db.exec("BEGIN");
    try {
      expect(() => pool.evict(5)).toThrow(/transaction/i);
      expect(pool.openCount()).toBe(1);
    } finally {
      db.exec("COMMIT");
      pool.closeAll();
    }
  });

  it("checkpoints WAL into the main file before closing", () => {
    createTenantFile(dir, 5);
    const pool = new TenantDatabasePool({
      dir,
      openDatabase: (fp) => new Database(fp),
      migrate: noopMigrate,
    });

    const db = pool.get(5);
    db.exec("CREATE TABLE marker (label TEXT); INSERT INTO marker VALUES ('checkpoint-me');");
    // Before evict: WAL-mode writes may still be sitting in the -wal file.
    pool.evict(5);

    // Reading the file with a BRAND NEW connection (not through the pool)
    // must see the row — proving the data actually reached the main file
    // rather than only the (still-open, until evict closed it) WAL.
    const verify = new Database(path.join(dir, "5.db"), { readonly: true });
    try {
      const row = verify.prepare("SELECT label FROM marker").get() as {
        label: string;
      };
      expect(row.label).toBe("checkpoint-me");
    } finally {
      verify.close();
    }
  });

  it("is a harmless no-op for a POISONED tenant (poisoning already closed its handle)", () => {
    createTenantFile(dir, 5);
    const pool = new TenantDatabasePool({
      dir,
      openDatabase: (fp) => new Database(fp),
      migrate: () => {
        throw new Error("simulated migration failure");
      },
    });

    expect(() => pool.get(5)).toThrow(/simulated migration failure/);
    // Poisoning never adds an entry (get()'s catch closes+throws before
    // reaching entries.set), so evict() sees nothing cached — false, no
    // throw. The pool stays poisoned (unrelated to eviction; a delete of a
    // poisoned tenant falls back to opening the file directly).
    expect(pool.evict(5)).toBe(false);
    expect(() => pool.get(5)).toThrow(/simulated migration failure/);
  });
});
