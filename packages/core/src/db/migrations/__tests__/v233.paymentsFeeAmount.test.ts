/**
 * LIRA-400 — migration v233: `payments.fee_amount` (the payment-method fee
 * inside a leg's amount) + the partial index on fee-carrying rows. Up adds
 * the column (0 on every existing row) on the real schema rolled back to
 * v232; down drops both; create_db.sql already carries them.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS, rollbackTo, runMigrations } from "../index";

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../../electron-app/create_db.sql"),
  "utf8",
);

const cols = (db: Database.Database) =>
  (db.prepare(`PRAGMA table_info(payments)`).all() as { name: string }[]).map(
    (c) => c.name,
  );
const hasIndex = (db: Database.Database) =>
  !!db
    .prepare(
      `SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_payments_fee'`,
    )
    .get();

describe("v233 payments_fee_amount", () => {
  it("is the migration directly after v232", () => {
    const i = MIGRATIONS.findIndex((m) => m.version === 233);
    expect(MIGRATIONS[i - 1]?.version).toBe(232);
    expect(MIGRATIONS[i].name).toBe("payments_fee_amount");
  });

  it("create_db.sql carries the column and the index", () => {
    const db = new Database(":memory:");
    db.exec(CREATE_DB_SQL);
    expect(cols(db)).toContain("fee_amount");
    expect(hasIndex(db)).toBe(true);
    db.close();
  });

  it("down drops them, up adds them back; existing legs read fee 0", () => {
    const db = new Database(":memory:");
    db.exec(CREATE_DB_SQL);
    rollbackTo(db, 232);
    expect(cols(db)).not.toContain("fee_amount");
    expect(hasIndex(db)).toBe(false);
    db.prepare(
      `INSERT INTO payments (tenant_id, method, drawer_name, currency_code, amount) VALUES (1, 'WHISH', 'Whish_App', 'USD', 10)`,
    ).run();
    runMigrations(db);
    expect(cols(db)).toContain("fee_amount");
    expect(hasIndex(db)).toBe(true);
    const row = db
      .prepare(`SELECT amount, fee_amount FROM payments`)
      .get() as { amount: number; fee_amount: number };
    expect(row).toEqual({ amount: 10, fee_amount: 0 });
    db.close();
  });
});
