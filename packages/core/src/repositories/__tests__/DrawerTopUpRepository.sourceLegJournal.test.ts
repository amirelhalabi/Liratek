/**
 * LIRA-258 / POSTING_INTEGRITY_PLAN batch 2, gap G9 (docs/POSTING_MAP.md §7):
 * `createTopUpFromDrawer` (the "From Drawer" mode, e.g. OMT_System -> General)
 * credited General with a payments row but debited the SOURCE drawer with a
 * raw `UPDATE drawer_balances` and NO payments row. The payments table is the
 * journal `ClosingRepository.recalculateDrawerBalances` rebuilds every
 * balance from, so a recalc silently put the moved money back into the
 * source drawer — the shop appeared to own the same cash twice.
 *
 * Guard: after a from-drawer transfer, (a) Σ payments per drawer|currency
 * equals drawer_balances, and (b) running recalculateDrawerBalances moves
 * nothing. Opening balances are seeded AS payments rows so (b) is meaningful
 * (a balance-only seed would be wiped by recalc with or without the fix).
 */

import Database from "better-sqlite3";
import { DrawerTopUpRepository } from "../DrawerTopUpRepository";
import { ClosingRepository } from "../ClosingRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { snapshotLedgers, ledgerDeltas } from "../testHelpers/postingAssert";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE drawer_topups (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      notes TEXT,
      source_drawer TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id INTEGER DEFAULT 1,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );

    CREATE TABLE transactions (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL DEFAULT 1,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      profit_usd REAL,
      profit_lbp REAL,
      exchange_rate REAL,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      reverses_id INTEGER,
      summary TEXT,
      metadata_json TEXT,
      device_id TEXT,
      transaction_time DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id     INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  return db;
}

// ─── Mock the connection module (mirrors DrawerTopUpRepository.test.ts) ──────

jest.mock("../../db/connection", () => {
  let _db: Database.Database | null = null;
  return {
    getDatabase: () => {
      if (!_db) throw new Error("DB not initialized");
      return _db;
    },
    setDb: (db: Database.Database) => {
      _db = db;
    },
  };
});

function seedOpening(
  db: Database.Database,
  drawer: string,
  currency: string,
  amount: number,
): void {
  db.prepare(
    `INSERT INTO payments (tenant_id, transaction_id, method, drawer_name, currency_code, amount, note, created_by)
     VALUES (1, NULL, 'OPENING_BALANCE', ?, ?, ?, 'opening', 1)`,
  ).run(drawer, currency, amount);
  db.prepare(
    `INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, ?, ?, ?)`,
  ).run(drawer, currency, amount);
}

function journalTotals(db: Database.Database): Record<string, number> {
  const rows = db
    .prepare(
      `SELECT drawer_name, currency_code, SUM(amount) AS total
         FROM payments WHERE method != 'CUSTOMER_ACCOUNT'
        GROUP BY drawer_name, currency_code`,
    )
    .all() as { drawer_name: string; currency_code: string; total: number }[];
  const out: Record<string, number> = {};
  for (const r of rows) out[`${r.drawer_name}|${r.currency_code}`] = r.total;
  return out;
}

describe("DrawerTopUpRepository.createTopUpFromDrawer — source leg is journaled (G9)", () => {
  let db: Database.Database;
  let drawerRepo: DrawerTopUpRepository;
  let closingRepo: ClosingRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    drawerRepo = new DrawerTopUpRepository();
    closingRepo = new ClosingRepository();
    seedOpening(db, "OMT_System", "USD", 500);
    seedOpening(db, "OMT_System", "LBP", 900000);
    seedOpening(db, "General", "USD", 50);
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  it("moves both drawers, and Σ payments per drawer equals drawer_balances", () => {
    const before = snapshotLedgers(db);
    drawerRepo.createTopUpFromDrawer(
      { amount_usd: 100, amount_lbp: 300000, source_drawer: "OMT_System" },
      1,
    );
    const after = snapshotLedgers(db);

    expect(ledgerDeltas(before, after).drawers).toEqual({
      "OMT_System|USD": -100,
      "OMT_System|LBP": -300000,
      "General|USD": 100,
      "General|LBP": 300000,
    });
    expect(journalTotals(db)).toEqual(after.drawers);
  });

  it("recalculateDrawerBalances after the transfer changes nothing", () => {
    drawerRepo.createTopUpFromDrawer(
      { amount_usd: 100, amount_lbp: 300000, source_drawer: "OMT_System" },
      1,
    );
    const afterTransfer = snapshotLedgers(db);

    expect(closingRepo.recalculateDrawerBalances()).toEqual({ success: true });

    expect(ledgerDeltas(afterTransfer, snapshotLedgers(db)).drawers).toEqual(
      {},
    );
  });

  it("source leg is a negative DRAWER_TRANSFER row on the same transaction as the General leg", () => {
    drawerRepo.createTopUpFromDrawer(
      { amount_usd: 100, amount_lbp: 0, source_drawer: "OMT_System" },
      1,
    );
    const legs = db
      .prepare(
        `SELECT transaction_id, method, drawer_name, currency_code, amount
           FROM payments WHERE transaction_id IS NOT NULL ORDER BY id`,
      )
      .all() as {
      transaction_id: number;
      method: string;
      drawer_name: string;
      currency_code: string;
      amount: number;
    }[];
    expect(legs).toHaveLength(2);
    expect(legs[0].transaction_id).toBe(legs[1].transaction_id);
    expect(legs.map((l) => [l.drawer_name, l.currency_code, l.amount])).toEqual(
      expect.arrayContaining([
        ["OMT_System", "USD", -100],
        ["General", "USD", 100],
      ]),
    );
    expect(new Set(legs.map((l) => l.method))).toEqual(
      new Set(["DRAWER_TRANSFER"]),
    );
  });

  it("a source drawer with no balance row for that currency is still debited (goes negative) — money is never created from nothing (G33)", () => {
    // LIRA-258 / G33. Previously the source debit was a raw UPDATE that
    // silently changed nothing when the source had no drawer_balances row for
    // the currency, while General was still credited: +20 appeared from
    // nowhere. Owner policy (FEATURE_GUIDE §7, 2026-08-01): drawers may go
    // negative and no drawer operation refuses — so the transfer posts and
    // the source drawer is created at -20, journaled like any other leg.
    const before = snapshotLedgers(db);
    drawerRepo.createTopUpFromDrawer(
      { amount_usd: 20, amount_lbp: 0, source_drawer: "Whish_System" },
      1,
    );
    const afterTransfer = snapshotLedgers(db);

    // Conserved: General +20 AND source -20.
    expect(ledgerDeltas(before, afterTransfer).drawers).toEqual({
      "Whish_System|USD": -20,
      "General|USD": 20,
    });
    // The journal explains both balances.
    expect(journalTotals(db)).toEqual(afterTransfer.drawers);
    // And a recalc from the journal moves nothing.
    expect(closingRepo.recalculateDrawerBalances()).toEqual({ success: true });
    expect(ledgerDeltas(afterTransfer, snapshotLedgers(db)).drawers).toEqual(
      {},
    );
  });
});
