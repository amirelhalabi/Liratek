/**
 * FinancialServiceRepository — C4: app-wallet transfers move the app drawer
 *
 * OMT_APP / WHISH_APP transfers (no cost/price pair) must move money like
 * Binance, the reference implementation:
 *   SEND:    wallet drawer −amount, cash drawer +(amount + fee)
 *   RECEIVE: wallet drawer +amount, cash drawer −(amount − fee)
 *
 * Pre-C4 they fell through to the generic single-drawer path: SEND never
 * touched the app drawer (the shop's app balance silently never decreased)
 * and RECEIVE credited the paid-by drawer instead of paying the customer out.
 */

import Database from "better-sqlite3";
import { FinancialServiceRepository } from "../FinancialServiceRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { resetSupplierRepository } from "../SupplierRepository";
import { resetTransactionRepository } from "../TransactionRepository";

// ─── Mock DB connection (shared by all sub-repositories) ─────────────────────

jest.mock("../../db/connection", () => {
  let _db: Database.Database | null = null;
  return {
    getDatabase: () => {
      if (!_db) throw new Error("Test DB not initialized");
      return _db;
    },
    setDb: (db: Database.Database) => {
      _db = db;
    },
  };
});

// ─── Mock DebtService (only used by CUSTOMER_ACCOUNT cashout) ────────────────

const mockAddCredit = jest.fn();
jest.mock("../../services/DebtService", () => ({
  getDebtService: () => ({ addCredit: mockAddCredit }),
  resetDebtService: jest.fn(),
}));

// ─── In-memory schema (mirrors the receiveSplitPayout test) ──────────────────

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE users (
      tenant_id INTEGER DEFAULT 1,id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, role TEXT DEFAULT 'staff');
    INSERT INTO users (id, username, role) VALUES (1, 'admin', 'admin');

    CREATE TABLE clients (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone_number TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE partners (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      service_type TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'USD' NOT NULL,
      commission REAL DEFAULT 0,
      cost REAL DEFAULT 0,
      price REAL DEFAULT 0,
      paid_by TEXT DEFAULT 'CASH',
      client_id INTEGER REFERENCES clients(id),
      client_name TEXT,
      reference_number TEXT,
      phone_number TEXT,
      omt_service_type TEXT,
      omt_fee REAL DEFAULT 0,
      whish_fee REAL DEFAULT 0,
      profit_rate REAL,
      pay_fee INTEGER DEFAULT 0,
      payment_method_fee REAL DEFAULT 0,
      payment_method_fee_rate REAL,
      item_key TEXT,
      note TEXT,
      sender_name TEXT,
      sender_phone TEXT,
      receiver_name TEXT,
      receiver_phone TEXT,
      sender_client_id INTEGER,
      receiver_client_id INTEGER,
      is_settled INTEGER NOT NULL DEFAULT 1,
      settled_at TEXT,
      settlement_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER,
      paid_amount REAL DEFAULT NULL,
      paid_currency TEXT DEFAULT NULL,
      partner_id INTEGER REFERENCES partners(id),
      partner_mode TEXT CHECK(partner_mode IN ('THROUGH', 'FOR')),
      commission_model INTEGER NOT NULL DEFAULT 0
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

    CREATE TABLE partner_ledger (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id INTEGER NOT NULL REFERENCES partners(id),
      transaction_type TEXT NOT NULL,
      reference_table TEXT,
      reference_id INTEGER,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      direction TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      notes TEXT,
      user_id INTEGER REFERENCES users(id),
      settlement_method TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
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
      exchange_rate REAL,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      reverses_id INTEGER,
      profit_usd REAL NOT NULL DEFAULT 0,
      profit_lbp REAL NOT NULL DEFAULT 0,
      summary TEXT,
      metadata_json TEXT,
      device_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id INTEGER DEFAULT 1,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );

    CREATE TABLE suppliers (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact_name TEXT,
      phone TEXT,
      note TEXT,
      provider TEXT,
      is_active INTEGER DEFAULT 1,
      is_system INTEGER DEFAULT 0,
      module_key TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE supplier_ledger (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      entry_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      note TEXT,
      created_by INTEGER,
      transaction_id INTEGER,
      is_auto INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE system_settings (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_name TEXT NOT NULL UNIQUE,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE debt_ledger (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      transaction_id INTEGER,
      note TEXT,
      due_date TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL);

    INSERT INTO drawer_balances VALUES (1, 'General',   'USD',  1000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General',   'LBP',  100000000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'OMT_App',   'USD',  500,  CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Whish_App', 'USD',  500,  CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Binance',   'USDT', 500,  CURRENT_TIMESTAMP);
  `);

  return db;
}

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
  return row ? row.balance : 0;
}

describe("FinancialServiceRepository — C4: app-wallet transfers move the app drawer", () => {
  let db: Database.Database;
  let repo: FinancialServiceRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    repo = new FinancialServiceRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  it("OMT_APP SEND: app drawer −20, General +20", () => {
    const appBefore = balance(db, "OMT_App", "USD");
    const genBefore = balance(db, "General", "USD");

    repo.createTransaction({
      provider: "OMT_APP",
      serviceType: "SEND",
      amount: 20,
      currency: "USD",
      commission: 0,
      paidByMethod: "CASH",
      exchangeRate: 90000,
    });

    expect(balance(db, "OMT_App", "USD")).toBeCloseTo(appBefore - 20, 2);
    expect(balance(db, "General", "USD")).toBeCloseTo(genBefore + 20, 2);
  });

  it("OMT_APP RECEIVE: app drawer +20, General −20", () => {
    const appBefore = balance(db, "OMT_App", "USD");
    const genBefore = balance(db, "General", "USD");

    repo.createTransaction({
      provider: "OMT_APP",
      serviceType: "RECEIVE",
      amount: 20,
      currency: "USD",
      commission: 0,
      cashoutMethod: "CASH",
      exchangeRate: 90000,
    });

    expect(balance(db, "OMT_App", "USD")).toBeCloseTo(appBefore + 20, 2);
    expect(balance(db, "General", "USD")).toBeCloseTo(genBefore - 20, 2);
  });

  it("OMT_APP RECEIVE with the FULL fee as commission (lira-101 fix): app +105, General −100", () => {
    // Mirrors the WHISH_APP full-fee case below — the repo already handles
    // this correctly for BOTH app-wallet providers via the shared isAppWallet
    // branch; this is a coverage gap closed alongside the frontend fix, not
    // a repo behavior change. amount=105 is the gross wallet inflow the
    // (now-fixed) form sends for a $100 transfer + $5 fee charged on top.
    const appBefore = balance(db, "OMT_App", "USD");
    const genBefore = balance(db, "General", "USD");

    const { id } = repo.createTransaction({
      provider: "OMT_APP",
      serviceType: "RECEIVE",
      amount: 105,
      currency: "USD",
      commission: 5, // FULL fee is shop profit
      omtFee: 5,
      cashoutMethod: "CASH",
      exchangeRate: 90000,
    });

    expect(balance(db, "OMT_App", "USD")).toBeCloseTo(appBefore + 105, 2);
    expect(balance(db, "General", "USD")).toBeCloseTo(genBefore - 100, 2);

    const row = db
      .prepare(
        "SELECT omt_fee, commission FROM financial_services WHERE id = ?",
      )
      .get(id) as { omt_fee: number; commission: number };
    expect(row.omt_fee).toBeCloseTo(5, 2);
    expect(row.commission).toBeCloseTo(5, 2);
  });

  it("WHISH_APP SEND: app drawer −20, General +20", () => {
    const appBefore = balance(db, "Whish_App", "USD");
    const genBefore = balance(db, "General", "USD");

    repo.createTransaction({
      provider: "WHISH_APP",
      serviceType: "SEND",
      amount: 20,
      currency: "USD",
      commission: 0,
      paidByMethod: "CASH",
      exchangeRate: 90000,
    });

    expect(balance(db, "Whish_App", "USD")).toBeCloseTo(appBefore - 20, 2);
    expect(balance(db, "General", "USD")).toBeCloseTo(genBefore + 20, 2);
  });

  it("WHISH_APP RECEIVE with commission: app +20, General −(20 − commission)", () => {
    const appBefore = balance(db, "Whish_App", "USD");
    const genBefore = balance(db, "General", "USD");

    repo.createTransaction({
      provider: "WHISH_APP",
      serviceType: "RECEIVE",
      amount: 20,
      currency: "USD",
      commission: 0.02, // shop profit withheld from the payout
      cashoutMethod: "CASH",
      exchangeRate: 90000,
    });

    expect(balance(db, "Whish_App", "USD")).toBeCloseTo(appBefore + 20, 2);
    expect(balance(db, "General", "USD")).toBeCloseTo(genBefore - 19.98, 2);
  });

  it("WHISH_APP RECEIVE — shop keeps the FULL fee, not 10% of it (the lira-100 bug): wallet +100, payout −99", () => {
    // Reproduces the reported case: entered 100, fee $1 (1% auto-fee), fee
    // NOT included. The frontend must fold the fee into the wallet inflow
    // (data.amount = 101 when the toggle isn't set) and send the FULL fee as
    // commission — this repo-level test isolates the money-loop half of the
    // fix (given already-correct inputs), the frontend contract itself is
    // guarded by the OmtWhishAppTransferForm fee-math unit tests.
    const appBefore = balance(db, "Whish_App", "USD");
    const genBefore = balance(db, "General", "USD");

    const { id } = repo.createTransaction({
      provider: "WHISH_APP",
      serviceType: "RECEIVE",
      amount: 101, // wallet inflow: 100 transfer + $1 fee charged on top
      currency: "USD",
      commission: 1, // FULL fee is shop profit — not fee × 10%
      whishFee: 1,
      cashoutMethod: "CASH",
      exchangeRate: 90000,
    });

    expect(balance(db, "Whish_App", "USD")).toBeCloseTo(appBefore + 101, 2);
    expect(balance(db, "General", "USD")).toBeCloseTo(genBefore - 100, 2);

    const row = db
      .prepare(
        "SELECT whish_fee, commission FROM financial_services WHERE id = ?",
      )
      .get(id) as { whish_fee: number; commission: number };
    expect(row.whish_fee).toBeCloseTo(1, 2);
    expect(row.commission).toBeCloseTo(1, 2);
  });

  it("WHISH_APP RECEIVE with no fee: wallet +100, payout −100, no profit", () => {
    const appBefore = balance(db, "Whish_App", "USD");
    const genBefore = balance(db, "General", "USD");

    const { id } = repo.createTransaction({
      provider: "WHISH_APP",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commission: 0,
      cashoutMethod: "CASH",
      exchangeRate: 90000,
    });

    expect(balance(db, "Whish_App", "USD")).toBeCloseTo(appBefore + 100, 2);
    expect(balance(db, "General", "USD")).toBeCloseTo(genBefore - 100, 2);

    const row = db
      .prepare(
        "SELECT COUNT(*) as n FROM payments WHERE transaction_id = (SELECT id FROM transactions WHERE source_id = ? AND source_table = 'financial_services') AND method = 'COMMISSION'",
      )
      .get(id) as { n: number };
    expect(row.n).toBe(0);
  });

  it("BINANCE control: SEND unchanged (Binance USDT −20, General USD +20)", () => {
    const binBefore = balance(db, "Binance", "USDT");
    const genBefore = balance(db, "General", "USD");

    repo.createTransaction({
      provider: "BINANCE",
      serviceType: "SEND",
      amount: 20,
      currency: "USDT",
      commission: 0,
      paidByMethod: "CASH",
      exchangeRate: 90000,
    });

    expect(balance(db, "Binance", "USDT")).toBeCloseTo(binBefore - 20, 2);
    expect(balance(db, "General", "USD")).toBeCloseTo(genBefore + 20, 2);
  });
});

describe("FinancialServiceRepository — app-wallet SEND with a fee (missing-$2 bug, 2026-07-12)", () => {
  let db: Database.Database;
  let repo: FinancialServiceRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    repo = new FinancialServiceRepository();
    db.prepare(
      `INSERT INTO clients (id, full_name, phone_number) VALUES (1, 'amir halabi', '81077357')`,
    ).run();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  it("on-account SEND books amount + fee as debt, with a provider-named note (was: $20 debt labeled 'Binance … USDT')", () => {
    // $20 transfer + $2 fee charged entirely to the customer's account.
    // The frontend sends the fee as `commission` (omtWhishAppFees.shopProfit).
    const res = repo.createTransaction({
      provider: "OMT_APP",
      serviceType: "SEND",
      amount: 20,
      currency: "USD",
      commission: 2,
      omtFee: 2,
      clientId: 1,
      paidByMethod: "CUSTOMER_ACCOUNT",
      exchangeRate: 90000,
    });
    expect(res.id).toBeGreaterThan(0);

    const debt = db
      .prepare(
        `SELECT amount_usd, amount_lbp, note FROM debt_ledger WHERE transaction_type = 'Service Debt' ORDER BY id DESC LIMIT 1`,
      )
      .get() as { amount_usd: number; amount_lbp: number; note: string };
    expect(debt.amount_usd).toBeCloseTo(22, 2); // 20 transfer + 2 fee — NOT 20
    expect(debt.amount_lbp).toBe(0);
    // Headline = the TOTAL owed, breakdown in parentheses (a bare "$20" note
    // on a $22 debt read as if the fee had been dropped).
    expect(debt.note).toBe("OMT_APP SEND — $22 ($20 + $2 fee)");
    expect(debt.note).not.toContain("Binance");
    expect(debt.note).not.toContain("USDT");

    // The audit row carries the customer total in its amount AND surfaces the
    // fee in the summary — both were invisible ("↓ $20 … — 20 USD" on a $22
    // charge).
    const txn = db
      .prepare(
        `SELECT summary, amount_usd FROM transactions ORDER BY id DESC LIMIT 1`,
      )
      .get() as { summary: string; amount_usd: number };
    expect(txn.summary).toContain("(+$2 fee)");
    expect(txn.amount_usd).toBeCloseTo(22, 2);
  });

  it("cash SEND with fee: wallet −20, General +22, full fee stamped as profit", () => {
    const appBefore = balance(db, "OMT_App", "USD");
    const genBefore = balance(db, "General", "USD");

    const res = repo.createTransaction({
      provider: "OMT_APP",
      serviceType: "SEND",
      amount: 20,
      currency: "USD",
      commission: 2,
      omtFee: 2,
      paidByMethod: "CASH",
      exchangeRate: 90000,
    });
    expect(res.id).toBeGreaterThan(0);

    expect(balance(db, "OMT_App", "USD")).toBeCloseTo(appBefore - 20, 2);
    expect(balance(db, "General", "USD")).toBeCloseTo(genBefore + 22, 2);

    const txn = db
      .prepare(
        `SELECT profit_usd, amount_usd FROM transactions ORDER BY id DESC LIMIT 1`,
      )
      .get() as { profit_usd: number; amount_usd: number };
    // Row amount = TOTAL charged to the customer (transfer + fee), matching
    // recharge (price) and app-wallet RECEIVE (gross inflow). Was 20 — the
    // $2 fee was invisible in the transactions table.
    expect(txn.amount_usd).toBeCloseTo(22, 2);
    expect(txn.profit_usd).toBeCloseTo(2, 2); // the fee is shop profit
  });

  it("Binance on-account SEND keeps its USDT note", () => {
    const res = repo.createTransaction({
      provider: "BINANCE",
      serviceType: "SEND",
      amount: 20,
      currency: "USDT",
      commission: 2,
      clientId: 1,
      paidByMethod: "CUSTOMER_ACCOUNT",
      exchangeRate: 90000,
    });
    expect(res.id).toBeGreaterThan(0);

    const debt = db
      .prepare(
        `SELECT amount_usd, note FROM debt_ledger ORDER BY id DESC LIMIT 1`,
      )
      .get() as { amount_usd: number; note: string };
    expect(debt.amount_usd).toBeCloseTo(22, 2);
    // USDT transfer + USD fee can't share one headline number — the fee is
    // appended instead.
    expect(debt.note).toBe("Binance SEND — $20 USDT (+$2 fee)");
  });
});

describe("FinancialServiceRepository — wallet-provider catalog-item sale summary", () => {
  let db: Database.Database;
  let repo: FinancialServiceRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    repo = new FinancialServiceRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  it("WHISH_APP grid-item sale gets an item-style summary, not a transfer line with a fee", () => {
    // A catalog item (cost/price flow): the customer paid 150,000 total;
    // the 30,383 margin is INSIDE that price, not a fee on top. The summary
    // used to read "WHISH_APP SEND: 150000 LBP (+30,383 LBP fee)" — a
    // transfer line — for what is an item sale.
    const res = repo.createTransaction({
      provider: "WHISH_APP",
      serviceType: "SEND",
      amount: 150000,
      currency: "LBP",
      commission: 30383,
      cost: 119617,
      itemKey: "mtc_prepaid_1",
      note: "MTC Prepaid 1",
      paidByMethod: "CASH",
      exchangeRate: 90000,
    });
    expect(res.id).toBeGreaterThan(0);

    const txn = db
      .prepare(
        `SELECT summary, amount_lbp, profit_lbp FROM transactions ORDER BY id DESC LIMIT 1`,
      )
      .get() as { summary: string; amount_lbp: number; profit_lbp: number };
    // Friendly provider label — the raw "WHISH_APP" enum reads like a code
    // in the audit table while iPick/Katsh item lines read naturally.
    expect(txn.summary).toBe("Whish App: MTC Prepaid 1 — 150000 LBP");
    expect(txn.summary).not.toContain("fee");
    expect(txn.summary).not.toContain("SEND");
    expect(txn.summary).not.toContain("WHISH_APP");
    // Margin still stamped as profit and amount still the customer total.
    expect(txn.amount_lbp).toBeCloseTo(150000, 2);
    expect(txn.profit_lbp).toBeCloseTo(30383, 2);
  });

  it("control: a WHISH_APP transfer (no cost) keeps the transfer summary with the fee suffix", () => {
    const res = repo.createTransaction({
      provider: "WHISH_APP",
      serviceType: "SEND",
      amount: 20,
      currency: "USD",
      commission: 2,
      whishFee: 2,
      senderName: "amir halabi",
      paidByMethod: "CASH",
      exchangeRate: 90000,
    });
    expect(res.id).toBeGreaterThan(0);

    const txn = db
      .prepare(`SELECT summary FROM transactions ORDER BY id DESC LIMIT 1`)
      .get() as { summary: string };
    expect(txn.summary).toContain("WHISH_APP SEND:");
    expect(txn.summary).toContain("(+$2 fee)");
  });
});

describe("FinancialServiceRepository — catalog-item on-account debt note", () => {
  let db: Database.Database;
  let repo: FinancialServiceRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    repo = new FinancialServiceRepository();
    db.prepare(
      `INSERT INTO clients (id, full_name, phone_number) VALUES (1, 'amir halabi', '81077357')`,
    ).run();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  function itemSaleOnAccount(provider: "WHISH_APP" | "Katsh"): void {
    repo.createTransaction({
      provider,
      serviceType: "SEND",
      amount: 150000,
      currency: "LBP",
      commission: 30383,
      cost: 119617,
      itemKey: "mtc_prepaid_1",
      note: "MTC Prepaid 1",
      clientId: 1,
      paidByMethod: "CUSTOMER_ACCOUNT",
      exchangeRate: 90000,
    });
  }

  function lastServiceDebt(): { note: string; amount_lbp: number } {
    return db
      .prepare(
        `SELECT note, amount_lbp FROM debt_ledger WHERE transaction_type = 'Service Debt' ORDER BY id DESC LIMIT 1`,
      )
      .get() as { note: string; amount_lbp: number };
  }

  it("WHISH_APP item debt note matches the iPick/Katsh item format (friendly label)", () => {
    itemSaleOnAccount("WHISH_APP");
    const debt = lastServiceDebt();
    expect(debt.note).toBe("Whish App service: MTC Prepaid 1");
    expect(debt.note).not.toContain("WHISH_APP");
    expect(debt.amount_lbp).toBeCloseTo(150000, 2);
  });

  it("control: Katsh item debt note keeps its existing format", () => {
    itemSaleOnAccount("Katsh");
    const debt = lastServiceDebt();
    expect(debt.note).toBe("Katsh service: MTC Prepaid 1");
    expect(debt.amount_lbp).toBeCloseTo(150000, 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fix B — app-wallet transfers book NO supplier ledger entries.
//
// OMT_APP / WHISH_APP / BINANCE are prepaid wallets: the shop consumes balance
// it already owns, so a transfer creates no debt in either direction. The auto
// supplier-ledger block used to book TOP_UP (SEND, "we owe them") / PAYMENT
// (RECEIVE, "they owe us") whenever a supplier row for the provider existed —
// which it does in production (create_db.sql seeds 'OMT App'/'Whish App').
// The main C4 suite never caught this because its fixture seeds NO supplier
// rows, so getByProvider() returned nothing and the block silently no-oped.
//
// Rule 17: these tests FAIL on the pre-fix code (phantom rows appear).
// ─────────────────────────────────────────────────────────────────────────────

describe("Fix B — app-wallet transfers book NO supplier ledger entries", () => {
  let db: Database.Database;
  let repo: FinancialServiceRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  function ledgerRows(d: Database.Database) {
    return d
      .prepare(
        `SELECT s.provider, sl.entry_type, sl.amount_usd
           FROM supplier_ledger sl JOIN suppliers s ON s.id = sl.supplier_id
          ORDER BY sl.id`,
      )
      .all() as Array<{
      provider: string;
      entry_type: string;
      amount_usd: number;
    }>;
  }

  beforeEach(() => {
    db = createTestDb();
    // Production seeds system supplier rows for the app-wallet providers —
    // exactly the condition under which the phantom entries were written.
    db.exec(`
      INSERT INTO suppliers (name, provider, is_system) VALUES ('OMT App', 'OMT_APP', 1);
      INSERT INTO suppliers (name, provider, is_system) VALUES ('Whish App', 'WHISH_APP', 1);
      INSERT INTO suppliers (name, provider, is_system) VALUES ('Binance', 'BINANCE', 1);
    `);
    setDb(db);
    initFixedTenantContext(1);
    resetSupplierRepository();
    resetTransactionRepository();
    repo = new FinancialServiceRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
    resetSupplierRepository();
    resetTransactionRepository();
  });

  it("OMT_APP SEND books no supplier debt (pre-fix: TOP_UP +amount)", () => {
    repo.createTransaction({
      provider: "OMT_APP",
      serviceType: "SEND",
      amount: 20,
      currency: "USD",
      commission: 2,
      omtFee: 2,
      paidByMethod: "CASH",
      exchangeRate: 90000,
    });
    expect(ledgerRows(db)).toHaveLength(0);
  });

  it("WHISH_APP RECEIVE books no supplier credit (pre-fix: PAYMENT −amount)", () => {
    repo.createTransaction({
      provider: "WHISH_APP",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commission: 0.1,
      cashoutMethod: "CASH",
      exchangeRate: 90000,
    });
    expect(ledgerRows(db)).toHaveLength(0);
  });

  it("BINANCE SEND books no supplier debt", () => {
    repo.createTransaction({
      provider: "BINANCE",
      serviceType: "SEND",
      amount: 50,
      currency: "USD",
      commission: 0,
      paidByMethod: "CASH",
      exchangeRate: 90000,
    });
    expect(ledgerRows(db)).toHaveLength(0);
  });
});

describe("FinancialServiceRepository — app-wallet RECEIVE split payout (owner-reported 2026-07-30)", () => {
  // The bug: the app-wallet/Binance RECEIVE payout posted ONE lump of
  // `payoutAmount` (a service-currency magnitude) tagged with the FIRST
  // payment leg's currency (`payments[0].currencyCode`) — a 20,000,000 LBP
  // Whish App RECEIVE paid out as [$100 USD, 11,050,000 LBP] booked
  // General USD −20,000,000 and never touched General LBP. Reversal owners
  // for everything this flow writes (rule 20): payout legs → generic
  // _reversePayments; store credit → transaction_id-linked addCredit
  // (ServiceStoreCreditReversal.test.ts).
  let db: Database.Database;
  let repo: FinancialServiceRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    repo = new FinancialServiceRepository();
    mockAddCredit.mockClear();
    db.prepare(
      `INSERT INTO clients (id, full_name, phone_number) VALUES (1, 'amir halabi', '81077357')`,
    ).run();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  it("WHISH_APP RECEIVE 20,000,000 LBP paid out as $100 + 11,050,000 LBP debits EACH leg in its OWN currency (the owner's exact repro)", () => {
    // rule 17: proven failing-first 2026-07-30 — pre-fix the lump posting
    // read General USD −20,000,000 (payout magnitude × first leg's currency)
    // and General LBP ±0.
    const genUsdBefore = balance(db, "General", "USD");
    const genLbpBefore = balance(db, "General", "LBP");

    repo.createTransaction({
      provider: "WHISH_APP",
      serviceType: "RECEIVE",
      amount: 20_000_000, // gross wallet inflow
      currency: "LBP",
      commission: 0,
      cashoutMethod: "CASH",
      exchangeRate: 90_000,
      // The till converted the USD line at its own (buy) rate:
      // 100 × 89,500 + 11,050,000 = 20,000,000 exactly.
      tender_exchange_rate: 89_500,
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 100 }, // USD FIRST — the trigger
        { method: "CASH", currencyCode: "LBP", amount: 11_050_000 },
      ],
    });

    expect(balance(db, "Whish_App", "LBP")).toBeCloseTo(20_000_000, 2);
    expect(balance(db, "General", "USD")).toBeCloseTo(genUsdBefore - 100, 2);
    expect(balance(db, "General", "LBP")).toBeCloseTo(
      genLbpBefore - 11_050_000,
      2,
    );

    // Identity assertions on the payout legs themselves (rule 15).
    const payoutLegs = db
      .prepare(
        `SELECT currency_code, amount FROM payments
         WHERE drawer_name = 'General' AND amount < 0 ORDER BY id ASC`,
      )
      .all() as Array<{ currency_code: string; amount: number }>;
    expect(payoutLegs).toEqual([
      expect.objectContaining({ currency_code: "USD", amount: -100 }),
      expect.objectContaining({ currency_code: "LBP", amount: -11_050_000 }),
    ]);
  });

  it("hard-rejects a split payout whose legs do NOT sum to the payout (S2 reconciliation), rolling back the wallet credit", () => {
    // rule 17: proven failing-first 2026-07-30 — pre-fix this booked
    // silently (no RECEIVE-side reconcileLegs existed in this branch).
    expect(() =>
      repo.createTransaction({
        provider: "WHISH_APP",
        serviceType: "RECEIVE",
        amount: 20_000_000,
        currency: "LBP",
        commission: 0,
        cashoutMethod: "CASH",
        exchangeRate: 90_000,
        payments: [
          { method: "CASH", currencyCode: "USD", amount: 100 },
          { method: "CASH", currencyCode: "LBP", amount: 10_000_000 }, // ~1.05M LBP short
        ],
      }),
    ).toThrow(/do not reconcile/);

    // The throw happens inside the flow's db.transaction — nothing partial.
    expect(balance(db, "Whish_App", "LBP")).toBe(0);
    expect(balance(db, "General", "USD")).toBeCloseTo(1000, 2);
    expect(balance(db, "General", "LBP")).toBeCloseTo(100_000_000, 2);
    expect(
      (
        db.prepare(`SELECT COUNT(*) AS n FROM transactions`).get() as {
          n: number;
        }
      ).n,
    ).toBe(0);
  });

  it("CUSTOMER_ACCOUNT cashout books the store credit in the SERVICE currency, never the first leg's currency", () => {
    // rule 17: proven failing-first 2026-07-30 — pre-fix a USD-denominated
    // account leg made cashCurrency 'USD' and the credit booked
    // amountUsd = 20,000,000 (an LBP magnitude as dollars).
    repo.createTransaction({
      provider: "WHISH_APP",
      serviceType: "RECEIVE",
      amount: 20_000_000,
      currency: "LBP",
      commission: 0,
      cashoutMethod: "CUSTOMER_ACCOUNT",
      clientId: 1,
      clientName: "amir halabi",
      exchangeRate: 90_000,
      payments: [
        { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 222.22 },
      ],
    });

    expect(mockAddCredit).toHaveBeenCalledTimes(1);
    expect(mockAddCredit).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 1,
        amountUsd: 0,
        amountLbp: 20_000_000,
      }),
    );
    // No drawer moved for an on-account payout.
    expect(balance(db, "General", "USD")).toBeCloseTo(1000, 2);
    expect(balance(db, "General", "LBP")).toBeCloseTo(100_000_000, 2);
  });

  it("an account payout leg under the default CASH cashout routes to store credit, not a phantom General debit (the Whish App form's shape)", () => {
    // OmtWhishAppTransferForm never sends cashoutMethod — an on-account
    // payout arrives as a CUSTOMER_ACCOUNT leg with cashoutMethod defaulting
    // to CASH. rule 17: proven failing-first 2026-07-30 — pre-fix this
    // debited General by the FULL payout (cash that never left the till)
    // and booked NO credit at all.
    repo.createTransaction({
      provider: "WHISH_APP",
      serviceType: "RECEIVE",
      amount: 20_000_000,
      currency: "LBP",
      commission: 0,
      clientId: 1,
      clientName: "amir halabi",
      exchangeRate: 90_000,
      payments: [
        {
          method: "CUSTOMER_ACCOUNT",
          currencyCode: "LBP",
          amount: 20_000_000,
        },
      ],
    });

    expect(mockAddCredit).toHaveBeenCalledTimes(1);
    expect(mockAddCredit).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 1, amountLbp: 20_000_000 }),
    );
    expect(balance(db, "General", "USD")).toBeCloseTo(1000, 2);
    expect(balance(db, "General", "LBP")).toBeCloseTo(100_000_000, 2);
  });

  it("mixed CASH + CUSTOMER_ACCOUNT split payout: cash leg debits its drawer, account leg becomes store credit", () => {
    repo.createTransaction({
      provider: "WHISH_APP",
      serviceType: "RECEIVE",
      amount: 20_000_000,
      currency: "LBP",
      commission: 0,
      clientId: 1,
      clientName: "amir halabi",
      exchangeRate: 90_000,
      tender_exchange_rate: 89_500,
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 100 },
        {
          method: "CUSTOMER_ACCOUNT",
          currencyCode: "LBP",
          amount: 11_050_000,
        },
      ],
    });

    expect(balance(db, "General", "USD")).toBeCloseTo(1000 - 100, 2);
    expect(balance(db, "General", "LBP")).toBeCloseTo(100_000_000, 2);
    expect(mockAddCredit).toHaveBeenCalledTimes(1);
    expect(mockAddCredit).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 1,
        amountUsd: 0,
        amountLbp: 11_050_000,
      }),
    );
  });

  it("BINANCE RECEIVE split payout debits per-currency too (shared branch)", () => {
    // rule 17: proven failing-first 2026-07-30 — pre-fix the lump read
    // General USD −98 / LBP ±0 (legs ignored, payout magnitude in
    // payments[0]'s currency — which HAPPENED to be USD here, hiding the
    // LBP leg entirely).
    repo.createTransaction({
      provider: "BINANCE",
      serviceType: "RECEIVE",
      amount: 100, // USDT gross
      currency: "USDT",
      commission: 2,
      cashoutMethod: "CASH",
      exchangeRate: 90_000,
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 50 },
        { method: "CASH", currencyCode: "LBP", amount: 4_320_000 }, // $48 @ 90,000
      ],
    });

    expect(balance(db, "Binance", "USDT")).toBeCloseTo(500 + 100, 2);
    expect(balance(db, "General", "USD")).toBeCloseTo(1000 - 50, 2);
    expect(balance(db, "General", "LBP")).toBeCloseTo(
      100_000_000 - 4_320_000,
      2,
    );
  });

  it("no-legs fallback still books the single lump in the SERVICE cash currency (legacy/scripted callers)", () => {
    repo.createTransaction({
      provider: "WHISH_APP",
      serviceType: "RECEIVE",
      amount: 20_000_000,
      currency: "LBP",
      commission: 0,
      cashoutMethod: "CASH",
      exchangeRate: 90_000,
    });

    expect(balance(db, "General", "LBP")).toBeCloseTo(
      100_000_000 - 20_000_000,
      2,
    );
    expect(balance(db, "General", "USD")).toBeCloseTo(1000, 2);
  });
});
