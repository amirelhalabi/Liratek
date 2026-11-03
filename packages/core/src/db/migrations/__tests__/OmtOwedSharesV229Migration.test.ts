/**
 * LIRA-370 — migration v229 `omt_owed_shares`.
 *
 * Proves: up() creates the table with its checks and the two indexes; up()
 * is idempotent; down() drops them; a fresh create_db.sql already has the
 * table and records v229.
 *
 * Written with the migration (not proven failing-first).
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS } from "../index";

const migration = MIGRATIONS.find((m) => m.version === 229);

function hasTable(db: Database.Database): boolean {
  return (
    db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'omt_owed_shares'`)
      .get() !== undefined
  );
}

function indexes(db: Database.Database): string[] {
  return (
    db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'omt_owed_shares' AND name LIKE 'idx_%'`,
      )
      .all() as Array<{ name: string }>
  ).map((r) => r.name);
}

describe("migration v229 — omt_owed_shares", () => {
  it("is the last entry and is registered", () => {
    expect(MIGRATIONS[MIGRATIONS.length - 1]?.version).toBe(229);
    expect(migration?.name).toBe("omt_owed_shares");
  });

  it("creates the table and indexes; amount and currency are checked", () => {
    const db = new Database(":memory:");
    // A bare database has none of the referenced tables.
    db.pragma("foreign_keys = OFF");
    migration!.up(db);
    expect(hasTable(db)).toBe(true);
    expect(indexes(db).sort()).toEqual(["idx_omt_owed_shares_fs", "idx_omt_owed_shares_live"]);
    const insert = (amount: number, currency: string) =>
      db
        .prepare(
          `INSERT INTO omt_owed_shares
             (tenant_id, financial_service_id, omt_service_type, currency, amount,
              created_settlement_txn_id, created_anchor_ledger_id)
           VALUES (1, 1, 'INTRA', ?, ?, 1, 1)`,
        )
        .run(currency, amount);
    expect(() => insert(0.2, "USD")).not.toThrow();
    expect(() => insert(0, "USD")).toThrow();
    expect(() => insert(1, "EUR")).toThrow();
    const row = db.prepare(`SELECT * FROM omt_owed_shares WHERE id = 1`).get() as Record<
      string,
      unknown
    >;
    expect(row.is_reversed).toBe(0);
    expect(row.cleared_settlement_txn_id).toBeNull();
    expect(row.created_at).toEqual(expect.any(String));
    expect(row.updated_at).toEqual(expect.any(String));
    expect(() => migration!.up(db)).not.toThrow();
  });

  it("down() drops the table", () => {
    const db = new Database(":memory:");
    migration!.up(db);
    migration!.down!(db);
    expect(hasTable(db)).toBe(false);
    expect(() => migration!.down!(db)).not.toThrow();
  });

  it("a fresh create_db.sql already has the table and records v229", () => {
    const db = new Database(":memory:");
    db.exec(
      fs.readFileSync(
        path.join(__dirname, "../../../../../../electron-app/create_db.sql"),
        "utf-8",
      ),
    );
    expect(hasTable(db)).toBe(true);
    expect(indexes(db).sort()).toEqual(["idx_omt_owed_shares_fs", "idx_omt_owed_shares_live"]);
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%migration%'`)
      .all() as Array<{ name: string }>;
    const versions = tables.flatMap(({ name }) =>
      (db.prepare(`SELECT * FROM ${name}`).all() as Array<Record<string, unknown>>).map(
        (r) => r.version,
      ),
    );
    expect(versions).toContain(229);
  });
});
