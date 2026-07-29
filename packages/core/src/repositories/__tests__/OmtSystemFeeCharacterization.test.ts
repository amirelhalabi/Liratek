/**
 * OMT/WHISH SYSTEM SEND/RECEIVE — fee-arithmetic CHARACTERIZATION
 *
 * NOT A GUARD TEST. Its only job is to print what the code ACTUALLY does
 * today for the fee matrix described in the owner's bug report, so the
 * owner can compare real numbers against the report without any of us
 * "fixing" or resolving the ambiguity in the report first.
 *
 * Owner's report (verbatim, scope = bare OMT/WHISH SYSTEM provider, NOT
 * OMT_APP/WHISH_APP which have a separate fee contract per lira-101):
 *
 *   RECEIVE, fee NOT included:
 *     - Increase payment-drawer by fees (paid by customer)
 *     - Decrease out payment drawer by x (how we pay the customer)
 *     - Increase omt system by x (received by shop omt account)
 *   RECEIVE, fee edge case (fee included in received amount):
 *     - Increase payment drawer by fees
 *     - Decrease general drawer by x-fees
 *     - Increase omt system by x
 *   "The issue is that it's decreasing x+fees from BOTH drawers."
 *
 *   SEND, fee NOT included:
 *     - Increase payment drawer by x+fees
 *     - Decrease omt system by x
 *   SEND, fee edge case (fee included):
 *     - Increase payment drawer by x
 *     - Decrease omt system drawer by x-fee
 *
 * Ambiguity flag (NOT resolved here, per instructions): the RECEIVE
 * fee-included edge case says BOTH "increase payment drawer by fees" AND
 * "decrease general drawer by x-fees" — if "payment drawer" and "general
 * drawer" are the same physical drawer, that already double-counts the fee
 * in the owner's own model, before any code is considered. No code path
 * implements a RECEIVE fee-included flag at all (see CASE 2 below) — the
 * only way to test the owner's convention today is for an operator to type
 * a gross figure into the single `amount` field, which is what CASE 2 does.
 *
 * All cases: USD, x = 100 (the transfer/service value), fee = 5.
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

// ─── Mock DebtService (only used by CUSTOMER_ACCOUNT cashout — unused here) ──

jest.mock("../../services/DebtService", () => ({
  getDebtService: () => ({ addCredit: jest.fn() }),
  resetDebtService: jest.fn(),
}));

// ─── In-memory schema — every table the SYSTEM path touches ──────────────────
// (mirrors FinancialServiceRepository.appWalletTransfer.test.ts /
// .crossCurrencyTender.test.ts fixtures, plus currencies/currency_drawers
// per the task's instruction — NOT actually queried by this code path,
// since every call below passes an explicit exchangeRate, but included for
// schema completeness.)

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
      partner_mode TEXT CHECK(partner_mode IN ('THROUGH', 'FOR'))
    );

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
    );

    -- Included per task instructions; NOT queried on this code path since
    -- every call below passes an explicit exchangeRate (getUsdLbpSellRate,
    -- the only reader, is short-circuited by the ?? operator).
    CREATE TABLE currencies (
      tenant_id INTEGER DEFAULT 1,
      code TEXT PRIMARY KEY,
      name TEXT
    );
    CREATE TABLE currency_drawers (
      tenant_id INTEGER DEFAULT 1,
      currency_code TEXT NOT NULL,
      drawer_name TEXT NOT NULL
    );

    INSERT INTO drawer_balances VALUES (1, 'General',      'USD', 1000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'General',      'LBP', 100000000, CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'OMT_App',      'USD', 500,  CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Whish_App',    'USD', 500,  CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'OMT_System',   'USD', 500,  CURRENT_TIMESTAMP);
    INSERT INTO drawer_balances VALUES (1, 'Whish_System', 'USD', 500,  CURRENT_TIMESTAMP);

    -- Primary (base) system supplier row — required for the supplier-ledger
    -- auto-booking block to fire at all (getByProvider lookup).
    INSERT INTO suppliers (name, provider, is_system) VALUES ('OMT', 'OMT', 1);
    INSERT INTO system_settings (key_name, value) VALUES ('shop_base_system', 'OMT');
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

function supplierLedgerSumUsd(db: Database.Database, provider: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(sl.amount_usd), 0) as total
         FROM supplier_ledger sl JOIN suppliers s ON s.id = sl.supplier_id
        WHERE s.provider = ?`,
    )
    .get(provider) as { total: number };
  return row.total;
}

// Drawers snapshotted for every case (union of everything the map says the
// system path can touch: General, the *_System reserve drawer, and the
// app-wallet drawers a split payout can silently also hit).
const DRAWERS: Array<[string, string]> = [
  ["General", "USD"],
  ["OMT_System", "USD"],
  ["OMT_App", "USD"],
];

interface Snapshot {
  drawers: Record<string, number>;
  supplierUsd: number;
}

function snapshot(db: Database.Database): Snapshot {
  const drawers: Record<string, number> = {};
  for (const [name, currency] of DRAWERS) {
    drawers[`${name}_${currency}`] = balance(db, name, currency);
  }
  return { drawers, supplierUsd: supplierLedgerSumUsd(db, "OMT") };
}

function printDeltaReport(
  title: string,
  before: Snapshot,
  after: Snapshot,
  expectationNote: string,
): void {
  const lines: string[] = [title];
  for (const [name, currency] of DRAWERS) {
    const key = `${name}_${currency}`;
    const delta = after.drawers[key] - before.drawers[key];
    lines.push(
      `  ${name} (${currency}): ${delta >= 0 ? "+" : ""}${delta.toFixed(2)}`,
    );
  }
  const supplierDelta = after.supplierUsd - before.supplierUsd;
  lines.push(
    `  supplier_ledger (OMT, USD sum): ${supplierDelta >= 0 ? "+" : ""}${supplierDelta.toFixed(2)}`,
  );
  lines.push(`  ${expectationNote}`);
  // eslint-disable-next-line no-console
  console.log(lines.join("\n"));
}

describe("OMT SYSTEM fee characterization (diagnostic — not a guard)", () => {
  let db: Database.Database;
  let repo: FinancialServiceRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
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

  // ═══════════════════════════════════════════════════════════════════════
  // CASE 1 — RECEIVE, fee NOT included, single CASH leg
  // ═══════════════════════════════════════════════════════════════════════
  it("CASE 1 — RECEIVE fee-not-included, single leg (x=100, fee=5)", () => {
    const before = snapshot(db);

    const result = repo.createTransaction({
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commission: 5,
      cashoutMethod: "CASH",
      exchangeRate: 90000,
    });

    const after = snapshot(db);
    printDeltaReport(
      "CASE 1 — RECEIVE fee-not-included, single leg (x=100, fee=5)",
      before,
      after,
      "owner expects: General -100, OMT_System +100 (increase)",
    );

    expect(result.id).toBeGreaterThan(0);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CASE 2 — RECEIVE, fee "included" attempt. No `includingFees`/back-calc
  // path exists for RECEIVE anywhere in the repo or the frontend (hardcoded
  // false) — the ONLY way an operator could apply the SEND-style "fee
  // included" convention is by typing the gross (x+fee=105) into the single
  // `amount` field, since there is no second field to carry the fee
  // separately from the payout. This case characterizes exactly that.
  // ═══════════════════════════════════════════════════════════════════════
  it("CASE 2 — RECEIVE fee-'included' attempt, single leg (operator enters gross amount=105, fee=5)", () => {
    const before = snapshot(db);

    const result = repo.createTransaction({
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 105, // operator's only way to "include" the fee: type the gross figure
      currency: "USD",
      commission: 5,
      cashoutMethod: "CASH",
      exchangeRate: 90000,
    });

    const after = snapshot(db);
    printDeltaReport(
      "CASE 2 — RECEIVE fee-'included' attempt, single leg (amount=105, fee=5)",
      before,
      after,
      "owner expects (edge case): General -(x-fee)=-95, OMT_System +100 — NO CODE PATH implements this",
    );

    expect(result.id).toBeGreaterThan(0);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CASE 3 — SEND, fee NOT included, single CASH leg
  // ═══════════════════════════════════════════════════════════════════════
  it("CASE 3 — SEND fee-not-included, single leg (x=100, fee=5)", () => {
    const before = snapshot(db);

    const result = repo.createTransaction({
      provider: "OMT",
      serviceType: "SEND",
      amount: 100,
      currency: "USD",
      commission: 5,
      omtFee: 5,
      paidByMethod: "CASH",
      includingFees: false,
      exchangeRate: 90000,
    });

    const after = snapshot(db);
    printDeltaReport(
      "CASE 3 — SEND fee-not-included, single leg (x=100, fee=5)",
      before,
      after,
      "owner expects: General +(x+fee)=+105, OMT_System -100 (decrease)",
    );

    expect(result.id).toBeGreaterThan(0);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CASE 4 — SEND, fee INCLUDED, single CASH leg. Identical amount/fee to
  // CASE 3 — only `includingFees` differs, to isolate whether the flag
  // changes ANYTHING.
  // ═══════════════════════════════════════════════════════════════════════
  it("CASE 4 — SEND fee-included, single leg (x=100, fee=5) — same inputs as CASE 3 except includingFees:true", () => {
    const before = snapshot(db);

    const result = repo.createTransaction({
      provider: "OMT",
      serviceType: "SEND",
      amount: 100,
      currency: "USD",
      commission: 5,
      omtFee: 5,
      paidByMethod: "CASH",
      includingFees: true,
      exchangeRate: 90000,
    });

    const after = snapshot(db);
    printDeltaReport(
      "CASE 4 — SEND fee-included, single leg (x=100, fee=5)",
      before,
      after,
      "owner expects (edge case): General +x=+100, OMT_System -(x-fee)=-95",
    );

    expect(result.id).toBeGreaterThan(0);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CASE 5 — RECEIVE, fee NOT included, SPLIT payout: CASH 60 + OMT wallet
  // 40 (sum = 100 = receiveAmount, the contract reconcileLegs enforces for
  // a RECEIVE cashout — commission is excluded from what the legs must sum
  // to).
  // ═══════════════════════════════════════════════════════════════════════
  it("CASE 5 — RECEIVE fee-not-included, SPLIT payout: CASH 60 + OMT wallet 40 (x=100, fee=5)", () => {
    const before = snapshot(db);

    const result = repo.createTransaction({
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      commission: 5,
      cashoutMethod: "CASH",
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 60 },
        { method: "OMT", currencyCode: "USD", amount: 40 },
      ],
      exchangeRate: 90000,
    });

    const after = snapshot(db);
    printDeltaReport(
      "CASE 5 — RECEIVE fee-not-included, SPLIT payout: CASH 60 + OMT wallet 40 (x=100, fee=5)",
      before,
      after,
      "owner's model only names ONE payout drawer; split legs also hit OMT_App per paymentMethodToDrawerName(leg.method)",
    );

    expect(result.id).toBeGreaterThan(0);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CASE 6 — SEND, fee NOT included, SPLIT payment: CASH 60 + OMT wallet 45
  // (sum = 105 = totalCustomerPays). This is the mixed cash+non-cash split
  // the code map's §6 flagged as a real (different-polarity) double-count.
  // ═══════════════════════════════════════════════════════════════════════
  it("CASE 6 — SEND fee-not-included, SPLIT payment: CASH 60 + OMT wallet 45 (x=100, fee=5)", () => {
    const before = snapshot(db);

    const result = repo.createTransaction({
      provider: "OMT",
      serviceType: "SEND",
      amount: 100,
      currency: "USD",
      commission: 5,
      omtFee: 5,
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 60 },
        { method: "OMT", currencyCode: "USD", amount: 45 },
      ],
      exchangeRate: 90000,
    });

    const after = snapshot(db);
    printDeltaReport(
      "CASE 6 — SEND fee-not-included, SPLIT payment: CASH 60 + OMT wallet 45 (x=100, fee=5)",
      before,
      after,
      "single-leg CASE 3 reserves the cash leg back out of General; check whether the split case does too",
    );

    expect(result.id).toBeGreaterThan(0);
  });
});
