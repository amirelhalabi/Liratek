/**
 * DrawerTopUpRepository / DrawerTopUpService — extra_currencies (External
 * Cash-In mode)
 *
 * Extends "Top Up General Drawer" (External mode only) to accept top-ups in
 * any currency other than USD/LBP already enabled for the General drawer via
 * Settings → Currencies (`currency_drawers`). Unlike ExchangeRepository,
 * unknown currencies are NOT auto-registered — a manual cash top-up is a
 * config-gated action, not a market-rate conversion, so an entry whose
 * currency isn't configured for the General drawer must be rejected by the
 * SERVICE, before any row is written.
 *
 * `createTopUpFromDrawer` (From Drawer / transfer mode) deliberately has NO
 * `extra_currencies` field at all — see the CQ-3 survey note on
 * `deductBalance` in DrawerTopUpRepository.ts: a transfer's debit silently
 * no-ops on a missing source-drawer currency row, which would fabricate
 * money for a brand-new currency. That is proven at compile-time below
 * rather than at runtime, since there is nothing to guard if the type
 * doesn't exist on that data shape.
 */

import Database from "better-sqlite3";
import {
  DrawerTopUpRepository,
  type CreateDrawerTopUpFromDrawerData,
} from "../DrawerTopUpRepository";
import { DrawerTopUpService } from "../../services/DrawerTopUpService";
import { resetCurrencyRepository } from "../CurrencyRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

// ─── In-memory schema ─────────────────────────────────────────────────────────

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

    CREATE TABLE currencies (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      name TEXT,
      symbol TEXT,
      decimal_places INTEGER DEFAULT 2,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE currency_drawers (
      tenant_id INTEGER DEFAULT 1,
      currency_code TEXT NOT NULL,
      drawer_name TEXT NOT NULL
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

    -- Empty on purpose: only queried by the void/refund path, not exercised here.
    CREATE TABLE debt_ledger (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER,
      transaction_type TEXT,
      amount_usd REAL,
      amount_lbp REAL,
      transaction_id INTEGER,
      note TEXT,
      created_by INTEGER,
      covered_usd REAL DEFAULT 0,
      covered_lbp REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      due_date DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , refunded_at TEXT DEFAULT NULL);
  `);

  return db;
}

// ─── Mock the connection module ────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function balance(
  db: Database.Database,
  drawer: string,
  currency: string,
): number {
  const row = db
    .prepare(
      "SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?",
    )
    .get(drawer, currency) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

function enableDrawerCurrency(
  db: Database.Database,
  drawerName: string,
  currencyCode: string,
): void {
  // The currency must EXIST and be ACTIVE, not merely have a junction row.
  // The General drawer is unrestricted: its currency set is derived from
  // `currencies` (plus whatever the drawer still holds), never read from
  // `currency_drawers` — see `constants/drawerCurrencyPolicy.ts` and
  // docs/plans/todo_plans/GENERAL_DRAWER_UNRESTRICTED.md.
  //
  // Seeding only the junction row modelled a state the real schema forbids:
  // `currency_drawers` FKs to `currencies(tenant_id, code) ON DELETE CASCADE`,
  // so an orphan junction row cannot exist outside this FK-less fixture.
  const code = currencyCode.toUpperCase();
  const exists = db
    .prepare("SELECT 1 FROM currencies WHERE code = ? AND tenant_id = 1")
    .get(code);
  if (!exists) {
    db.prepare(
      "INSERT INTO currencies (code, name, symbol, decimal_places, is_active, tenant_id) VALUES (?, ?, ?, 2, 1, 1)",
    ).run(code, code, code);
  }
  db.prepare(
    "INSERT INTO currency_drawers (currency_code, drawer_name, tenant_id) VALUES (?, ?, 1)",
  ).run(currencyCode, drawerName);
}

function paymentsRows(db: Database.Database): any[] {
  return db.prepare("SELECT * FROM payments").all() as any[];
}

function topUpRowCount(db: Database.Database): number {
  return (
    db.prepare("SELECT COUNT(*) c FROM drawer_topups").get() as { c: number }
  ).c;
}

describe("DrawerTopUpService.addTopUp() — extra_currencies (External Cash-In)", () => {
  let db: Database.Database;
  let repo: DrawerTopUpRepository;
  let service: DrawerTopUpService;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetCurrencyRepository();
    repo = new DrawerTopUpRepository();
    service = new DrawerTopUpService(repo);
  });

  afterEach(() => {
    resetTenantContext();
    resetCurrencyRepository();
    db.close();
  });

  it("posts an extra-currency-only top-up (no USD/LBP) to payments and drawer_balances", () => {
    enableDrawerCurrency(db, "General", "EUR");

    const result = service.addTopUp(
      {
        amount_usd: 0,
        amount_lbp: 0,
        extra_currencies: [{ currency_code: "eur", amount: 100 }],
      },
      1,
    );

    expect(result.success).toBe(true);
    expect(balance(db, "General", "EUR")).toBeCloseTo(100, 2);

    const payments = paymentsRows(db);
    expect(payments).toHaveLength(1);
    expect(payments[0].currency_code).toBe("EUR"); // normalized to uppercase
    expect(payments[0].amount).toBeCloseTo(100, 2);
    expect(payments[0].drawer_name).toBe("General");

    // amount_usd/amount_lbp on the transaction row stay USD/LBP-only; the
    // breakdown lives in metadata_json instead (mirrors ExchangeRepository).
    const txn = db.prepare("SELECT * FROM transactions").get() as any;
    expect(txn.amount_usd).toBe(0);
    expect(txn.amount_lbp).toBe(0);
    // The service normalizes currency codes to uppercase before they reach
    // the repository, so metadata_json reflects the normalized value too.
    const metadata = JSON.parse(txn.metadata_json);
    expect(metadata.extra_currencies).toEqual([
      { currency_code: "EUR", amount: 100 },
    ]);
  });

  // General is unrestricted, so the gate is no longer "has an admin ticked
  // this currency for the General drawer" but "is this a real, active
  // currency" (plan Phase 2). Still a HARD reject rather than an
  // auto-register: an unknown code must not create a `drawer_balances` row for
  // a currency with no name/symbol/decimal_places. GBP below exists nowhere in
  // `currencies`, which is exactly that case.
  it("rejects a currency that is not an active currency — no rows written", () => {
    enableDrawerCurrency(db, "General", "EUR"); // GBP deliberately absent

    const result = service.addTopUp(
      {
        amount_usd: 0,
        amount_lbp: 0,
        extra_currencies: [{ currency_code: "GBP", amount: 50 }],
      },
      1,
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not an active currency/i);

    // Nothing was written — the service rejected before calling the repo.
    expect(topUpRowCount(db)).toBe(0);
    expect(paymentsRows(db)).toHaveLength(0);
    expect(balance(db, "General", "GBP")).toBeCloseTo(0, 2);
  });

  /**
   * The owner-reported bug, 2026-08-22: "External (Cash In)" of EUR 300 into
   * General was rejected with "Currency EUR is not enabled for the General
   * drawer", even though the Exchange module deposits any currency into
   * General. EUR is an ACTIVE currency here with NO `currency_drawers` row for
   * General at all — the exact live-DB shape (General = USD, LBP).
   *
   * Rule 17: this fails on the pre-fix code with that very message.
   */
  it("accepts an ACTIVE currency with no currency_drawers row for General", () => {
    db.prepare(
      "INSERT INTO currencies (code, name, symbol, decimal_places, is_active, tenant_id) VALUES ('EUR', 'Euro', '€', 2, 1, 1)",
    ).run();
    // deliberately NO enableDrawerCurrency() — that is the whole point

    const result = service.addTopUp(
      {
        amount_usd: 0,
        amount_lbp: 0,
        extra_currencies: [{ currency_code: "EUR", amount: 300 }],
      },
      1,
    );

    expect(result.success).toBe(true);
    expect(balance(db, "General", "EUR")).toBeCloseTo(300, 2);
    expect(paymentsRows(db)).toHaveLength(1);
  });

  it("posts two different extra currencies from one submission", () => {
    enableDrawerCurrency(db, "General", "EUR");
    enableDrawerCurrency(db, "General", "GBP");

    const result = service.addTopUp(
      {
        amount_usd: 0,
        amount_lbp: 0,
        extra_currencies: [
          { currency_code: "EUR", amount: 100 },
          { currency_code: "GBP", amount: 50 },
        ],
      },
      1,
    );

    expect(result.success).toBe(true);
    expect(balance(db, "General", "EUR")).toBeCloseTo(100, 2);
    expect(balance(db, "General", "GBP")).toBeCloseTo(50, 2);
    expect(paymentsRows(db)).toHaveLength(2);
  });

  it("rejects duplicate currency codes in one extra_currencies array — no rows written", () => {
    enableDrawerCurrency(db, "General", "EUR");

    const result = service.addTopUp(
      {
        amount_usd: 0,
        amount_lbp: 0,
        extra_currencies: [
          { currency_code: "EUR", amount: 50 },
          { currency_code: "eur", amount: 30 }, // same currency, different case
        ],
      },
      1,
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/duplicate currency/i);
    expect(topUpRowCount(db)).toBe(0);
    expect(paymentsRows(db)).toHaveLength(0);
    expect(balance(db, "General", "EUR")).toBeCloseTo(0, 2);
  });

  it("still accepts a plain USD/LBP top-up with no extra_currencies (unchanged behavior)", () => {
    const result = service.addTopUp({ amount_usd: 20, amount_lbp: 0 }, 1);

    expect(result.success).toBe(true);
    expect(balance(db, "General", "USD")).toBeCloseTo(20, 2);
    expect(paymentsRows(db)).toHaveLength(1);
  });

  it("createTopUpFromDrawer's data type has no extra_currencies field (compile-time guard)", () => {
    const data: CreateDrawerTopUpFromDrawerData = {
      amount_usd: 10,
      amount_lbp: 0,
      source_drawer: "OMT_System",
      // @ts-expect-error — extra_currencies must not exist on the from-drawer
      // transfer type: a debit against a missing source-drawer currency row
      // silently no-ops (see the CQ-3 survey note in DrawerTopUpRepository.ts),
      // which would fabricate money for a brand-new currency. External mode
      // is the only safe path — see CreateDrawerTopUpData.extra_currencies.
      extra_currencies: [{ currency_code: "EUR", amount: 5 }],
    };

    expect(data.source_drawer).toBe("OMT_System");
  });
});
