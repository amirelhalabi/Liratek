/**
 * LIRA-339 (T004) v224 — vouchers.redeemed_session_id (+ index): added by
 * up() (idempotent, no backfill), removed by down() keeping every other
 * column and row; create_db.sql declares both.
 *
 * Looked up by NAME, not number (a parallel branch may renumber it).
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
  const m = MIGRATIONS.find((x) => x.name === "vouchers_redeemed_session_id");
  if (!m || !m.down) throw new Error("v224 migration (with down) not found");
  return m as typeof m & { down: NonNullable<typeof m.down> };
}

const cols = (db: Database.Database): string[] =>
  (
    db.prepare(`PRAGMA table_info(vouchers)`).all() as Array<{ name: string }>
  ).map((c) => c.name);

const hasIndex = (db: Database.Database): boolean =>
  !!db
    .prepare(
      `SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_vouchers_redeemed_session'`,
    )
    .get();

describe("v224 vouchers.redeemed_session_id", () => {
  it("is the latest migration", () => {
    expect(MIGRATIONS[MIGRATIONS.length - 1]?.name).toBe(
      "vouchers_redeemed_session_id",
    );
  });

  it("create_db.sql declares the column and the index", () => {
    const db = new Database(":memory:");
    db.exec(CREATE_DB_SQL);
    expect(cols(db)).toContain("redeemed_session_id");
    expect(hasIndex(db)).toBe(true);
    db.close();
  });

  it("down() removes them keeping rows; up() restores them idempotently, no backfill", () => {
    const db = new Database(":memory:");
    db.exec(CREATE_DB_SQL);
    // The fixture row needs no client/user rows; only the column matters.
    db.pragma("foreign_keys = OFF");
    db.prepare(
      `INSERT INTO vouchers (tenant_id, code, client_id, client_name, amount, created_by)
       VALUES (1, 'GIFT-AAAA-BBBB', 1, 'Rami', 50, 1)`,
    ).run();
    const m = mig();
    m.down(db);
    expect(cols(db)).not.toContain("redeemed_session_id");
    expect(hasIndex(db)).toBe(false);
    expect(cols(db)).toEqual(expect.arrayContaining(["code", "redeemed_transaction_id"]));
    m.up(db);
    m.up(db);
    expect(cols(db)).toContain("redeemed_session_id");
    expect(hasIndex(db)).toBe(true);
    const row = db
      .prepare(`SELECT code, redeemed_session_id FROM vouchers`)
      .get();
    expect(row).toEqual({ code: "GIFT-AAAA-BBBB", redeemed_session_id: null });
    db.close();
  });
});
