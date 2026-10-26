/**
 * LIRA-346 v225 — partner_settlement_coverage (+ indexes) and
 * partner_ledger.legacy_covered_amount (backfilled from covered_amount).
 * up() is idempotent, down() removes both and keeps every other column and
 * row; create_db.sql declares both.
 *
 * Looked up by NAME, not number.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS } from "../index";

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../../electron-app/create_db.sql"),
  "utf8",
);

function mig() {
  const m = MIGRATIONS.find((x) => x.name === "partner_settlement_coverage");
  if (!m || !m.down) throw new Error("v225 migration (with down) not found");
  return m as typeof m & { down: NonNullable<typeof m.down> };
}

const ledgerCols = (db: Database.Database): string[] =>
  (
    db.prepare(`PRAGMA table_info(partner_ledger)`).all() as Array<{
      name: string;
    }>
  ).map((c) => c.name);

const hasTable = (db: Database.Database): boolean =>
  !!db
    .prepare(
      `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'partner_settlement_coverage'`,
    )
    .get();

const indexes = (db: Database.Database): string[] =>
  (
    db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'partner_settlement_coverage' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      )
      .all() as Array<{ name: string }>
  ).map((r) => r.name);

describe("v225 partner_settlement_coverage", () => {
  it("is version 225, the latest migration", () => {
    const m = mig();
    expect(m.version).toBe(225);
    expect(MIGRATIONS[MIGRATIONS.length - 1]?.name).toBe(
      "partner_settlement_coverage",
    );
  });

  it("create_db.sql declares the table, its indexes and the legacy column", () => {
    const db = new Database(":memory:");
    db.exec(CREATE_DB_SQL);
    expect(hasTable(db)).toBe(true);
    expect(indexes(db)).toEqual(["idx_psc_head", "idx_psc_settlement", "idx_psc_transaction"]);
    expect(ledgerCols(db)).toContain("legacy_covered_amount");
    const row = db
      .prepare(
        `SELECT 1 FROM schema_migrations WHERE version = 225 AND name = 'partner_settlement_coverage'`,
      )
      .get();
    expect(row).toBeTruthy();
    db.close();
  });

  it("the table checks amount > 0, side, currency and source", () => {
    const db = new Database(":memory:");
    db.exec(CREATE_DB_SQL);
    db.pragma("foreign_keys = OFF");
    const ins = db.prepare(
      `INSERT INTO partner_settlement_coverage
         (tenant_id, transaction_id, settlement_ledger_id, partner_ledger_id, partner_id, currency, side, amount, source)
       VALUES (1, NULL, 1, 2, 1, ?, ?, ?, ?)`,
    );
    expect(() => ins.run("USD", "DEBIT", 10, "PAYMENT")).not.toThrow();
    expect(() => ins.run("USD", "DEBIT", 0, "PAYMENT")).toThrow();
    expect(() => ins.run("USDT", "DEBIT", 1, "PAYMENT")).toThrow();
    expect(() => ins.run("USD", "UP", 1, "PAYMENT")).toThrow();
    expect(() => ins.run("USD", "CREDIT", 1, "BOGUS")).toThrow();
    for (const s of ["NETTING", "WAIVE", "DISCOUNT", "RELIEF"]) {
      expect(() => ins.run("LBP", "CREDIT", 1, s)).not.toThrow();
    }
    db.close();
  });

  it("down() removes both keeping rows; up() restores them idempotently and backfills legacy_covered_amount", () => {
    const db = new Database(":memory:");
    db.exec(CREATE_DB_SQL);
    db.pragma("foreign_keys = OFF");
    db.prepare(
      `INSERT INTO partner_ledger (tenant_id, partner_id, transaction_type, amount, currency, direction, covered_amount)
       VALUES (1, 1, 'FOR_POS', 100, 'USD', 'DEBIT', 60)`,
    ).run();
    const m = mig();
    m.down(db);
    expect(hasTable(db)).toBe(false);
    expect(ledgerCols(db)).not.toContain("legacy_covered_amount");
    expect(ledgerCols(db)).toEqual(
      expect.arrayContaining(["covered_amount", "transaction_type"]),
    );
    m.up(db);
    m.up(db);
    expect(hasTable(db)).toBe(true);
    expect(indexes(db)).toEqual(["idx_psc_head", "idx_psc_settlement", "idx_psc_transaction"]);
    expect(
      db
        .prepare(`SELECT covered_amount, legacy_covered_amount FROM partner_ledger`)
        .get(),
    ).toEqual({ covered_amount: 60, legacy_covered_amount: 60 });
    db.close();
  });
});
