/**
 * v219 — partner_ledger.settlement_method accepts 'SPLIT' (shop-day bug
 * 2026-10-16: a Cash + Whish partner settlement had to be stored as 'CASH').
 *
 * The rebuild must keep every column added after the last hand-written
 * rebuild (covered_amount — FIFO coverage that profit depends on), every
 * row value and every index; down() maps SPLIT rows to NULL and restores
 * the old CHECK.
 *
 * Not proven failing-first (rule 17): written alongside the migration; the
 * behaviour guard is PartnerService.settleLedgerMethod.test.ts.
 */

import Database from "better-sqlite3";
import { MIGRATIONS } from "../index";

const v219 = MIGRATIONS.find((m) => m.version === 219)!;

function oldSchema(db: Database.Database): void {
  // v127's rebuild + v128's ALTER + the tenant index, as live DBs have it.
  db.exec(`
    CREATE TABLE partner_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER,
        partner_id INTEGER NOT NULL,
        transaction_type TEXT NOT NULL,
        reference_table TEXT,
        reference_id INTEGER,
        amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        direction TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
        notes TEXT,
        user_id INTEGER,
        settlement_method TEXT CHECK(settlement_method IN ('CASH', 'OMT', 'WHISH', 'BINANCE', 'CLIENT_ACCOUNT')),
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX idx_partner_ledger_partner_id ON partner_ledger(partner_id);
    CREATE INDEX idx_partner_ledger_created_at ON partner_ledger(created_at);
    CREATE INDEX idx_partner_ledger_tenant_id ON partner_ledger(tenant_id);
    ALTER TABLE partner_ledger ADD COLUMN covered_amount REAL NOT NULL DEFAULT 0;
    INSERT INTO partner_ledger (tenant_id, partner_id, transaction_type, amount, currency, direction, notes, user_id, settlement_method, created_at, covered_amount)
    VALUES (1, 4, 'FOR_POS', 300, 'USD', 'DEBIT', 'order', 7, NULL, '2026-10-16 10:00:00', 120.5),
           (1, 4, 'SETTLEMENT', 100, 'USD', 'CREDIT', 'paid', 7, 'WHISH', '2026-10-16 11:00:00', 0);
  `);
}

const insertSplit = (db: Database.Database) =>
  db
    .prepare(
      `INSERT INTO partner_ledger (tenant_id, partner_id, transaction_type, amount, currency, direction, settlement_method)
       VALUES (1, 4, 'SETTLEMENT', 300, 'USD', 'DEBIT', 'SPLIT')`,
    )
    .run();

function indexNames(db: Database.Database): string[] {
  return (
    db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'partner_ledger' AND sql IS NOT NULL ORDER BY name`,
      )
      .all() as Array<{ name: string }>
  ).map((r) => r.name);
}

describe("v219 partner_ledger SPLIT settlement method", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(":memory:");
    oldSchema(db);
  });
  afterEach(() => db.close());

  it("before: the CHECK refuses SPLIT", () => {
    expect(() => insertSplit(db)).toThrow(/CHECK constraint/);
  });

  it("up: SPLIT accepted; rows, covered_amount and every index kept", () => {
    const before = db.prepare(`SELECT * FROM partner_ledger ORDER BY id`).all();
    const ixBefore = indexNames(db);
    v219.up(db);
    expect(
      db.prepare(`SELECT * FROM partner_ledger ORDER BY id`).all(),
    ).toEqual(before);
    expect(indexNames(db)).toEqual(ixBefore);
    expect(() => insertSplit(db)).not.toThrow();
    expect(() =>
      db
        .prepare(
          `INSERT INTO partner_ledger (partner_id, transaction_type, amount, direction, settlement_method) VALUES (4, 'SETTLEMENT', 1, 'DEBIT', 'BOGUS')`,
        )
        .run(),
    ).toThrow(/CHECK constraint/);
  });

  it("up is a no-op the second time", () => {
    v219.up(db);
    const sql = db
      .prepare(`SELECT sql FROM sqlite_master WHERE name = 'partner_ledger'`)
      .get();
    v219.up(db);
    expect(
      db
        .prepare(`SELECT sql FROM sqlite_master WHERE name = 'partner_ledger'`)
        .get(),
    ).toEqual(sql);
  });

  it("down: SPLIT rows become NULL and the old CHECK is back", () => {
    v219.up(db);
    insertSplit(db);
    v219.down!(db);
    const rows = db
      .prepare(
        `SELECT settlement_method, covered_amount FROM partner_ledger ORDER BY id`,
      )
      .all();
    expect(rows).toEqual([
      { settlement_method: null, covered_amount: 120.5 },
      { settlement_method: "WHISH", covered_amount: 0 },
      { settlement_method: null, covered_amount: 0 },
    ]);
    expect(() => insertSplit(db)).toThrow(/CHECK constraint/);
  });
});
