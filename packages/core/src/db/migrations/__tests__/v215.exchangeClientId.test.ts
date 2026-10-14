/**
 * LIRA-321 v215 — exchange_transactions.client_id (+ its index): added by
 * up() (idempotent), removed by down() with every other column kept.
 *
 * Not proven failing-first: written after the migration (the column's
 * absence was already shown failing by ExchangeRepository.customerPayments
 * "client_id is stored…" — `no such column: client_id`).
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS } from "../index";

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../../electron-app/create_db.sql"),
  "utf8",
);

function v215() {
  const m = MIGRATIONS.find((x) => x.version === 215);
  if (!m || !m.down) throw new Error("migration v215 (with down) not found");
  return { up: m.up, down: m.down };
}

const cols = (db: Database.Database): string[] =>
  (
    db.prepare(`PRAGMA table_info(exchange_transactions)`).all() as Array<{
      name: string;
    }>
  ).map((c) => c.name);

const hasIndex = (db: Database.Database): boolean =>
  !!db
    .prepare(
      `SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_exchange_transactions_client_id'`,
    )
    .get();

describe("v215 exchange_transactions.client_id", () => {
  it("follows v214", () => {
    const i = MIGRATIONS.findIndex((m) => m.version === 215);
    expect(MIGRATIONS[i - 1].version).toBe(214);
  });

  it("create_db.sql declares the column and the index (fresh install)", () => {
    const db = new Database(":memory:");
    db.exec(CREATE_DB_SQL);
    expect(cols(db)).toContain("client_id");
    expect(hasIndex(db)).toBe(true);
    db.close();
  });

  it("down() removes them, keeping every other column and the rows; up() restores them and is idempotent", () => {
    const db = new Database(":memory:");
    db.exec(CREATE_DB_SQL);
    db.pragma("foreign_keys = OFF");
    db.prepare(
      `INSERT INTO exchange_transactions (tenant_id, type, from_currency, to_currency, amount_in, amount_out, rate, client_name)
       VALUES (1, 'SELL', 'LBP', 'USD', 89500000, 1000, 89500, 'Rami')`,
    ).run();
    const others = cols(db).filter((c) => c !== "client_id");

    v215().down(db);
    expect(cols(db)).toEqual(others);
    expect(hasIndex(db)).toBe(false);
    expect(
      db.prepare(`SELECT client_name FROM exchange_transactions`).get(),
    ).toEqual({ client_name: "Rami" });

    v215().up(db);
    v215().up(db);
    expect(cols(db)).toEqual([...others, "client_id"]);
    expect(hasIndex(db)).toBe(true);
    db.close();
  });
});
