/**
 * LIRA-312 v214 — wrong_number_cards: created by up(), removed by down(),
 * with the constraints data-model.md specifies.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS } from "../index";

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../../electron-app/create_db.sql"),
  "utf8",
);

function v214() {
  const m = MIGRATIONS.find((x) => x.version === 214);
  if (!m) throw new Error("migration v214 not found");
  return m;
}

function freshPreV214(): Database.Database {
  const db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  db.exec(`DROP TABLE IF EXISTS wrong_number_cards`);
  return db;
}

function hasTable(db: Database.Database): boolean {
  return !!db
    .prepare(
      `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'wrong_number_cards'`,
    )
    .get();
}

describe("v214 wrong_number_cards", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = freshPreV214();
    v214().up(db);
    // Only the CHECK / UNIQUE constraints are under test, not the foreign keys.
    db.pragma("foreign_keys = OFF");
  });

  afterEach(() => db.close());

  const insert = (
    over: Partial<{ expense_txn: number; provider: string; carrier: string }> = {},
  ) =>
    db
      .prepare(
        `INSERT INTO wrong_number_cards
           (tenant_id, expense_id, expense_transaction_id, provider, carrier,
            mobile_service_item_id, card_label, card_cost_lbp, card_credit_usd,
            wrong_number)
         VALUES (1, 1, ?, ?, ?, 1, 'Alfa 7.58', 770000, 7.58, '03111111')`,
      )
      .run(
        over.expense_txn ?? 1,
        over.provider ?? "iPick",
        over.carrier ?? "alfa",
      );

  it("follows v213", () => {
    const i = MIGRATIONS.findIndex((m) => m.version === 214);
    expect(MIGRATIONS[i - 1].version).toBe(213);
    expect(v214().name).toBe("wrong_number_cards");
  });

  it("creates the table with id, tenant_id, created_at, updated_at", () => {
    expect(hasTable(db)).toBe(true);
    const names = (
      db.prepare(`PRAGMA table_info(wrong_number_cards)`).all() as Array<{
        name: string;
      }>
    ).map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "id",
        "tenant_id",
        "created_at",
        "updated_at",
        "sale_transaction_id",
        "right_number",
      ]),
    );
  });

  it("allows only iPick/Katsh/WHISH_APP and mtc/alfa", () => {
    expect(() => insert({ expense_txn: 1 })).not.toThrow();
    expect(() => insert({ expense_txn: 2, provider: "OMT" })).toThrow(/CHECK/);
    expect(() => insert({ expense_txn: 3, carrier: "touch" })).toThrow(/CHECK/);
  });

  it("links one record per expense transaction", () => {
    insert({ expense_txn: 7 });
    expect(() => insert({ expense_txn: 7 })).toThrow(/UNIQUE/);
  });

  it("down() removes the table", () => {
    v214().down!(db);
    expect(hasTable(db)).toBe(false);
  });
});
