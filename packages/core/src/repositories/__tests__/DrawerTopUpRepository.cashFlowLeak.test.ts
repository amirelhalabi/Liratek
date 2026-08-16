/**
 * DrawerTopUpRepository × TransactionRepository.getCashFlowByDate —
 * internal drawer-to-drawer transfers must NOT inflate the D1 cash-in report.
 *
 * Bug (owner-approved fix, traced from source): `createTopUpFromDrawer`
 * (the "From Drawer" / internal-transfer mode, e.g. OMT_System -> General)
 * posted its General-side leg with `method: TOPUP_METHOD` ("CASH") — a real
 * customer-tender method code, NOT one of TransactionRepository's
 * `INTERNAL_LEG_METHODS`. That leg therefore passed `customerCashLegSql`
 * unfiltered (method not internal, drawer General not provider-stock, USD is
 * a customer-cash currency, note matches no exclusion prefix/suffix), so
 * `getCashFlowByDate` counted the shop moving its OWN money between its OWN
 * drawers as brand-new cash walking in the door. Drawer BALANCES were always
 * correct; only the report was inflated, and repeated shuttling compounds it.
 *
 * Fix: the leg now uses `DRAWER_TRANSFER_METHOD` ("DRAWER_TRANSFER") — already
 * a member of `INTERNAL_LEG_METHODS` (added for `transferBetweenDrawers`), so
 * it is excluded from both `isInternalLegJs` (per-row leg attachment) and
 * `customerCashLegSql` (this D1 aggregate) for free, via the rule-14 pair
 * that already shares that one Set.
 *
 * The companion test proves `createTopUp` (the "External (Cash In)" mode —
 * genuine outside cash entering the shop, summary "Drawer Top-Up: General…")
 * is UNAFFECTED and still counts toward total_in, so the fix does not
 * silently over-correct the one case that must keep counting.
 */

import Database from "better-sqlite3";
import { DrawerTopUpRepository } from "../DrawerTopUpRepository";
import { TransactionRepository } from "../TransactionRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

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

// Wide enough to catch CURRENT_TIMESTAMP regardless of when the suite runs,
// without depending on the system clock's exact date.
const WIDE_FROM = "2000-01-01";
const WIDE_TO = "2099-12-31";

describe("DrawerTopUpRepository -> TransactionRepository.getCashFlowByDate", () => {
  let db: Database.Database;
  let drawerRepo: DrawerTopUpRepository;
  let txnRepo: TransactionRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    drawerRepo = new DrawerTopUpRepository();
    txnRepo = new TransactionRepository();

    // Fund OMT_System so the "From Drawer" transfer has something to move.
    db.prepare(
      `INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'OMT_System', 'USD', 500)`,
    ).run();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  it("does NOT count an internal OMT_System -> General transfer as customer cash-in", () => {
    drawerRepo.createTopUpFromDrawer(
      { amount_usd: 100, amount_lbp: 0, source_drawer: "OMT_System" },
      1,
    );

    const rows = txnRepo.getCashFlowByDate(WIDE_FROM, WIDE_TO);
    const usdRow = rows.find((r) => r.currency_code === "USD");

    // Pre-fix this leg posted with method "CASH" — not in
    // INTERNAL_LEG_METHODS — so it passed customerCashLegSql and total_in
    // came back 100: the shop's own drawer-to-drawer shuffle counted as new
    // cash walking in the door.
    expect(usdRow?.total_in ?? 0).toBe(0);
  });

  it("STILL counts an External (Cash In) top-up as customer cash-in (no over-correction)", () => {
    drawerRepo.createTopUp({ amount_usd: 100, amount_lbp: 0 }, 1);

    const rows = txnRepo.getCashFlowByDate(WIDE_FROM, WIDE_TO);
    const usdRow = rows.find((r) => r.currency_code === "USD");

    expect(usdRow?.total_in).toBe(100);
  });
});
