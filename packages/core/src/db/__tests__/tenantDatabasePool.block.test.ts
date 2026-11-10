/**
 * `TenantDatabasePool.block()` / `unblock()` / `isBlocked()` (LIRA-377 shop
 * restore, research.md §R5). One shop is paused for the few seconds its file
 * is swapped; every other shop keeps serving.
 *
 * The blocked error must NOT be a `TenantContextError`: `tenantDbResolver.ts`
 * routes that error to the PLATFORM file, and a restoring shop's request must
 * never land there.
 *
 * Same fixture conventions as `tenantDatabasePool.evict.test.ts`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  ShopRestoringError,
  TenantDatabasePool,
} from "../tenantDatabasePool.js";
import { TenantContextError } from "../tenantContext.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "liratek-tenant-pool-block-"));
}

function createTenantFile(dir: string, tenantId: number): void {
  const db = new Database(path.join(dir, `${tenantId}.db`));
  db.pragma("journal_mode = WAL");
  db.exec(
    `CREATE TABLE marker (label TEXT NOT NULL);
     INSERT INTO marker (label) VALUES ('tenant-${tenantId}');`,
  );
  db.close();
}

const noopMigrate = (): void => {
  /* files are already at the expected schema */
};

describe("TenantDatabasePool.block", () => {
  let dir: string;
  let pool: TenantDatabasePool;

  beforeEach(() => {
    dir = makeTmpDir();
    createTenantFile(dir, 5);
    createTenantFile(dir, 6);
    pool = new TenantDatabasePool({
      dir,
      openDatabase: (fp) => new Database(fp),
      migrate: noopMigrate,
    });
  });

  afterEach(() => {
    pool.closeAll();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("evicts the shop's open connection and marks it blocked", () => {
    pool.get(5);
    pool.get(6);
    expect(pool.openCount()).toBe(2);

    pool.block(5);

    expect(pool.isBlocked(5)).toBe(true);
    expect(pool.isBlocked(6)).toBe(false);
    expect(pool.openCount()).toBe(1);
  });

  it("get() on a blocked shop throws ShopRestoringError, never a TenantContextError", () => {
    pool.block(5);

    let thrown: unknown;
    try {
      pool.get(5);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ShopRestoringError);
    expect(thrown).not.toBeInstanceOf(TenantContextError);
    expect((thrown as ShopRestoringError).tenantId).toBe(5);
  });

  it("other shops keep serving while one is blocked", () => {
    pool.block(5);

    const row = pool.get(6).prepare("SELECT label FROM marker").get() as {
      label: string;
    };
    expect(row.label).toBe("tenant-6");
  });

  it("unblock() lets the next get() reopen the file", () => {
    pool.get(5);
    pool.block(5);
    pool.unblock(5);

    expect(pool.isBlocked(5)).toBe(false);
    const row = pool.get(5).prepare("SELECT label FROM marker").get() as {
      label: string;
    };
    expect(row.label).toBe("tenant-5");
  });

  it("blocks a shop that had no open connection", () => {
    pool.block(5);
    expect(pool.isBlocked(5)).toBe(true);
    expect(() => pool.get(5)).toThrow(ShopRestoringError);
  });

  it("refuses to block a shop mid-transaction and leaves it unblocked and open", () => {
    const db = pool.get(5);
    db.exec("BEGIN");
    try {
      expect(() => pool.block(5)).toThrow(/transaction/i);
      expect(pool.isBlocked(5)).toBe(false);
      expect(pool.openCount()).toBe(1);
      expect(pool.get(5)).toBe(db);
    } finally {
      db.exec("COMMIT");
    }
  });

  it("unblock() on a shop that was never blocked is a harmless no-op", () => {
    expect(() => pool.unblock(5)).not.toThrow();
    expect(pool.isBlocked(5)).toBe(false);
  });
});
